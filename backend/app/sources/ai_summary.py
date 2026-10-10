"""[6] AI treatment table - Person B. See docs/PLAN.md section 5, step 6.

Sends the top papers/trials (sent_to_ai=True) to Gemini, asks for treatment rows where every claim
carries a source ID and a word-for-word quote, then runs every row through proof_check.
"""

import asyncio
import hashlib
import json
import logging
from pathlib import Path

import httpx
from google import genai
from google.genai import errors, types
from pydantic import BaseModel

from .. import config
from ..schemas import Aliases, Paper, Trial, TreatmentResults, Variant
from .proof_check import LAB_WORDS, RCT_TYPES, RawEvidence, RawRow, SourceDoc, check_rows
from .trials import phase_label, status_label

log = logging.getLogger(__name__)

CACHE_DIR = config.BACKEND_DIR / ".cache" / "ai"
ABSTRACT_CHARS = 1800
SUMMARY_CHARS = 900
RETRYABLE = {429, 500, 502, 503, 504}


class AISummaryError(Exception):
    """Gemini could not produce a table (no key, quota, outage)."""


# ---------- what we ask Gemini to return ----------

class AIEvidence(BaseModel):
    source_id: str
    quote: str


class AIRow(BaseModel):
    drug: str
    setting: str
    outcome: str
    escat_tier: str
    escat_reason: str
    evidence: list[AIEvidence]


class AIOutput(BaseModel):
    rows: list[AIRow]


# ---------- B17: sources ----------

def _paper_doc(p: Paper) -> SourceDoc:
    types_low = {t.lower() for t in p.publication_types}
    clinical = any("clinical trial" in t or "randomized" in t for t in types_low)
    text_low = f"{p.title} {p.abstract}".lower()
    return SourceDoc(
        source_id=f"PMID:{p.pmid}",
        url=p.url,
        text=f"{p.title}\n{p.abstract[:ABSTRACT_CHARS]}",
        is_randomized=bool(types_low & RCT_TYPES),
        is_clinical_trial=clinical,
        is_lab_only=not clinical and any(w in text_low for w in LAB_WORDS),
    )


def _trial_doc(t: Trial) -> SourceDoc:
    randomized = {True: "yes", False: "no"}.get(t.randomized, "not stated")
    text = (
        f"{t.title}\n"
        f"Phase: {phase_label(t.phases)}. Status: {status_label(t.status)}. Randomized: {randomized}. "
        f"Results posted: {'yes' if t.has_results else 'no'}.\n"
        f"Interventions: {', '.join(t.interventions) or 'not listed'}.\n"
        f"Conditions: {', '.join(t.conditions) or 'not listed'}.\n"
        f"{t.brief_summary[:SUMMARY_CHARS]}"
    )
    is_trial = any(ph not in ("NA",) for ph in t.phases)
    return SourceDoc(source_id=t.nct_id, url=t.url, text=text, is_randomized=bool(t.randomized),
                     is_clinical_trial=is_trial)


def select_sources(papers: list[Paper], trials: list[Trial]) -> dict[str, SourceDoc]:
    """Papers/trials marked sent_to_ai. If scoring hasn't run yet, fall back to the first ones."""
    chosen_papers = [p for p in papers if p.sent_to_ai] or papers[: config.AI_PAPERS]
    chosen_trials = [t for t in trials if t.sent_to_ai] or trials[: config.AI_TRIALS]
    docs = [_paper_doc(p) for p in chosen_papers if p.abstract.strip()]
    docs += [_trial_doc(t) for t in chosen_trials]
    return {d.source_id: d for d in docs}


# ---------- B18: instructions ----------

ESCAT_TABLE = """\
I-A: randomized trial(s) in this cancer type show a clinically meaningful SURVIVAL improvement
I-B: non-randomized prospective trial(s) in this cancer type show clinically meaningful benefit
I-C: trials across several cancer types (e.g. basket trials) show similar benefit across them
II-A: retrospective studies show benefit compared with patients without the mutation
II-B: prospective trial(s) show higher response rates, but no survival data yet
III-A: benefit shown for this mutation, but in a DIFFERENT cancer type than this row's setting
III-B: a similar mutation in the same gene/pathway has evidence; this one does not yet
IV: only lab/animal (preclinical) evidence
V: objective responses, but no clinically meaningful benefit alone"""


