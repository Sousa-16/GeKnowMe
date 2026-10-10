"""Proof check - Person B. See docs/PLAN.md section 3 and section 5, step 6 (tier check).

Code, not the AI, decides whether each AI row is backed by its sources:
1. ID check:     every cited ID must be one we sent             -> else row removed
2. Quote check:  every quote must appear in that source's text   -> else row removed
3. Number check: every number in the outcome must be in a quote  -> else row kept, unverified
4. Tier check:   cited source types must support the ESCAT tier  -> else row kept, unverified
                 (cancer rows only; ESCAT is an oncology scale)
Every row also gets an Oxford CEBM evidence level computed here from the cited sources' designs,
which works for any disease.
"""

import re
import unicodedata
from dataclasses import dataclass, field

from ..schemas import Evidence, RemovedRow, TreatmentResults, TreatmentRow

RCT_TYPES = {"randomized controlled trial", "clinical trial, phase iii"}
LAB_WORDS = ["cell line", "cell lines", "mice", "mouse", "xenograft", "in vitro", "in vivo", "murine", "organoid"]
SURVIVAL_WORDS = [" survival ", " os ", " pfs ", " efs ", " dfs "]  # matched on normalized text
VALID_TIERS = {"I-A", "I-B", "I-C", "II-A", "II-B", "III-A", "III-B", "IV", "V"}
CANCER_WORDS = re.compile(
    r"cancer|carcinoma|tumou?r|neoplas|malignan|oncolog|lymphoma|leuka?emia|melanoma|sarcoma|glioma|"
    r"glioblastoma|myeloma|blastoma|mesothelioma|metasta|nsclc|sclc|crc|hcc|gist|aml|cll|cml|mds",
    re.IGNORECASE)


def ocebm_level_for_paper(publication_types: list[str], lab_only: bool) -> int | None:
    """OCEBM 2011 'Does this intervention help?' level from PubMed publication types (PLAN.md section 4)."""
    t = {x.lower() for x in publication_types}
    if t & {"systematic review", "meta-analysis"}:
        return 1
    if t & RCT_TYPES:
        return 2
    if t & {"clinical trial, phase ii", "clinical trial, phase i", "controlled clinical trial", "observational study",
            "clinical trial", "comparative study", "multicenter study"}:
        return 3
    if "case reports" in t:
        return 4
    return 5 if lab_only else None


def is_cancer_setting(setting: str, ai_says_cancer: bool) -> bool:
    return ai_says_cancer or bool(CANCER_WORDS.search(setting or ""))


@dataclass
class SourceDoc:
    """Exactly what the AI was shown for one source, plus what the tier check needs."""

    source_id: str  # "PMID:27080216" or "NCT01336634"
    url: str
    text: str
    is_randomized: bool = False
    is_clinical_trial: bool = False
    is_lab_only: bool = False
    ocebm_level: int | None = None
    _norm: str = field(default="", repr=False)

    @property
    def norm(self) -> str:
        if not self._norm:
            self._norm = normalize_text(self.text)
        return self._norm


@dataclass
class RawEvidence:
    source_id: str
    quote: str


@dataclass
class RawRow:
    drug: str
    setting: str
    outcome: str
    escat_tier: str | None
    escat_reason: str | None
    evidence: list[RawEvidence]
    is_cancer: bool = False


def normalize_text(text: str) -> str:
    """Lowercase, unify unicode, and turn every run of punctuation/whitespace into one space.
    Decimal points inside numbers are kept, so "10.9" doesn't become "10 9"."""
    text = unicodedata.normalize("NFKC", text or "").lower().replace("·", ".")
    text = re.sub(r"(?<=\d)\.(?=\d)", "\x00", text)
    text = re.sub(r"[^0-9a-z\x00]+", " ", text).replace("\x00", ".")
    return f" {' '.join(text.split())} "


def normalize_source_id(raw: str) -> str:
    s = (raw or "").strip().upper().replace(" ", "")
    if m := re.fullmatch(r"(?:PMID:?)?(\d{4,9})", s):
        return f"PMID:{m.group(1)}"
    if m := re.fullmatch(r"(NCT\d{8})", s):
        return m.group(1)
    return s


def quote_in_source(quote: str, doc: SourceDoc) -> bool:
    """True if the quote (or every piece of it, when the AI used '...') is in the source."""
    pieces = [p for p in re.split(r"\.\.\.|…|\[\.\.\.\]", quote) if len(normalize_text(p).split()) >= 2]
    if not pieces:
        return False
    return all(normalize_text(p) in doc.norm for p in pieces)


