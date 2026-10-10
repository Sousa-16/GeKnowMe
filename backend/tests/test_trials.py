import asyncio
from datetime import date

import pytest

from app.schemas import Trial
from app.sources import trials as tr
from tests.conftest import load_fixture


def test_parse_study_reads_all_fields():
    studies, _ = load_fixture("ctgov_braf_v600e.json")
    trial, drugs = tr.parse_study(studies[0])
    assert trial.nct_id.startswith("NCT")
    assert trial.url == f"https://clinicaltrials.gov/study/{trial.nct_id}"
    assert trial.title and trial.eligibility_text
    assert isinstance(trial.has_results, bool)
    assert trial.randomized in (True, False, None)


def test_parse_study_handles_missing_fields():
    trial, drugs = tr.parse_study({"protocolSection": {"identificationModule": {"nctId": "NCT00000001"}}})
    assert trial.nct_id == "NCT00000001"
    assert trial.phases == [] and trial.interventions == [] and drugs == []
    assert trial.randomized is None and trial.has_results is False


def test_assemble_merges_duplicates_and_records_terms(braf_aliases):
    studies, total = load_fixture("ctgov_braf_v600e.json")
    # same reply for two terms: every trial should appear once, matched by both terms
    res = tr.assemble(["BRAF V600E", "BRAF V600"], [(studies, total), (studies[:10], 50)], braf_aliases)
    ids = [t.nct_id for t in res.trials]
    assert len(ids) == len(set(ids)) == len(studies)
    assert sum(1 for t in res.trials if t.matched_terms == ["BRAF V600E", "BRAF V600"]) == 10
    assert res.stats.total_found == total
    assert set(res.stats.search_urls) == {"BRAF V600E", "BRAF V600"}


def test_assemble_scores_and_marks_top_30(braf_aliases):
    studies, total = load_fixture("ctgov_braf_v600e.json")
    res = tr.assemble(["BRAF V600E"], [(studies, total)], braf_aliases)
    sent = [t for t in res.trials if t.sent_to_ai]
    assert len(sent) == 30
    assert min(t.score for t in sent) >= max(t.score for t in res.trials if not t.sent_to_ai)
    assert all(t.score_reasons for t in sent)


def test_stats_look_sane(braf_aliases):
    studies, total = load_fixture("ctgov_braf_v600e.json")
    res = tr.assemble(["BRAF V600E"], [(studies, total)], braf_aliases)
    s = res.stats
    assert s.returned == len(res.trials)
    assert sum(s.by_phase.values()) == s.returned
    assert sum(s.by_status.values()) == s.returned
    top = [d.lower() for d, _ in s.top_drugs]
    assert any(d in " ".join(top) for d in ("dabrafenib", "trametinib", "encorafenib", "vemurafenib", "binimetinib"))
    assert not any("placebo" in d for d in top)


def test_partial_failure_keeps_working(braf_aliases):
    studies, total = load_fixture("ctgov_braf_v600e.json")
    res = tr.assemble(["BRAF V600E", "BRAF V600"], [(studies, total), tr.TrialSearchError("down")], braf_aliases)
    assert res.trials


def test_total_failure_raises(braf_aliases):
    with pytest.raises(tr.TrialSearchError):
        tr.assemble(["BRAF V600E"], [tr.TrialSearchError("down")], braf_aliases)


def test_no_terms_returns_empty(braf_aliases):
    braf_aliases.trial_terms = []
    res = asyncio.run(tr.fetch_trials(braf_aliases))
    assert res.trials == []


def _trial(**kw) -> Trial:
    base = dict(nct_id="NCT00000001", title="t", url="u")
    base.update(kw)
    return Trial(**base)


def test_score_rules(braf_aliases):
    t = _trial(title="Dabrafenib in BRAF V600E melanoma", phases=["PHASE3"], randomized=True, has_results=True,
               status="COMPLETED", start_date="2024-01")
    tr.score_trial(t, braf_aliases, today=date(2026, 10, 10))
    assert t.score == 2 + 3 + 4 + 3 + 1 + 1


def test_mutation_only_in_exclusion_is_penalised(braf_aliases):
    t = _trial(title="Drug X in melanoma", eligibility_text="Inclusion Criteria:\n* Adults\n\nExclusion Criteria:\n* Known BRAF V600E mutation")
    tr.score_trial(t, braf_aliases)
    assert "mutation only in exclusion criteria -5" in t.score_reasons


@pytest.mark.parametrize("phases, label", [
    (["PHASE2"], "Phase 2"), (["PHASE1", "PHASE2"], "Phase 1/2"), (["EARLY_PHASE1"], "Early Phase 1"),
    ([], "N/A"), (["NA"], "N/A"), (["PHASE2", "PHASE3"], "Phase 2/3"),
])
def test_phase_label(phases, label):
    assert tr.phase_label(phases) == label



def test_disease_level_trials_are_marked_and_not_sent_to_ai(braf_aliases):
    studies, total = load_fixture("ctgov_braf_v600e.json")
    res = tr.assemble(["BRAF V600E", "BRAF melanoma"], [(studies[:3], 3), (studies[3:20], 17)], braf_aliases,
                      disease_terms={"BRAF melanoma"})
    variant_level = [t for t in res.trials if not t.disease_level]
    disease_level = [t for t in res.trials if t.disease_level]
    assert len(variant_level) == 3 and len(disease_level) == 17
    assert res.trials[:3] == variant_level  # variant matches listed first
    assert not any(t.sent_to_ai for t in disease_level)


async def test_fallback_runs_only_when_few_variant_trials(monkeypatch, braf_aliases):
    studies, total = load_fixture("ctgov_braf_v600e.json")
    searched = []

    async def fake_search(client, term):
        searched.append(term)
        return (studies[:2], 2) if term in braf_aliases.trial_terms else (studies[2:10], 8)
    monkeypatch.setattr(tr, "_search", fake_search)
    braf_aliases.fallback_trial_terms = ["BRAF Melanoma"]
    res = await tr.fetch_trials(braf_aliases)
    assert "BRAF Melanoma" in searched and any(t.disease_level for t in res.trials)

    searched.clear()
    monkeypatch.setattr(tr, "_search", lambda c, t: _ret(searched, t, studies))
    res = await tr.fetch_trials(braf_aliases)
    assert "BRAF Melanoma" not in searched and not any(t.disease_level for t in res.trials)


async def _ret(searched, term, studies):
    searched.append(term)
    return studies[:50], 50



def test_total_found_is_never_below_trials_shown(braf_aliases):
    studies, _ = load_fixture("ctgov_braf_v600e.json")
    res = tr.assemble(["a", "b"], [(studies[:13], 13), (studies[13:20], 7)], braf_aliases)
    assert res.stats.returned == 20 and res.stats.total_found >= 20
