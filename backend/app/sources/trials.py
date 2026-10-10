"""[4] Trials - Person B. See docs/PLAN.md section 5, step 4, and section 4 (scoring)."""

import asyncio
import logging
import re
from collections import Counter
from datetime import date
from urllib.parse import quote

import httpx

from .. import config
from ..schemas import Aliases, Trial, TrialResults, TrialStats
from .eligibility import split_sections

log = logging.getLogger(__name__)

CTGOV_URL = "https://clinicaltrials.gov/api/v2/studies"
FIELDS = ",".join([
    "NCTId", "BriefTitle", "BriefSummary", "Phase", "OverallStatus", "Condition", "InterventionName",
    "InterventionType", "LeadSponsorName", "StartDate", "EnrollmentCount", "EligibilityCriteria",
    "DesignAllocation", "HasResults",
])
MAX_TERMS = 10
MIN_VARIANT_TRIALS = 5  # fewer variant-level matches than this -> also run the disease-level searches
PAGE_SIZE = 100
DRUG_TYPES = {"DRUG", "BIOLOGICAL", "COMBINATION_PRODUCT", "GENETIC"}
ACTIVE_STATUSES = {"RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION", "ACTIVE_NOT_RECRUITING"}
STATUS_RANK = {  # for display order: open trials first
    "RECRUITING": 0, "NOT_YET_RECRUITING": 1, "ENROLLING_BY_INVITATION": 1, "ACTIVE_NOT_RECRUITING": 2,
    "COMPLETED": 3, "UNKNOWN": 4, "SUSPENDED": 5, "TERMINATED": 5, "WITHDRAWN": 6,
}
PHASE_RANK = {"EARLY_PHASE1": 0.5, "PHASE1": 1, "PHASE2": 2, "PHASE3": 3, "PHASE4": 4}


class TrialSearchError(Exception):
    """ClinicalTrials.gov could not be reached for any search term."""


# ---------- B1/B3: searching ----------

async def _search(client: httpx.AsyncClient, term: str) -> tuple[list[dict], int]:
    """One search with retries. Returns (studies, totalCount)."""
    params = {"query.term": term, "fields": FIELDS, "pageSize": PAGE_SIZE, "countTotal": "true"}
    last = "unknown error"
    for attempt in range(3):
        try:
            resp = await client.get(CTGOV_URL, params=params)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("studies", []), int(data.get("totalCount") or 0)
            last = f"HTTP {resp.status_code}"
            if resp.status_code not in (429, 500, 502, 503, 504):
                break
        except (httpx.TimeoutException, httpx.TransportError, ValueError) as e:
            last = type(e).__name__
        await asyncio.sleep(0.5 * 2**attempt)
    raise TrialSearchError(f"ClinicalTrials.gov search for '{term}' failed ({last})")


def search_url(term: str) -> str:
    return f"https://clinicaltrials.gov/search?term={quote(term)}"


# ---------- B2: one study -> Trial ----------

def parse_study(study: dict) -> tuple[Trial, list[str]]:
    """Return the Trial plus its drug-type intervention names (for the top-drugs stat)."""
    p = study.get("protocolSection", {})
    ident = p.get("identificationModule", {})
    status = p.get("statusModule", {})
    design = p.get("designModule", {})
    arms = p.get("armsInterventionsModule", {})
    nct_id = ident.get("nctId", "")
    interventions = arms.get("interventions") or []
    allocation = design.get("designInfo", {}).get("allocation")
    trial = Trial(
        nct_id=nct_id,
        title=ident.get("briefTitle", ""),
        brief_summary=p.get("descriptionModule", {}).get("briefSummary", "") or "",
        phases=design.get("phases") or [],
        status=status.get("overallStatus"),
        conditions=p.get("conditionsModule", {}).get("conditions") or [],
        interventions=[i["name"] for i in interventions if i.get("name")],
        sponsor=p.get("sponsorCollaboratorsModule", {}).get("leadSponsor", {}).get("name"),
        start_date=status.get("startDateStruct", {}).get("date"),
        enrollment=design.get("enrollmentInfo", {}).get("count"),
        eligibility_text=p.get("eligibilityModule", {}).get("eligibilityCriteria", "") or "",
        has_results=bool(study.get("hasResults")),
        randomized={"RANDOMIZED": True, "NON_RANDOMIZED": False}.get(allocation),
        url=f"https://clinicaltrials.gov/study/{nct_id}",
    )
    drugs = [i["name"] for i in interventions if i.get("name") and i.get("type") in DRUG_TYPES]
    return trial, drugs


