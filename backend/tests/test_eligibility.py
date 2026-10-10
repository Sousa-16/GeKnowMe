from app.schemas import Trial
from app.sources.eligibility import extract_criteria, split_rules, split_sections
from tests.conftest import load_fixture
from app.sources.trials import parse_study

TEXT = """Inclusion Criteria:

1. Age 18 years or older
2. Presence of BRAF V600E mutation in tumor tissue previously determined by a local assay
3. Tumor tissue available for central NGS testing of BRAF status

Exclusion Criteria:

* Prior treatment with a BRAF inhibitor or MEK inhibitor
* Known KRAS mutation
* Pregnant or breastfeeding
"""


def _trial(text: str) -> Trial:
    return Trial(nct_id="NCT00000001", title="t", url="https://clinicaltrials.gov/study/NCT00000001",
                 eligibility_text=text)


def test_split_sections():
    inc, exc = split_sections(TEXT)
    assert "Age 18" in inc and "Prior treatment" not in inc
    assert "Prior treatment" in exc and "Age 18" not in exc


def test_split_sections_without_headers_counts_as_inclusion():
    inc, exc = split_sections("Must have BRAF V600E mutation")
    assert inc == "Must have BRAF V600E mutation" and exc == ""


def test_key_inclusion_header():
    inc, exc = split_sections("Key Inclusion Criteria:\n- a\nKey Exclusion Criteria:\n- b")
    assert inc.strip() == "- a" and exc.strip() == "- b"


def test_split_rules_bullets_and_numbers():
    rules = split_rules(split_sections(TEXT)[0])
    assert rules[0] == "Age 18 years or older"
    assert rules[1].startswith("Presence of BRAF V600E")


def test_categories(braf_aliases):
    crit = {c.text: c for c in extract_criteria([_trial(TEXT)], braf_aliases)}
    assert crit["Presence of BRAF V600E mutation in tumor tissue previously determined by a local assay"].category == "biomarker_required"
    assert crit["Tumor tissue available for central NGS testing of BRAF status"].category == "testing_method"
    assert crit["Prior treatment with a BRAF inhibitor or MEK inhibitor"].category == "prior_therapy"
    assert crit["Known KRAS mutation"].category == "biomarker_excluded"
    assert "Age 18 years or older" not in crit and "Pregnant or breastfeeding" not in crit
    assert all(c.kind == ("inclusion" if "BRAF V600E mutation in" in t or "NGS" in t else "exclusion") for t, c in crit.items())


def test_never_crashes_on_odd_text(braf_aliases):
    odd = ["", "   ", "no headers at all", "Inclusion Criteria:", "≥18 years; ECOG ≤1 &amp; BRAF V600E+", "\n\n\n*\n-\n1."]
    for text in odd:
        extract_criteria([_trial(text)], braf_aliases)


def test_real_fixture_finds_biomarker_rules(braf_aliases):
    studies, _ = load_fixture("ctgov_braf_v600e.json")
    trials = [parse_study(s)[0] for s in studies]
    crit = extract_criteria(trials, braf_aliases)
    assert sum(c.category == "biomarker_required" for c in crit) >= 20
    per_trial = {}
    for c in crit:
        per_trial[c.nct_id] = per_trial.get(c.nct_id, 0) + 1
    assert max(per_trial.values()) <= 8


def test_noise_is_not_kept(braf_aliases):
    text = ("Exclusion Criteria:\n* Positive SARS-CoV-2 or variants RT-PCR test at screening\n"
            "* Known severe hypersensitivity to BRAF inhibitors\n* Known EGFR mutation")
    crit = {c.text: c.category for c in extract_criteria([_trial(text)], braf_aliases)}
    assert "Positive SARS-CoV-2 or variants RT-PCR test at screening" not in crit
    assert "Known severe hypersensitivity to BRAF inhibitors" not in crit
    assert crit["Known EGFR mutation"] == "biomarker_excluded"


def test_mutation_without_space_is_found():
    from app.schemas import Alias, Aliases
    kras = Aliases(gene="KRAS", names=[Alias(name="G12C", type="protein_short", derived_from="x")])
    crit = extract_criteria([_trial("Inclusion Criteria:\n* Tumor must have a KRASG12C mutation")], kras)
    assert crit and crit[0].category == "biomarker_required"


def test_non_cancer_genetic_rules():
    from app.schemas import Alias, Aliases
    cf = Aliases(gene="CFTR", names=[Alias(name="F508del", type="protein_short", derived_from="x")])
    text = ("Inclusion Criteria:\n* Homozygous for the F508del CFTR mutation, confirmed by genetic testing\n"
            "* Genotype documented by a CLIA-certified laboratory\n* Age 12 years or older\n\n"
            "Exclusion Criteria:\n* Prior treatment with a CFTR modulator within 28 days\n"
            "* Carrier of a second pathogenic variant in another gene\n"
            "* Use of commercially available CFTR modulator (e.g., Kalydeco) within 14 days before screening")
    crit = {c.text: c.category for c in extract_criteria([_trial(text)], cf)}
    assert crit["Homozygous for the F508del CFTR mutation, confirmed by genetic testing"] == "biomarker_required"
    assert crit["Genotype documented by a CLIA-certified laboratory"] in ("testing_method", "other_biomarker", "biomarker_required")
    assert crit["Prior treatment with a CFTR modulator within 28 days"] == "prior_therapy"
    assert crit["Carrier of a second pathogenic variant in another gene"] == "biomarker_excluded"
    assert crit["Use of commercially available CFTR modulator (e.g., Kalydeco) within 14 days before screening"] == "prior_therapy"
    assert "Age 12 years or older" not in crit
