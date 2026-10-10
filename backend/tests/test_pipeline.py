import pytest

from app import pipeline
from app.schemas import (Alias, Aliases, Brief, PaperResults, TreatmentResults, TreatmentRow, Evidence, Trial,
                         TrialResults, Variant)


@pytest.mark.parametrize("raw, expected", [("rs113488022", "rs113488022"), (" RS121913530 ", "rs121913530"),
                                           ("121434568", "rs121434568")])
def test_normalize_rsid(raw, expected):
    assert pipeline.normalize_rsid(raw) == expected


@pytest.mark.parametrize("raw", ["", "BRAF V600E", "rs", "rs12a", "chr7:140453136"])
def test_invalid_rsid(raw):
    with pytest.raises(pipeline.InvalidRsid):
        pipeline.normalize_rsid(raw)


@pytest.fixture
def fake_sources(monkeypatch, tmp_path):
    calls = {"trials": 0, "ai": 0}

    async def fetch_variant(rsid):
        return Variant(rsid=rsid, gene="BRAF")

    def build_aliases(v):
        return Aliases(gene="BRAF", names=[Alias(name="V600E", type="protein_short", derived_from="x")],
                       trial_terms=["BRAF V600E"])

    async def fetch_papers(a):
        return PaperResults()

    async def fetch_trials(a):
        calls["trials"] += 1
        return TrialResults(trials=[Trial(nct_id="NCT00000001", title="t", url="u")])

    async def summarize(v, a, p, t):
        calls["ai"] += 1
        return TreatmentResults(rows=[TreatmentRow(drug="d", setting="s", outcome="o", escat_tier="I-B",
                                                   escat_reason="r", evidence=[Evidence(source_id="NCT00000001",
                                                                                         quote="q", url="u")])])

    monkeypatch.setattr(pipeline.variant, "fetch_variant", fetch_variant)
    monkeypatch.setattr(pipeline.aliases, "build_aliases", build_aliases)
    monkeypatch.setattr(pipeline.papers, "fetch_papers", fetch_papers)
    monkeypatch.setattr(pipeline.papers, "score_papers", lambda p, a, d: p)
    monkeypatch.setattr(pipeline.trials, "fetch_trials", fetch_trials)
    monkeypatch.setattr(pipeline.ai_summary, "summarize_treatments", summarize)
    monkeypatch.setattr(pipeline, "DEMO_DIR", tmp_path)
    pipeline._partial.clear()
    return calls


async def test_full_brief(fake_sources):
    b = await pipeline.build_brief("rs113488022")
    assert b.status["treatments"] == "ok" and len(b.treatments.rows) == 1


async def test_split_brief_then_treatments_reuses_work(fake_sources):
    b = await pipeline.build_brief("rs113488022", include_ai=False)
    assert b.status["treatments"] == "pending" and b.treatments.rows == []
    assert fake_sources == {"trials": 1, "ai": 0}
    t = await pipeline.build_treatments("rs113488022")
    assert t.status == "ok" and len(t.treatments.rows) == 1
    assert fake_sources == {"trials": 1, "ai": 1}  # trials were not searched again


async def test_treatments_without_earlier_call_still_works(fake_sources):
    t = await pipeline.build_treatments("rs113488022")
    assert t.status == "ok" and fake_sources["trials"] == 1


async def test_demo_brief_is_served_first(fake_sources, tmp_path):
    (tmp_path / "rs113488022.json").write_text(Brief(rsid="rs113488022", warnings=["demo"]).model_dump_json())
    b = await pipeline.build_brief("rs113488022")
    assert b.from_demo and b.warnings == ["demo"] and fake_sources["trials"] == 0
    live = await pipeline.build_brief("rs113488022", use_demo=False)
    assert not live.from_demo and fake_sources["trials"] == 1


async def test_unbuilt_steps_become_warnings(monkeypatch, tmp_path):
    async def not_built(rsid):
        raise NotImplementedError
    monkeypatch.setattr(pipeline.variant, "fetch_variant", not_built)
    monkeypatch.setattr(pipeline, "DEMO_DIR", tmp_path)
    b = await pipeline.build_brief("rs1", include_ai=False)
    assert b.status == {"variant": "skipped", "treatments": "skipped"}
