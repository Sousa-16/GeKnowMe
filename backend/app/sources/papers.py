"""[3] Papers - Person A. See docs/PLAN.md section 5, step 3, and section 4 (scoring)."""

from ..schemas import Aliases, Paper, PaperResults


async def fetch_papers(aliases: Aliases) -> PaperResults:
    raise NotImplementedError


def score_papers(papers: list[Paper], aliases: Aliases, drug_names: list[str]) -> list[Paper]:
    """Set score, score_reasons and sent_to_ai (top 50). drug_names come from the trials."""
    raise NotImplementedError
