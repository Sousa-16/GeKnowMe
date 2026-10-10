import json
from pathlib import Path

import httpx
import pytest

from app.sources import variant as v

FIXTURES = Path(__file__).parent / "fixtures"


def load_myvariant(name: str):
    # utf-8 explicitly: the saved replies contain non-ASCII and Windows defaults to cp1252
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _parse(rsid: str):
    return v.parse_hits(rsid, load_myvariant(f"myvariant_{rsid}.json"))


# ---------- A2-A4: parsing the saved replies ----------

def test_braf_gene_and_name():
    var = _parse("rs113488022")
    assert var.rsid == "rs113488022"
    assert var.gene == "BRAF"
    assert var.gene_name == "B-Raf proto-oncogene, serine/threonine kinase"


def test_braf_collects_all_three_alleles():
    var = _parse("rs113488022")
    assert set(var.hgvs_p) == {"p.Val600Glu", "p.Val600Ala", "p.Val600Gly"}
    assert set(var.hgvs_c) == {"c.1799T>A", "c.1799T>C", "c.1799T>G"}
    assert len(var.hgvs_p) == len(set(var.hgvs_p))  # no duplicates


def test_best_studied_allele_comes_first():
    # Ordered by CIViC evidence items, then ClinVar records. MyVariant itself lists them by
    # alt allele (G, T, C for BRAF), which would put V600A first.
    assert _parse("rs113488022").hgvs_p[0] == "p.Val600Glu"
    assert _parse("rs121913530").hgvs_p[0] == "p.Gly12Cys"
    assert _parse("rs121434568").hgvs_p[0] == "p.Leu858Arg"
    assert _parse("rs113488022").clinvar_records[0].protein_change == "p.Val600Glu"


def test_braf_clinvar_records():
    var = _parse("rs113488022")
    by_acc = {r.accession: r for r in var.clinvar_records}
    assert len(by_acc) == len(var.clinvar_records) >= 17
    melanoma = by_acc["RCV000067669"]
    assert melanoma.significance == "Pathogenic"
    assert melanoma.condition == "Melanoma"
    assert melanoma.protein_change == "p.Val600Glu"
    assert melanoma.url == "https://www.ncbi.nlm.nih.gov/clinvar/RCV000067669/"
    # a record for a different allele says which mutation it is about
    assert by_acc["RCV000798913"].protein_change == "p.Val600Gly"


def test_links_point_at_the_three_databases():
    var = _parse("rs113488022")
    assert var.links["MyVariant"].endswith("/variant/rs113488022")
    assert "clinvar" in var.links["ClinVar"] and "rs113488022" in var.links["ClinVar"]
    assert var.links["dbSNP"] == "https://www.ncbi.nlm.nih.gov/snp/rs113488022"


def test_kras_three_alleles():
    var = _parse("rs121913530")
    assert var.gene == "KRAS"
    assert set(var.hgvs_p) == {"p.Gly12Cys", "p.Gly12Ser", "p.Gly12Arg"}
    assert any(r.condition == "Lung adenocarcinoma" for r in var.clinvar_records)


def test_egfr_picks_the_protein_changing_annotation():
    # EGFR's snpEff block lists ~17 "structural_interaction_variant" entries without a protein
    # change before the missense one; we must still find p.Leu858Arg / p.Leu858Gln
    var = _parse("rs121434568")
    assert var.gene == "EGFR"
    assert set(var.hgvs_p) == {"p.Leu858Arg", "p.Leu858Gln"}
    assert var.hgvs_c == ["c.2573T>G", "c.2573T>A"]  # L858R's allele first
    drug = [r for r in var.clinvar_records if r.significance == "drug response"]
    assert drug and all(r.protein_change == "p.Leu858Arg" for r in drug)


def test_parse_handles_a_bare_reply():
    var = v.parse_hits("rs1", [{"_id": "chr1:g.1A>T", "dbsnp": {"rsid": "rs1"}}])
    assert var.gene is None and var.hgvs_p == [] and var.clinvar_records == []


def test_parse_falls_back_to_clinvar_names_when_snpeff_is_missing():
    hit = {"clinvar": {"gene": {"symbol": "TP53"}, "rcv": {
        "accession": "RCV1", "clinical_significance": "Pathogenic",
        "conditions": [{"name": "A"}, {"name": "B"}],
        "preferred_name": "NM_000546.6(TP53):c.818G>A (p.Arg273His)",
    }}}
    var = v.parse_hits("rs28934576", [hit])
    assert var.gene == "TP53"
    assert var.hgvs_p == ["p.Arg273His"] and var.hgvs_c == ["c.818G>A"]
    assert var.clinvar_records[0].condition == "A; B"


