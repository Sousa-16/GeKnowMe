import json
from pathlib import Path

import pytest

from app.schemas import Variant
from app.sources import aliases as al
from app.sources import variant as v

FIXTURES = Path(__file__).parent / "fixtures"


def _variant(rsid: str) -> Variant:
    hits = json.loads((FIXTURES / f"myvariant_{rsid}.json").read_text(encoding="utf-8"))
    return v.parse_hits(rsid, hits)


# ---------- A7/A8: 3-letter -> 1-letter ----------

@pytest.mark.parametrize("raw, short", [
    ("p.Val600Glu", "V600E"),
    ("p.Gly12Cys", "G12C"),
    ("p.Leu858Arg", "L858R"),
    ("p.(Val600Glu)", "V600E"),  # HGVS "predicted" brackets
    ("p.V600E", "V600E"),  # already short
    ("V600E", "V600E"),
    ("p.Arg213Ter", "R213*"),  # stop codon
    ("p.Arg213*", "R213*"),
    ("  p.Val600Glu ", "V600E"),
])
def test_short_protein(raw, short):
    assert al.short_protein(raw) == short


@pytest.mark.parametrize("raw", [
    "p.Val600del", "p.Val600_Lys601delinsGlu", "p.Val600GlyfsTer5", "p.Val600fs", "p.Val600=",
    "p.?", "p.Met1?", "c.1799T>A", "", "p.Xyz600Glu", "p.Ter600Glu",
])
def test_unconvertible_forms_are_skipped(raw):
    assert al.short_protein(raw) is None


def test_long_protein_and_codon():
    assert al.long_protein("V600E") == "Val600Glu"
    assert al.long_protein("R213*") == "Arg213Ter"
    assert al.long_protein("V600") is None
    assert al.codon("V600E") == "V600"
    assert al.codon("G12C") == "G12"


# ---------- A9: alias list ----------

def test_braf_alias_list_has_every_form_with_its_source():
    aliases = al.build_aliases(_variant("rs113488022"))
    by_name = {a.name: a for a in aliases.names}
    assert aliases.gene == "BRAF"
    assert by_name["rs113488022"].type == "rsid"
    assert by_name["V600E"].type == "protein_short"
    assert by_name["V600E"].derived_from == "converted from p.Val600Glu (MyVariant)"
    assert by_name["p.Val600Glu"].type == "protein_long"
    assert by_name["c.1799T>A"].type == "dna"
    assert {a.name for a in aliases.names if a.type == "protein_short"} == {"V600E", "V600A", "V600G"}
    assert len(by_name) == len(aliases.names)  # no duplicates


def test_best_known_mutation_comes_first():
    braf = [a.name for a in al.build_aliases(_variant("rs113488022")).names if a.type == "protein_short"]
    kras = [a.name for a in al.build_aliases(_variant("rs121913530")).names if a.type == "protein_short"]
    egfr = [a.name for a in al.build_aliases(_variant("rs121434568")).names if a.type == "protein_short"]
    assert braf[0] == "V600E"
    assert kras[0] == "G12C"
    assert egfr[0] == "L858R"


# ---------- A10: search terms ----------

def test_braf_search_terms():
    aliases = al.build_aliases(_variant("rs113488022"))
    assert aliases.pubmed_terms[:3] == ['"BRAF V600E"', '"BRAF p.V600E"', '"BRAF Val600Glu"']
    assert aliases.pubmed_terms[-1] == "rs113488022"
    assert aliases.trial_terms[0] == "BRAF V600E" and aliases.trial_terms[-1] == "BRAF V600"
    assert set(aliases.trial_terms) == {"BRAF V600E", "BRAF V600A", "BRAF V600G", "BRAF V600"}


def test_kras_trial_terms_include_codon_once():
    aliases = al.build_aliases(_variant("rs121913530"))
    assert aliases.trial_terms[0] == "KRAS G12C"
    assert aliases.trial_terms.count("KRAS G12") == 1
    assert len(aliases.trial_terms) == 4


def test_no_gene_means_rsid_only_for_pubmed():
    var = Variant(rsid="rs1", hgvs_p=["p.Val600Glu"])
    aliases = al.build_aliases(var)
    assert aliases.pubmed_terms == ["rs1"]
    assert aliases.trial_terms == ["V600E", "V600"]


