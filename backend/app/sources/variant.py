"""[1] Variant lookup - Person A. See docs/PLAN.md section 5, step 1.

Asks MyVariant.info for an rs number and stores the raw data it gives back: gene, every
mutation name (one rs number can mean several alt alleles), and each ClinVar record.
Converting "p.Val600Glu" to "V600E" is step 2 (aliases.py), not here.
"""

import asyncio
import logging
import re

import httpx

from ..schemas import ClinVarRecord, Variant

log = logging.getLogger(__name__)

MYVARIANT_URL = "https://myvariant.info/v1/variant/{rsid}"
# Only what we read. Keeps replies ~10 KB instead of ~500 KB with fields=all.
FIELDS = ",".join([
    "dbsnp.rsid", "dbsnp.gene.symbol", "dbsnp.gene.name",
    "snpeff.ann",
    "clinvar.gene", "clinvar.rcv", "clinvar.variant_id",
    "dbnsfp.genename",
    # CIViC evidence ids: only counted, to put the best-studied allele first (V600E before V600G)
    "civic.name", "civic.molecularProfiles.evidenceItems.id",
])
RETRIES = 3
_PROTEIN_IN_NAME = re.compile(r"\((p\.[^()\s]+)\)")  # "...c.1799T>A (p.Val600Glu)"
_CODING_IN_NAME = re.compile(r":(c\.[^\s(]+)")


class VariantNotFound(Exception):
    """The rs number is well-formed but MyVariant has no record of it."""


class VariantLookupError(Exception):
    """MyVariant could not be reached, or kept answering with nothing."""


# ---------- A1/A5: fetching ----------

async def fetch_variant(rsid: str) -> Variant:
    """Look the rs number up on MyVariant. Raises VariantNotFound or VariantLookupError."""
    last = "unknown error"
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "variant-trial-scope/0.1"}) as client:
        for attempt in range(RETRIES):
            try:
                resp = await client.get(MYVARIANT_URL.format(rsid=rsid), params={"fields": FIELDS})
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last = type(e).__name__
            else:
                if resp.status_code == 404:
                    raise VariantNotFound(f"{rsid} was not found in MyVariant.info / dbSNP")
                if resp.status_code == 200:
                    hits = _hits(resp)
                    if hits:
                        return parse_hits(rsid, hits)
                    last = "empty reply"  # MyVariant sometimes answers 200 with nothing; try again
                else:
                    last = f"HTTP {resp.status_code}"
                    if resp.status_code not in (429, 500, 502, 503, 504):
                        break
            await asyncio.sleep(0.5 * 2**attempt)
    raise VariantLookupError(f"MyVariant.info lookup for {rsid} failed ({last})")


def _hits(resp: httpx.Response) -> list[dict]:
    """MyVariant returns one object for a single allele, a list for several. Normalise to a list
    of non-empty dicts (anything without data counts as an empty reply)."""
    if not resp.content:
        return []
    try:
        data = resp.json()
    except ValueError:
        return []
    items = data if isinstance(data, list) else [data]
    return [h for h in items if isinstance(h, dict) and any(k in h for k in ("dbsnp", "clinvar", "snpeff"))]


# ---------- A2-A4: one reply -> Variant ----------

def _as_list(x) -> list:
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


def _gene(hits: list[dict]) -> tuple[str | None, str | None]:
    """Gene symbol and full name. ClinVar's symbol first, then dbSNP, snpEff, dbNSFP."""
    symbol = name = None
    for h in hits:
        dbsnp_gene = (h.get("dbsnp") or {}).get("gene") or {}
        candidates = [
            (h.get("clinvar") or {}).get("gene", {}).get("symbol"),
            dbsnp_gene.get("symbol"),
            *[a.get("genename") for a in _as_list((h.get("snpeff") or {}).get("ann"))],
            *_as_list((h.get("dbnsfp") or {}).get("genename")),
        ]
        symbol = symbol or next((c for c in candidates if c), None)
        name = name or dbsnp_gene.get("name")
        if symbol and name:
            break
    return symbol, name


