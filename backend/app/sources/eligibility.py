"""[5] Eligibility - Person B. See docs/PLAN.md section 5, step 5."""

from ..schemas import Aliases, Criterion, Trial


def extract_criteria(trials: list[Trial], aliases: Aliases) -> list[Criterion]:
    raise NotImplementedError
