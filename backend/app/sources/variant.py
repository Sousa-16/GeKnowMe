"""[1] Variant lookup - Person A. See docs/PLAN.md section 5, step 1."""

from ..schemas import Variant


class VariantNotFound(Exception):
    """The rs number is well-formed but MyVariant has no record of it."""


async def fetch_variant(rsid: str) -> Variant:
    raise NotImplementedError
