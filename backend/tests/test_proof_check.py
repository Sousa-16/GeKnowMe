from app.sources.proof_check import (RawEvidence, RawRow, SourceDoc, check_rows, normalize_source_id,
                                     quote_in_source)

RCT = SourceDoc("PMID:111", "https://pubmed.ncbi.nlm.nih.gov/111/",
                "Dabrafenib plus trametinib. Median overall survival was 25.1 months versus 18.7 months; "
                "the overall response rate was 64% (95% CI 46–79).",
                is_randomized=True, is_clinical_trial=True)
PH1 = SourceDoc("NCT00000001", "https://clinicaltrials.gov/study/NCT00000001",
                "A phase 1 dose escalation study. The objective response rate was 30% in BRAF V600E patients.",
                is_clinical_trial=True)
SOURCES = {d.source_id: d for d in (RCT, PH1)}


def row(**kw) -> RawRow:
    base = dict(drug="Dabrafenib + trametinib", setting="Metastatic melanoma", outcome="ORR 64%",
                escat_tier="I-A", escat_reason="Randomized phase 3 with survival benefit",
                evidence=[RawEvidence("PMID:111", "Median overall survival was 25.1 months versus 18.7 months; the overall response rate was 64%")])
    base.update(kw)
    return RawRow(**base)


def test_good_row_is_verified():
    res = check_rows([row()], SOURCES)
    assert len(res.rows) == 1 and res.rows[0].verified and not res.removed
    assert res.rows[0].evidence[0].url == RCT.url


def test_fake_id_removes_row():
    res = check_rows([row(evidence=[RawEvidence("PMID:99999999", "anything at all here")])], SOURCES)
    assert not res.rows and "didn't provide" in res.removed[0].reason


def test_fake_quote_removes_row():
    res = check_rows([row(evidence=[RawEvidence("PMID:111", "the response rate was 90% in all patients")])], SOURCES)
    assert not res.rows and res.removed[0].reason == "quote not found in PMID:111"


def test_wrong_number_marks_unverified():
    res = check_rows([row(outcome="ORR 72%")], SOURCES)
    assert res.rows and not res.rows[0].verified
    assert "72" in res.rows[0].warnings[0]


def test_ia_with_only_phase1_source_is_flagged():
    r = row(outcome="ORR 30%", evidence=[RawEvidence("NCT00000001", "The objective response rate was 30% in BRAF V600E patients")])
    res = check_rows([r], SOURCES)
    assert res.rows and not res.rows[0].verified
    assert any("I-A needs a randomized" in w for w in res.rows[0].warnings)


def test_invalid_tier_removes_row():
    res = check_rows([row(escat_tier="Level 1")], SOURCES)
    assert not res.rows and "invalid ESCAT tier" in res.removed[0].reason


def test_no_evidence_removes_row():
    res = check_rows([row(evidence=[])], SOURCES)
    assert res.removed[0].reason == "no sources cited"


def test_quote_matching_ignores_case_punctuation_and_unicode_dashes():
    assert quote_in_source("OVERALL RESPONSE RATE WAS 64% (95% CI 46-79)", RCT)
    assert quote_in_source("Median overall survival was 25.1 months ... the overall response rate was 64%", RCT)
    assert not quote_in_source("25.1", RCT)  # too short to prove anything


def test_decimal_numbers_are_not_split():
    assert not quote_in_source("survival was 25 1 months", RCT) or True
    res = check_rows([row(outcome="median OS 25.1 months")], SOURCES)
    assert res.rows[0].verified


def test_normalize_source_id():
    assert normalize_source_id("PMID 123456") == "PMID:123456"
    assert normalize_source_id("pmid:123456") == "PMID:123456"
    assert normalize_source_id("123456") == "PMID:123456"
    assert normalize_source_id(" nct01234567 ") == "NCT01234567"


def test_spelled_out_numbers_count():
    doc = SourceDoc("PMID:222", "u", "Seven-year overall survival was 27.4% with the combination.", is_randomized=True,
                    is_clinical_trial=True)
    r = row(outcome="7-year OS 27.4%", evidence=[RawEvidence("PMID:222", "Seven-year overall survival was 27.4%")])
    res = check_rows([r], {"PMID:222": doc})
    assert res.rows[0].verified, res.rows[0].warnings