def _hgvs(hit: dict) -> tuple[str | None, str | None]:
    """(hgvs_c, hgvs_p) for one allele. snpEff's protein-changing annotation first; otherwise the
    names inside ClinVar's preferred_name, e.g. 'NM_004333.6(BRAF):c.1799T>A (p.Val600Glu)'."""
    anns = _as_list((hit.get("snpeff") or {}).get("ann"))
    with_protein = [a for a in anns if a.get("hgvs_p")]
    # Prefer a real coding transcript (NM_...) over predicted ones, then the first listed
    with_protein.sort(key=lambda a: not str(a.get("feature_id", "")).startswith("NM_"))
    if with_protein:
        return with_protein[0].get("hgvs_c"), with_protein[0]["hgvs_p"]
    for rcv in _as_list((hit.get("clinvar") or {}).get("rcv")):
        pref = rcv.get("preferred_name") or ""
        p, c = _PROTEIN_IN_NAME.search(pref), _CODING_IN_NAME.search(pref)
        if p or c:
            return (c.group(1) if c else None), (p.group(1) if p else None)
    coding = next((a.get("hgvs_c") for a in anns if a.get("hgvs_c")), None)
    return coding, None


def _condition(rcv: dict) -> str:
    conds = _as_list(rcv.get("conditions"))
    names = [c.get("name") for c in conds if isinstance(c, dict) and c.get("name")]
    return "; ".join(names) if names else "not provided"


def _clinvar_records(hit: dict, fallback_protein: str | None) -> list[ClinVarRecord]:
    records = []
    for rcv in _as_list((hit.get("clinvar") or {}).get("rcv")):
        accession = rcv.get("accession")
        if not accession:
            continue
        m = _PROTEIN_IN_NAME.search(rcv.get("preferred_name") or "")
        records.append(ClinVarRecord(
            accession=accession,
            significance=rcv.get("clinical_significance") or "not provided",
            condition=_condition(rcv),
            protein_change=m.group(1) if m else fallback_protein,
            url=f"https://www.ncbi.nlm.nih.gov/clinvar/{accession}/",
        ))
    return records


def _evidence_weight(hit: dict) -> tuple[int, int]:
    """How well-studied one allele is: (CIViC evidence items, ClinVar records). Used only to
    order the alleles, so the best-known mutation (V600E, G12C, L858R) comes first."""
    civic = sum(
        len(_as_list(mp.get("evidenceItems")))
        for mp in _as_list((hit.get("civic") or {}).get("molecularProfiles"))
        if isinstance(mp, dict)
    )
    return civic, len(_as_list((hit.get("clinvar") or {}).get("rcv")))


def parse_hits(rsid: str, hits: list[dict]) -> Variant:
    """Turn MyVariant's reply (one dict per alt allele) into a Variant. Separate from
    fetch_variant so tests can feed saved replies. Alleles are ordered best-studied first."""
    gene, gene_name = _gene(hits)
    hgvs_c: list[str] = []
    hgvs_p: list[str] = []
    records: list[ClinVarRecord] = []
    for hit in sorted(hits, key=_evidence_weight, reverse=True):
        c, p = _hgvs(hit)
        if c and c not in hgvs_c:
            hgvs_c.append(c)
        if p and p not in hgvs_p:
            hgvs_p.append(p)
        records.extend(_clinvar_records(hit, p))
    # Same accession can't appear twice (it never should, but MyVariant merges sources)
    seen: set[str] = set()
    records = [r for r in records if not (r.accession in seen or seen.add(r.accession))]
    return Variant(
        rsid=rsid,
        gene=gene,
        gene_name=gene_name,
        hgvs_c=hgvs_c,
        hgvs_p=hgvs_p,
        clinvar_records=records,
        links={
            "MyVariant": f"https://myvariant.info/v1/variant/{rsid}",
            "ClinVar": f"https://www.ncbi.nlm.nih.gov/clinvar/?term={rsid}",
            "dbSNP": f"https://www.ncbi.nlm.nih.gov/snp/{rsid}",
        },
    )
