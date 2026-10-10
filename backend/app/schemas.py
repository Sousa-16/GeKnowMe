"""The contract from docs/PLAN.md section 5, as Python classes.

Shared file: agree with your teammate before changing anything here.
The website reads exactly these fields.
"""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

DISCLAIMER = "Research tool for clinical trial planning. Not medical advice."


# ---------- [1] Variant lookup (Person A) ----------

class ClinVarRecord(BaseModel):
    accession: str  # "RCV000014992"
    significance: str  # "Pathogenic"
    condition: str  # "Melanoma"
    protein_change: str | None = None  # raw form, "p.Val600Glu"
    url: str  # https://www.ncbi.nlm.nih.gov/clinvar/RCV000014992/


class Variant(BaseModel):
    rsid: str
    gene: str | None = None
    gene_name: str | None = None
    hgvs_c: list[str] = []  # ["c.1799T>A", ...]
    hgvs_p: list[str] = []  # ["p.Val600Glu", ...] raw, as MyVariant gives it
    clinvar_records: list[ClinVarRecord] = []
    links: dict[str, str] = {}  # {"MyVariant": url, "ClinVar": url, "dbSNP": url}


# ---------- [2] Aliases (Person A) ----------

class Alias(BaseModel):
    name: str  # "V600E"
    type: Literal["rsid", "protein_short", "protein_long", "dna"]
    derived_from: str  # "p.Val600Glu (MyVariant)"


class Aliases(BaseModel):
    gene: str | None = None
    names: list[Alias] = []
    pubmed_terms: list[str] = []  # ['"BRAF V600E"', ..., "rs113488022"]
    trial_terms: list[str] = []  # ["BRAF V600E", ..., "BRAF V600"]


# ---------- [3] Papers (Person A) ----------

class Paper(BaseModel):
    pmid: str
    title: str
    abstract: str = ""
    journal: str | None = None
    year: int | None = None
    authors: list[str] = []
    publication_types: list[str] = []
    url: str  # https://pubmed.ncbi.nlm.nih.gov/{pmid}/
    score: int = 0
    score_reasons: list[str] = []
    sent_to_ai: bool = False


class PaperResults(BaseModel):
    papers: list[Paper] = []
    total_count: int | None = None
    search_url: str | None = None


# ---------- [4] Trials (Person B) ----------

class Trial(BaseModel):
    nct_id: str
    title: str
    brief_summary: str = ""
    phases: list[str] = []  # ["PHASE2"], may be empty
    status: str | None = None  # "RECRUITING"
    conditions: list[str] = []
    interventions: list[str] = []
    sponsor: str | None = None
    start_date: str | None = None
    enrollment: int | None = None
    eligibility_text: str = ""
    matched_terms: list[str] = []
    has_results: bool = False
    randomized: bool | None = None  # None when ClinicalTrials.gov doesn't say
    url: str  # https://clinicaltrials.gov/study/{nct_id}
    score: int = 0
    score_reasons: list[str] = []
    sent_to_ai: bool = False


class TrialStats(BaseModel):
    total_found: int = 0
    returned: int = 0
    by_phase: dict[str, int] = {}
    by_status: dict[str, int] = {}
    top_drugs: list[tuple[str, int]] = []
    search_urls: dict[str, str] = {}  # {search term: ClinicalTrials.gov search link}


class TrialResults(BaseModel):
    trials: list[Trial] = []
    stats: TrialStats = TrialStats()


# ---------- [5] Eligibility (Person B) ----------

class Criterion(BaseModel):
    nct_id: str
    kind: Literal["inclusion", "exclusion"]
    category: Literal[
        "biomarker_required", "biomarker_excluded", "testing_method", "prior_therapy", "other_biomarker"
    ]
    text: str  # original sentence, word for word
    url: str


# ---------- [6] AI treatment table (Person B) ----------

EscatTier = Literal["I-A", "I-B", "I-C", "II-A", "II-B", "III-A", "III-B", "IV", "V"]


class Evidence(BaseModel):
    source_id: str  # "PMID:27080216" or "NCT01336634"
    quote: str  # copied word for word from the source
    url: str


class TreatmentRow(BaseModel):
    drug: str
    setting: str
    outcome: str
    escat_tier: EscatTier
    escat_reason: str
    evidence: list[Evidence] = Field(min_length=1)
    verified: bool = False  # all checks passed
    warnings: list[str] = []  # e.g. "tier not supported", "number 64 not found in quotes"


class RemovedRow(BaseModel):
    drug: str
    reason: str  # "quote not found in PMID:12345678"


class TreatmentResults(BaseModel):
    rows: list[TreatmentRow] = []
    removed: list[RemovedRow] = []


# ---------- Final output ----------

SectionStatus = Literal["ok", "empty", "error", "skipped"]


class Brief(BaseModel):
    rsid: str
    generated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    variant: Variant | None = None
    aliases: Aliases | None = None
    papers: PaperResults = PaperResults()
    trials: TrialResults = TrialResults()
    eligibility: list[Criterion] = []
    treatments: TreatmentResults = TreatmentResults()
    status: dict[str, SectionStatus] = {}
    warnings: list[str] = []
    disclaimer: str = DISCLAIMER