NUMBER_WORDS = {w: str(i) for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
    "seventeen eighteen nineteen twenty".split())}


def numbers_in(text: str, words: bool = False) -> list[str]:
    """Numbers in the text. With words=True, also "seven" -> "7" (sources often spell numbers out)."""
    text = (text or "").replace("·", ".")
    found = re.findall(r"\d+(?:\.\d+)?", text)
    if words:
        found += [NUMBER_WORDS[w] for w in re.findall(r"[a-z]+", text.lower()) if w in NUMBER_WORDS]
    return found


def _tier_problem(tier: str, docs: list[SourceDoc], quotes: list[str]) -> str | None:
    quotes_norm = " ".join(normalize_text(q) for q in quotes)
    if tier == "I-A":
        if not any(d.is_randomized for d in docs):
            return "tier not supported: I-A needs a randomized trial source"
        if not any(w in quotes_norm for w in SURVIVAL_WORDS):
            return "tier not supported: I-A needs a quote about survival"
    if tier in ("I-B", "I-C", "II-B") and not any(d.is_clinical_trial for d in docs):
        return f"tier not supported: {tier} needs a clinical trial source"
    if tier == "IV" and not all(d.is_lab_only for d in docs):
        return "tier not supported: IV should cite lab/animal studies only"
    return None


def mentions_variant(text: str, variant_names: list[str]) -> bool:
    """True if the text names the variant (e.g. 'E46K', 'p.Glu46Lys', 'rs104893875', 'Factor V Leiden')."""
    return any(re.search(rf"(?<![0-9A-Za-z]){re.escape(n)}(?![0-9])", text, re.IGNORECASE) for n in variant_names if n)


def check_rows(rows: list[RawRow], sources: dict[str, SourceDoc], variant_names: list[str] | None = None) -> TreatmentResults:
    """variant_names (from the aliases) let us flag rows whose sources never mention this variant."""
    result = TreatmentResults()
    for row in rows:
        drug = (row.drug or "").strip() or "(unnamed)"
        if not row.evidence:
            result.removed.append(RemovedRow(drug=drug, reason="no sources cited"))
            continue

        evidence: list[Evidence] = []
        docs: list[SourceDoc] = []
        problem = None
        for ev in row.evidence:
            sid = normalize_source_id(ev.source_id)
            doc = sources.get(sid)
            if doc is None:
                problem = f"cites a source we didn't provide ({ev.source_id})"
                break
            if not quote_in_source(ev.quote, doc):
                problem = f"quote not found in {sid}"
                break
            evidence.append(Evidence(source_id=sid, quote=ev.quote.strip(), url=doc.url))
            docs.append(doc)
        if problem:
            result.removed.append(RemovedRow(drug=drug, reason=problem))
            continue

        warnings: list[str] = []
        quote_numbers = set()
        for ev in evidence:
            quote_numbers.update(numbers_in(ev.quote, words=True))
        # Trial phases ("phase 1", "Phase II/III") aren't results, so they don't need a quote
        outcome_values = re.sub(r"phase\s*[0-9iv/\-]+", " ", row.outcome, flags=re.IGNORECASE)
        missing = [n for n in numbers_in(outcome_values) if n not in quote_numbers]
        if missing:
            warnings.append(f"number(s) {', '.join(missing)} not found in the quotes")

        cancer = is_cancer_setting(row.setting, row.is_cancer)
        tier: str | None = None
        if cancer:
            tier = (row.escat_tier or "").strip().upper()
            if not tier:
                warnings.append("cancer row without an ESCAT tier")
                tier = None
            elif tier not in VALID_TIERS:
                result.removed.append(RemovedRow(drug=drug, reason=f"invalid ESCAT tier '{row.escat_tier}'"))
                continue
            elif p := _tier_problem(tier, docs, [e.quote for e in evidence]):
                warnings.append(p)
        levels = [d.ocebm_level for d in docs if d.ocebm_level is not None]

        result.rows.append(TreatmentRow(
            drug=drug,
            setting=row.setting.strip(),
            outcome=row.outcome.strip(),
            is_cancer=cancer,
            ocebm_level=min(levels) if levels else None,
            variant_specific=any(mentions_variant(d.text, variant_names) for d in docs) if variant_names else None,
            escat_tier=tier,
            escat_reason=((row.escat_reason or "").strip() or None) if cancer else None,
            evidence=evidence,
            verified=not warnings,
            warnings=warnings,
        ))
    return result