# ---------- B8: scoring (PLAN.md section 4) ----------

def _mutation_names(aliases: Aliases) -> list[str]:
    """Names that identify this exact variant in text: short protein names and nicknames/literature
    names (e.g. 'Factor V Leiden', 'C677T')."""
    return [a.name for a in aliases.names if a.type in ("protein_short", "common")]


def _mentions(text: str, names: list[str]) -> bool:
    return any(re.search(rf"(?<![0-9]){re.escape(n)}(?![0-9])", text, re.IGNORECASE) for n in names)


def _start_year(trial: Trial) -> int | None:
    m = re.match(r"(\d{4})", trial.start_date or "")
    return int(m.group(1)) if m else None


def score_trial(trial: Trial, aliases: Aliases, today: date | None = None) -> None:
    today = today or date.today()
    names = _mutation_names(aliases)
    score, reasons = 0, []

    def add(points: int, why: str):
        nonlocal score
        score += points
        reasons.append(f"{why} {points:+d}")

    if trial.randomized:
        add(2, "randomized")
    top_phase = max((PHASE_RANK.get(ph, 0) for ph in trial.phases), default=0)
    if top_phase >= 3:
        add(3, "phase 3+")
    elif top_phase >= 2:
        add(2, "phase 2")
    elif top_phase >= 0.5:
        add(1, "phase 1")
    if trial.has_results:
        add(4, "has posted results")
    if names:
        inclusion, exclusion = split_sections(trial.eligibility_text)
        in_title_or_inclusion = _mentions(trial.title, names) or _mentions(inclusion, names)
        if in_title_or_inclusion:
            add(3, "exact mutation in title/inclusion")
        elif _mentions(exclusion, names):
            add(-5, "mutation only in exclusion criteria")
    if trial.status in ACTIVE_STATUSES or trial.status == "COMPLETED":
        add(1, "completed or active")
    year = _start_year(trial)
    if year and today.year - year <= 5:
        add(1, "started in last 5 years")
    trial.score, trial.score_reasons = score, reasons


# ---------- B4/B5: ordering and stats ----------

def _sort_key(trial: Trial, names: list[str]):
    exact = _mentions(trial.title, names) or _mentions(split_sections(trial.eligibility_text)[0], names)
    top_phase = max((PHASE_RANK.get(ph, 0) for ph in trial.phases), default=0)
    return (not exact, STATUS_RANK.get(trial.status or "", 4), -top_phase, -(_start_year(trial) or 0))


def phase_label(phases: list[str]) -> str:
    nums = [p.replace("EARLY_PHASE", "Early ").replace("PHASE", "") for p in phases if p != "NA"]
    if not nums:
        return "N/A"
    if len(nums) == 1:
        n = nums[0]
        return f"Early Phase {n.split()[-1]}" if n.startswith("Early") else f"Phase {n}"
    return "Phase " + "/".join(n.split()[-1] for n in nums)


def status_label(status: str | None) -> str:
    return (status or "UNKNOWN").replace("_", " ").capitalize()