def build_prompt(variant: Variant, aliases: Aliases, sources: dict[str, SourceDoc]) -> str:
    mutations = ", ".join(a.name for a in aliases.names if a.type == "protein_short") or ", ".join(variant.hgvs_p)
    blocks = "\n\n".join(f"[{d.source_id}]\n{d.text}" for d in sources.values())
    return f"""You are helping clinical trial planners (not patients) scope a new trial.
Variant: {variant.rsid}, gene {variant.gene or aliases.gene or 'unknown'}, mutation(s): {mutations}.

Task: build a table of treatments that have been tested for this mutation, using ONLY the sources below.

Rules:
1. Use only the sources below. Do not use outside knowledge. If the sources don't support a claim, leave it out.
2. One row = one drug or drug combination in one cancer type/setting. Merge duplicates. 5 to 15 rows, strongest evidence first.
3. "outcome": a short factual phrase. Use numbers exactly as written in the source (e.g. "ORR 64%, median PFS 10.9 months"). For trials without results, write e.g. "Ongoing phase 3, no results posted".
4. "evidence": 1 to 3 items. "source_id" exactly as shown in brackets (e.g. "PMID:12345678" or "NCT01234567"). "quote" must be copied WORD FOR WORD from that source: one continuous passage of 5 to 40 words, no paraphrasing, no added words. Every number in "outcome" must appear in one of the quotes.
5. "escat_tier": one of the ESMO ESCAT tiers below, judged only from the cited sources. "escat_reason": one sentence explaining the tier from the cited sources.

ESCAT tiers (Mateo et al., Annals of Oncology 2018):
{ESCAT_TABLE}

SOURCES:

{blocks}
"""


# ---------- B19/B22: calling Gemini ----------

def _retryable(exc: Exception) -> bool:
    if isinstance(exc, errors.APIError):
        return exc.code in RETRYABLE
    return isinstance(exc, (httpx.TimeoutException, httpx.TransportError, asyncio.TimeoutError))


async def _generate(client: genai.Client, model: str, prompt: str) -> AIOutput:
    resp = await client.aio.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=AIOutput,
            temperature=0.2,
            http_options=types.HttpOptions(timeout=120_000),
        ),
    )
    if usage := getattr(resp, "usage_metadata", None):
        log.info("gemini %s tokens: in=%s out=%s", model, usage.prompt_token_count, usage.candidates_token_count)
    if isinstance(resp.parsed, AIOutput):
        return resp.parsed
    return AIOutput.model_validate_json(resp.text or '{"rows": []}')


async def call_gemini(prompt: str, client: genai.Client | None = None) -> AIOutput:
    """Main model up to 3 tries, then the backup model up to 2 tries."""
    if not config.GEMINI_API_KEY and client is None:
        raise AISummaryError("Gemini API key not configured")
    client = client or genai.Client(api_key=config.GEMINI_API_KEY)
    last: Exception | None = None
    for model, tries in ((config.GEMINI_MODEL, 3), (config.GEMINI_FALLBACK_MODEL, 2)):
        for attempt in range(tries):
            try:
                return await _generate(client, model, prompt)
            except Exception as e:  # noqa: BLE001
                last = e
                log.warning("gemini %s attempt %d failed: %s", model, attempt + 1, str(e)[:200])
                if not _retryable(e):
                    break  # e.g. bad model name or bad request: go straight to the backup model
                await asyncio.sleep(2 * (attempt + 1))
    code = getattr(last, "code", None)
    reason = "busy or over quota" if code in (429, 503) else f"{type(last).__name__}"
    raise AISummaryError(f"Gemini is unavailable right now ({reason}); try again in a minute")


# ---------- B23: cache ----------

def _cache_path(prompt: str) -> Path:
    return CACHE_DIR / f"{hashlib.sha256(prompt.encode()).hexdigest()[:32]}.json"


def _cache_get(prompt: str) -> AIOutput | None:
    try:
        return AIOutput.model_validate_json(_cache_path(prompt).read_text())
    except (OSError, ValueError):
        return None


def _cache_set(prompt: str, out: AIOutput) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(prompt).write_text(out.model_dump_json())
    except OSError:
        pass


# ---------- main entry ----------

async def summarize_treatments(
    variant: Variant, aliases: Aliases, papers: list[Paper], trials: list[Trial]
) -> TreatmentResults:
    """Uses only papers/trials with sent_to_ai=True; runs every row through proof_check."""
    sources = select_sources(papers, trials)
    if not sources:
        return TreatmentResults()
    prompt = build_prompt(variant, aliases, sources)
    out = _cache_get(prompt)
    if out is None:
        out = await call_gemini(prompt)
        _cache_set(prompt, out)
    raw = [
        RawRow(r.drug, r.setting, r.outcome, r.escat_tier, r.escat_reason,
               [RawEvidence(e.source_id, e.quote) for e in r.evidence])
        for r in out.rows
    ]
    return check_rows(raw, sources)
