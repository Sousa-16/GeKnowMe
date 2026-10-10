"""[4] Trials - Person B. See docs/PLAN.md section 5, step 4, and section 4 (scoring)."""

from ..schemas import Aliases, TrialResults


async def fetch_trials(aliases: Aliases) -> TrialResults:
    """Search, merge, score (sets score, score_reasons, sent_to_ai for the top 30) and build stats."""
    raise NotImplementedError
