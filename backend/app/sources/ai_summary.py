"""[6] AI treatment table - Person B. See docs/PLAN.md section 5, step 6."""

from ..schemas import Aliases, Paper, Trial, TreatmentResults, Variant


async def summarize_treatments(
    variant: Variant, aliases: Aliases, papers: list[Paper], trials: list[Trial]
) -> TreatmentResults:
    """Uses only papers/trials with sent_to_ai=True; runs every row through proof_check."""
    raise NotImplementedError
