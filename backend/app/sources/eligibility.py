"""[5] Eligibility - Person B. See docs/PLAN.md section 5, step 5.

Rule-based (no AI): split each trial's criteria into inclusion/exclusion, split those into single
rules, keep the biomarker-related ones, and put each in a category.
"""

import re

from ..schemas import Aliases, Criterion, Trial

MAX_PER_TRIAL = 8

_HEADER = re.compile(
    r"^\s*(?:key\s+|main\s+|additional\s+|general\s+)?(inclusion|exclusion)\s+criteria\b[^\n]*$",
    re.IGNORECASE | re.MULTILINE,
)
_BULLET = re.compile(r"^\s*(?:[*\-•·▪◦]|\d{1,3}[.)]|[a-z][.)]|\(?[ivx]{1,4}\))\s+", re.IGNORECASE)

TESTING_WORDS = [
    "ngs", "next-generation sequencing", "next generation sequencing", "sequencing", "pcr",
    "ctdna", "cfdna", "liquid biopsy", "plasma", "tissue", "biopsy", "central lab", "central laboratory",
    "local lab", "local laboratory", "local assay", "fda-approved test", "fda approved test",
    "companion diagnostic", "assay", "clia", "validated test", "archival", "tumor sample", "tumour sample",
]
ALTERATION_WORDS = [
    "mutation", "mutant", "mutated", "alteration", "variant", "fusion", "amplification", "rearrangement",
    "wild-type", "wild type", "wildtype", "co-mutation", "biomarker",
]
THERAPY_WORDS = ["inhibitor", "targeted", "therapy", "therapies", "treatment", "treated", "regimen", "agent"]
# Other common cancer biomarkers (case-sensitive gene symbols)
OTHER_MARKERS = ["EGFR", "ALK", "ROS1", "KRAS", "NRAS", "HRAS", "BRAF", "MET", "RET", "NTRK", "HER2", "ERBB2",
                 "PIK3CA", "BRCA1", "BRCA2", "IDH1", "IDH2", "FGFR", "KIT", "PDGFRA", "MSI", "dMMR", "PD-L1", "TMB"]
PRIOR_WORDS = ["prior", "previous", "previously", "received", "pretreated", "pre-treated", "treated with", "progressed on"]


def split_sections(text: str) -> tuple[str, str]:
    """Return (inclusion text, exclusion text). Text before any header counts as inclusion."""
    inclusion, exclusion = [], []
    current = inclusion
    pos = 0
    for m in _HEADER.finditer(text or ""):
        current.append(text[pos:m.start()])
        current = inclusion if m.group(1).lower() == "inclusion" else exclusion
        pos = m.end()
    current.append((text or "")[pos:])
    return "\n".join(inclusion).strip(), "\n".join(exclusion).strip()


def split_rules(section: str) -> list[str]:
    """Split a section into single rules: one per bullet/number, or per paragraph."""
    rules: list[str] = []
    buf: list[str] = []

    def flush():
        if buf:
            rule = " ".join(buf).strip()
            if rule:
                rules.append(rule)
            buf.clear()

    for line in (section or "").splitlines():
        if not line.strip():
            flush()
            continue
        if _BULLET.match(line):
            flush()
            line = _BULLET.sub("", line, count=1)
        buf.append(line.strip())
    flush()
    # Drop lead-in lines such as "Patients must meet all of the following:"
    return [r for r in rules if not (r.endswith(":") and len(r) < 80)]


def _has(text: str, words: list[str]) -> bool:
    return any(w in text for w in words)


def _mutation_patterns(aliases: Aliases) -> list[re.Pattern]:
    names = {a.name for a in aliases.names if a.type in ("protein_short", "rsid")}
    # Codon-level form: V600E -> V600 (trials often say "BRAF V600 mutation")
    names |= {m.group(1) for n in list(names) if (m := re.match(r"^([A-Z]\d+)[A-Z*]$", n))}
    # Only digits are excluded before the name, so "KRASG12C" still matches "G12C"
    return [re.compile(rf"(?<![0-9]){re.escape(n)}(?![0-9])", re.IGNORECASE) for n in names]


def categorize(rule: str, kind: str, gene: str | None, mutation_res: list[re.Pattern]) -> str | None:
    """Return the category, or None if the rule isn't biomarker-related.

    Priority (most specific first): prior_therapy > biomarker_required/excluded > testing_method
    > other_biomarker.
    """
    low = rule.lower()
    mentions_gene = bool(gene) and re.search(rf"(?<![A-Za-z0-9]){re.escape(gene)}(?![a-z])", rule, re.IGNORECASE)
    mentions_mutation = any(p.search(rule) for p in mutation_res)
    mentions_alteration = _has(low, ALTERATION_WORDS)
    mentions_testing = _has(low, TESTING_WORDS)

    if _has(low, PRIOR_WORDS) and _has(low, THERAPY_WORDS) and (
        mentions_gene or mentions_mutation or "inhibitor" in low or "targeted" in low
    ):
        return "prior_therapy"
    if mentions_mutation or (mentions_gene and mentions_alteration):
        return "biomarker_required" if kind == "inclusion" else "biomarker_excluded"
    if mentions_testing and mentions_gene:
        return "testing_method"
    other_marker = any(re.search(rf"(?<![A-Za-z0-9]){m}(?![A-Za-z0-9])", rule) for m in OTHER_MARKERS)
    if mentions_alteration and other_marker:
        return "biomarker_excluded" if kind == "exclusion" else "other_biomarker"
    if kind == "exclusion" and mentions_alteration and ("wild" in low or "known" in low or "driver" in low):
        return "biomarker_excluded"
    return None


def extract_criteria(trials: list[Trial], aliases: Aliases) -> list[Criterion]:
    mutation_res = _mutation_patterns(aliases)
    out: list[Criterion] = []
    for trial in trials:
        inclusion, exclusion = split_sections(trial.eligibility_text)
        found: list[Criterion] = []
        seen: set[str] = set()
        for kind, section in (("inclusion", inclusion), ("exclusion", exclusion)):
            for rule in split_rules(section):
                category = categorize(rule, kind, aliases.gene, mutation_res)
                key = rule.lower()
                if category and key not in seen:
                    seen.add(key)
                    found.append(
                        Criterion(nct_id=trial.nct_id, kind=kind, category=category, text=rule, url=trial.url)
                    )
        out.extend(found[:MAX_PER_TRIAL])
    return out
