"""Pre-generate the demo briefs (docs/PLAN.md task T3) into app/demo_data/.

Run from backend/ once every step works:  .venv/bin/python -m scripts.make_demo_briefs
Add rs numbers as arguments to generate others. Only complete briefs are saved unless --force.
"""

import asyncio
import sys

from app.pipeline import DEMO_DIR, build_brief

# Demo buttons: BRAF V600E, KRAS G12C (cancer), CFTR F508del (cystic fibrosis), SNCA A53T (Parkinson's / Lewy
# body dementia). Also saved: EGFR L858R, SNCA E46K, TTR V30M (instant if searched).
DEMO_RSIDS = ["rs113488022", "rs121913530", "rs113993960", "rs104893877",
              "rs121434568", "rs104893875", "rs28933979"]


async def main(rsids: list[str], force: bool) -> int:
    DEMO_DIR.mkdir(exist_ok=True)
    failed = 0
    for rsid in rsids:
        brief = await build_brief(rsid, use_demo=False)
        problems = {k: v for k, v in brief.status.items() if v not in ("ok", "empty")}
        summary = (f"{len(brief.papers.papers)} papers, {len(brief.trials.trials)} trials, "
                   f"{len(brief.eligibility)} criteria, {len(brief.treatments.rows)} AI rows "
                   f"({len(brief.treatments.removed)} removed)")
        if problems and not force:
            print(f"SKIPPED {rsid}: {problems} | {summary}")
            failed += 1
            continue
        (DEMO_DIR / f"{rsid}.json").write_text(brief.model_dump_json(indent=1), encoding="utf-8")
        print(f"saved {rsid}: {summary}" + (f" | problems: {problems}" if problems else ""))
    return failed


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    sys.exit(asyncio.run(main(args or DEMO_RSIDS, "--force" in sys.argv)))
