"""Runs steps 1-6 in order (docs/PLAN.md section 1).

Any failure in a step becomes a warning and marks only that section; the brief is still returned.
Shared file: agree with your teammate before changing it.
"""

import asyncio
import logging
import re

from .schemas import Brief
from .sources import ai_summary, aliases, eligibility, papers, trials, variant

log = logging.getLogger(__name__)

RSID_RE = re.compile(r"^rs\d{1,12}$")


class InvalidRsid(ValueError):
    pass


def normalize_rsid(raw: str) -> str:
    rsid = raw.strip().lower()
    if rsid.isdigit():
        rsid = f"rs{rsid}"
    if not RSID_RE.match(rsid):
        raise InvalidRsid(f"'{raw}' is not a valid rs number. Expected something like rs113488022.")
    return rsid


def _fail(brief: Brief, section: str, exc: BaseException) -> None:
    if isinstance(exc, NotImplementedError):
        brief.status[section] = "skipped"
        brief.warnings.append(f"{section}: not built yet")
    else:
        log.exception("%s failed", section, exc_info=exc)
        brief.status[section] = "error"
        brief.warnings.append(f"{section}: failed ({type(exc).__name__}: {exc})")


async def build_brief(raw_rsid: str) -> Brief:
    """Raises InvalidRsid or variant.VariantNotFound. Everything else becomes a warning."""
    rsid = normalize_rsid(raw_rsid)
    brief = Brief(rsid=rsid)

    # [1] Variant: needed for everything else
    try:
        brief.variant = await variant.fetch_variant(rsid)
        brief.status["variant"] = "ok"
    except variant.VariantNotFound:
        raise
    except Exception as e:
        _fail(brief, "variant", e)
        return brief

    # [2] Aliases: needed for every search
    try:
        brief.aliases = aliases.build_aliases(brief.variant)
        brief.status["aliases"] = "ok"
    except Exception as e:
        _fail(brief, "aliases", e)
        return brief

    # [3] Papers and [4] Trials at the same time
    paper_res, trial_res = await asyncio.gather(
        papers.fetch_papers(brief.aliases),
        trials.fetch_trials(brief.aliases),
        return_exceptions=True,
    )
    if isinstance(trial_res, BaseException):
        _fail(brief, "trials", trial_res)
    else:
        brief.trials = trial_res
        brief.status["trials"] = "ok" if trial_res.trials else "empty"

    if isinstance(paper_res, BaseException):
        _fail(brief, "papers", paper_res)
    else:
        brief.papers = paper_res
        brief.status["papers"] = "ok" if paper_res.papers else "empty"
        # Scoring needs drug names from the trials (PLAN.md section 4)
        drug_names = [name for name, _ in brief.trials.stats.top_drugs]
        try:
            brief.papers.papers = papers.score_papers(brief.papers.papers, brief.aliases, drug_names)
        except Exception as e:
            _fail(brief, "paper_scoring", e)

    # [5] Eligibility
    try:
        brief.eligibility = eligibility.extract_criteria(brief.trials.trials, brief.aliases)
        brief.status["eligibility"] = "ok" if brief.eligibility else "empty"
    except Exception as e:
        _fail(brief, "eligibility", e)

    # [6] AI treatment table: only if there is something to cite
    if brief.papers.papers or brief.trials.trials:
        try:
            brief.treatments = await ai_summary.summarize_treatments(
                brief.variant, brief.aliases, brief.papers.papers, brief.trials.trials
            )
            brief.status["treatments"] = "ok" if brief.treatments.rows else "empty"
        except Exception as e:
            _fail(brief, "treatments", e)
    else:
        brief.status["treatments"] = "skipped"

    return brief