def test_stop_codon_and_unconvertible_forms():
    var = Variant(rsid="rs2", gene="TP53", hgvs_p=["p.Arg213Ter", "p.Arg213fs"])
    aliases = al.build_aliases(var)
    shorts = [a.name for a in aliases.names if a.type == "protein_short"]
    longs = [a.name for a in aliases.names if a.type == "protein_long"]
    assert shorts == ["R213*", "R213fs"]  # frameshifts get a short name too (short_other)
    assert longs == ["p.Arg213Ter", "p.Arg213fs"]  # the raw form is still listed
    assert "TP53 R213*" in aliases.trial_terms and "TP53 R213" in aliases.trial_terms



# ---------- deletions, frameshifts, literature names, nicknames, disease-level fallback ----------

@pytest.mark.parametrize("raw, short", [
    ("p.Phe508del", "F508del"),
    ("p.Glu746_Ala750del", "E746_A750del"),
    ("p.Gln1756ProfsTer74", "Q1756fs"),
    ("p.Val600fs", "V600fs"),
    ("p.Leu1234dup", "L1234dup"),
    ("p.Ala767_Val769insGluLys", "A767_V769insEK"),
    ("p.Val600_Lys601delinsGlu", "V600_K601delinsE"),
])
def test_short_other(raw, short):
    assert al.short_other(raw) == short


@pytest.mark.parametrize("raw", ["p.Val600Glu", "p.?", "c.1521_1523del", "", "p.Xyz600del"])
def test_short_other_skips_the_rest(raw):
    assert al.short_other(raw) is None


@pytest.mark.parametrize("lit, forms", [
    ("p.C130R", ["C130R"]), ("c.677C>T", ["C677T"]), ("p.F508del", ["F508del"]), ("c.5266dupC", ["c.5266dupC"]),
])
def test_literature_forms(lit, forms):
    assert al.literature_forms(lit) == forms


def test_cftr_deletion_gets_names_and_terms():
    var = Variant(rsid="rs113993960", gene="CFTR", hgvs_p=["p.Phe508del"], literature_names=["p.F508del"])
    a = al.build_aliases(var)
    assert [n.name for n in a.names if n.type == "protein_short"] == ["F508del"]
    assert a.trial_terms[0] == "CFTR F508del"
    assert "rs113993960" in a.extra_trial_terms and "CFTR F508del" not in a.extra_trial_terms


def test_apoe_uses_literature_name_and_nickname():
    var = Variant(rsid="rs429358", gene="APOE", hgvs_p=["p.Cys156Arg"], literature_names=["p.C130R"])
    a = al.build_aliases(var)
    common = {n.name: n.derived_from for n in a.names if n.type == "common"}
    assert "C130R" in common and "LitVar2" in common["C130R"] and "APOE4" in common
    assert a.extra_trial_terms[:2] == ["APOE4", "APOE ε4"] and "APOE C130R" in a.extra_trial_terms
    assert '"APOE4"' in a.pubmed_terms and '"APOE C130R"' in a.pubmed_terms


def test_noncoding_variant_still_searches_by_rs_number():
    a = al.build_aliases(Variant(rsid="rs7903146", gene="TCF7L2", hgvs_c=["c.450+33966C>T"]))
    assert a.trial_terms == [] and a.extra_trial_terms == ["rs7903146"]


def test_fallback_terms_come_from_pathogenic_clinvar_conditions():
    from app.schemas import ClinVarRecord
    recs = [ClinVarRecord(accession=f"RCV{i}", significance=s, condition=c, url="u") for i, (s, c) in enumerate([
        ("Pathogenic", "Sickle cell anemia"), ("Pathogenic", "Sickle cell anemia; not provided"),
        ("Likely pathogenic", "Beta thalassemia"), ("Benign", "Something benign"), ("Pathogenic", "not provided"),
    ])]
    a = al.build_aliases(Variant(rsid="rs334", gene="HBB", clinvar_records=recs))
    assert a.fallback_trial_terms == ["HBB Sickle cell anemia", "HBB Beta thalassemia"]
