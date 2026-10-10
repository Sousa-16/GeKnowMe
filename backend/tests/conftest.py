import json
from pathlib import Path

import pytest

from app.schemas import Alias, Aliases

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> tuple[list[dict], int]:
    data = json.loads((FIXTURES / name).read_text())
    return data["studies"], data["totalCount"]


@pytest.fixture
def braf_aliases() -> Aliases:
    return Aliases(
        gene="BRAF",
        names=[
            Alias(name="rs113488022", type="rsid", derived_from="input"),
            Alias(name="V600E", type="protein_short", derived_from="p.Val600Glu (MyVariant)"),
            Alias(name="p.Val600Glu", type="protein_long", derived_from="MyVariant"),
        ],
        trial_terms=["BRAF V600E", "BRAF V600"],
    )