def build_stats(trials: list[Trial], drugs_by_trial: dict[str, list[str]], total_found: int,
                terms: list[str]) -> TrialStats:
    drug_counts: Counter = Counter()
    display: dict[str, str] = {}
    for t in trials:
        for d in {d.strip().lower() for d in drugs_by_trial.get(t.nct_id, [])}:
            if "placebo" in d or not d:
                continue
            drug_counts[d] += 1
            display.setdefault(d, next(x for x in drugs_by_trial[t.nct_id] if x.strip().lower() == d).strip())
    return TrialStats(
        total_found=total_found,
        returned=len(trials),
        by_phase=dict(Counter(phase_label(t.phases) for t in trials).most_common()),
        by_status=dict(Counter(status_label(t.status) for t in trials).most_common()),
        top_drugs=[(display[d], n) for d, n in drug_counts.most_common(10)],
        search_urls={term: search_url(term) for term in terms},
    )


# ---------- main entry ----------

async def fetch_trials(aliases: Aliases) -> TrialResults:
    """Search, merge, score (sets score, score_reasons, sent_to_ai for the top 30) and build stats."""
    terms = list(dict.fromkeys(aliases.trial_terms + aliases.extra_trial_terms))[:MAX_TERMS]
    fallback = [t for t in aliases.fallback_trial_terms if t not in terms]
    if not terms and not fallback:
        return TrialResults()
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "variant-trial-scope/0.1"}) as client:
        results = await asyncio.gather(*(_search(client, t) for t in terms), return_exceptions=True)
        found = {s.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
                 for r in results if not isinstance(r, BaseException) for s in r[0]}
        if fallback and len(found - {None}) < MIN_VARIANT_TRIALS:
            # Too few variant-specific trials (rare variant, or one trials don't name): add trials for
            # the gene + disease, clearly marked as disease-level matches.
            results += await asyncio.gather(*(_search(client, t) for t in fallback), return_exceptions=True)
            terms = terms + fallback
    return assemble(terms, results, aliases, disease_terms=set(fallback))


def assemble(terms: list[str], results: list, aliases: Aliases, disease_terms: set[str] | None = None) -> TrialResults:
    """Merge per-term search results into TrialResults. Separate from fetch_trials so tests can
    feed saved replies."""
    failures = [r for r in results if isinstance(r, BaseException)]
    if failures and len(failures) == len(results):
        raise TrialSearchError(f"ClinicalTrials.gov is unavailable right now ({failures[0]})")
    for f in failures:
        log.warning("trial search failed: %s", f)

    by_id: dict[str, Trial] = {}
    drugs_by_trial: dict[str, list[str]] = {}
    total_found = 0
    for term, res in zip(terms, results):
        if isinstance(res, BaseException):
            continue
        studies, total = res
        # Approximate: searches overlap, so we report the largest single-term count
        total_found = max(total_found, total)
        for study in studies:
            trial, drugs = parse_study(study)
            if not trial.nct_id:
                continue
            if trial.nct_id not in by_id:
                by_id[trial.nct_id] = trial
                drugs_by_trial[trial.nct_id] = drugs
            if term not in by_id[trial.nct_id].matched_terms:
                by_id[trial.nct_id].matched_terms.append(term)

    disease_terms = disease_terms or set()
    for t in by_id.values():
        t.disease_level = bool(t.matched_terms) and all(m in disease_terms for m in t.matched_terms)
    names = _mutation_names(aliases)
    # Variant-level matches first, then disease-level ones
    trials = sorted(by_id.values(), key=lambda t: (t.disease_level, _sort_key(t, names)))[: config.MAX_TRIALS]
    for t in trials:
        score_trial(t, aliases)
    # The AI only gets variant-level trials; disease-level ones are context for the planner
    for t in sorted((t for t in trials if not t.disease_level), key=lambda t: -t.score)[: config.AI_TRIALS]:
        t.sent_to_ai = True
    # Searches overlap, so the true total is unknown; it's at least the largest single search and at
    # least the number of distinct trials we merged.
    stats = build_stats(trials, drugs_by_trial, max(total_found, len(by_id)), terms)
    return TrialResults(trials=trials, stats=stats)