# ---------- A5: not found / empty reply / retries ----------

REAL_CLIENT = httpx.AsyncClient  # saved before tests monkeypatch v.httpx.AsyncClient


def _client_with(handler):
    """fetch_variant builds its own AsyncClient; swap in one that answers from `handler`."""
    def factory(**kw):
        kw.pop("timeout", None)
        return REAL_CLIENT(transport=httpx.MockTransport(handler), **kw)
    return factory


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    async def instant(_):
        return None
    monkeypatch.setattr(v.asyncio, "sleep", instant)


async def test_unknown_rsid_raises_not_found(monkeypatch):
    body = (FIXTURES / "myvariant_not_found.json").read_text(encoding="utf-8")
    monkeypatch.setattr(v.httpx, "AsyncClient", _client_with(lambda req: httpx.Response(404, text=body)))
    with pytest.raises(v.VariantNotFound):
        await v.fetch_variant("rs99999999999")


async def test_empty_reply_is_retried(monkeypatch):
    calls = []
    good = load_myvariant("myvariant_rs113488022.json")

    def handler(req):
        if "litvar" in str(req.url):
            return httpx.Response(200, json=[])
        calls.append(req.url.params["fields"])
        return httpx.Response(200, text="") if len(calls) == 1 else httpx.Response(200, json=good)
    monkeypatch.setattr(v.httpx, "AsyncClient", _client_with(handler))
    var = await v.fetch_variant("rs113488022")
    assert len(calls) == 2 and var.gene == "BRAF"
    assert "clinvar.rcv" in calls[0]


async def test_always_empty_gives_lookup_error(monkeypatch):
    monkeypatch.setattr(v.httpx, "AsyncClient", _client_with(lambda req: httpx.Response(200, json=[])))
    with pytest.raises(v.VariantLookupError, match="empty reply"):
        await v.fetch_variant("rs113488022")


async def test_server_error_is_retried_then_reported(monkeypatch):
    monkeypatch.setattr(v.httpx, "AsyncClient", _client_with(lambda req: httpx.Response(503)))
    with pytest.raises(v.VariantLookupError, match="HTTP 503"):
        await v.fetch_variant("rs113488022")



# ---------- found in the first end-to-end runs ----------

@pytest.mark.parametrize("rsid, gene, protein", [
    ("rs113993960", "CFTR", "p.Phe508del"),   # dbSNP lists two genes (CFTR, CFTR-AS1): used to crash
    ("rs1800562", "HFE", "p.Cys282Tyr"),      # same, plus several transcripts
    ("rs334", "HBB", "p.Glu7Val"),            # ClinVar's gene is a placeholder locus (LOC106099062)
    ("rs7903146", "TCF7L2", None),            # intronic: no protein change, ClinVar gene is LOC...
])
def test_gene_lists_and_placeholder_loci(rsid, gene, protein):
    data = load_myvariant(f"myvariant_{rsid}.json")
    var = v.parse_hits(rsid, data if isinstance(data, list) else [data])
    assert var.gene == gene
    if protein:
        assert var.hgvs_p[0] == protein


async def test_litvar_names_are_added(monkeypatch):
    good = load_myvariant("myvariant_rs113488022.json")

    def handler(req):
        if "litvar" in str(req.url):
            return httpx.Response(200, json=[
                {"rsid": "rs113488022", "gene": ["BRAF"], "name": "p.V600E"},
                {"rsid": "rs1134880221", "gene": ["X"], "name": "p.Z1Z"},  # different rs number: ignored
            ])
        return httpx.Response(200, json=good)
    monkeypatch.setattr(v.httpx, "AsyncClient", _client_with(handler))
    var = await v.fetch_variant("rs113488022")
    assert var.literature_names == ["p.V600E"]


async def test_litvar_down_is_harmless(monkeypatch):
    good = load_myvariant("myvariant_rs113488022.json")
    monkeypatch.setattr(v.httpx, "AsyncClient", _client_with(
        lambda req: httpx.Response(503) if "litvar" in str(req.url) else httpx.Response(200, json=good)))
    var = await v.fetch_variant("rs113488022")
    assert var.gene == "BRAF" and var.literature_names == []
