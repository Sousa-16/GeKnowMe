# Handoff: read this first in a new chat

Written 2026-10-11 ~01:40 ET. **Deadline: 10:00 AM ET today** (submit by ~9:30). Read this, then `docs/PLAN.md` for the design details.

## The project
HackRU 2026, **Regeneron track** (open-source tools for clinical trials; judged on utility, readiness, packaging).
Team of 2: the user is **Person B**, their brother is **Person A**. Repo: `github.com/Sousa-16/hackathon-26` (brother owns it; **still private**).
Name is a placeholder: **"Variant Trial Scope"** (in `frontend/index.html`, `App.tsx` APP_NAME, footer, `LICENSE`). Suggested: VariantScope. **Not decided yet.**

**What it does:** enter a dbSNP rs number → a cited "trial scoping brief" for trial planners (not patients):
1. Variant (MyVariant.info + ClinVar + NCBI LitVar2 literature names) → 2. Aliases (HGVS, short names, nicknames)
→ 3. PubMed papers (200, scored by Oxford CEBM) and 4. ClinicalTrials.gov trials (scored) → 5. eligibility rules
(rule-based) → 6. Gemini AI treatment table with a **code proof check** (cited ID real, quote word-for-word in
source, numbers in quote, ESCAT tier fits sources; cancer rows only get ESCAT, all rows get an Oxford level;
rows flagged "not specific to this variant" when no source names it). Website shows everything with links + CSV export.

## Current state (all on `main`, 180 tests passing)
- Backend: `backend/app/` (FastAPI). Person A files: `sources/variant.py, aliases.py, papers.py`. Person B: `sources/trials.py, eligibility.py, ai_summary.py, proof_check.py`. Shared: `schemas.py, pipeline.py, main.py, config.py`.
- Frontend: `frontend/` (React + TS + Tailwind + Vite, Three.js bead-helix landing page). Built into `frontend/dist`, served by FastAPI at `/`.
- API: `GET /api/brief/{rsid}?include_ai=false` (fast, ~3 s) then `GET /api/brief/{rsid}/treatments` (AI, 10–90 s). `?refresh=true` skips saved demos. `GET /api/health`.
- **Demo buttons:** BRAF V600E `rs113488022`, KRAS G12C `rs121913530`, CFTR F508del `rs113993960`, SNCA A53T `rs104893877` (Parkinson's / Lewy body dementia; user's grandfather had LBD, used as the personal opening of the pitch: the brief shows all evidence is preclinical). Also saved: EGFR `rs121434568`, SNCA E46K `rs104893875`, TTR V30M `rs28933979`. Saved briefs live in `backend/app/demo_data/` (instant, no AI). Regenerate: `cd backend && .venv/bin/python -m scripts.make_demo_briefs`.
- Tested on ~25 varied rs numbers (indels, intronic, non-cancer, fake). Fresh AI runs: 0 rows removed, ~75–90% rows fully verified, others flagged.
- `render.yaml` (Render Blueprint, one service, free plan) is written and the build/start commands were tested locally. **Not deployed yet.**
- `LICENSE` (MIT) added. **No top-level README yet.**

## Running it on the VM
- Server (detached, survives SSH disconnects): `cd backend && nohup setsid .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 > ../server.log 2>&1 < /dev/null &` · stop: `pkill -f "uvicorn app.main:app"` · it does not auto-reload; restart after backend changes; `cd frontend && npm run build` after frontend changes.
- User views it from their computer via `ssh -L 8000:localhost:8000 ubuntu@<vm>` → `http://localhost:8000/` (`?mock&rs=rs113488022` = bundled offline sample).
- Tests: `cd backend && .venv/bin/python -m pytest -q`. Headless browser for screenshots: scratchpad venv with Playwright (software WebGL is slow; use generous timeouts).
- Keys in repo-root `.env` (`GEMINI_API_KEY`, `NCBI_API_KEY`; spaces around `=` are fine). **Never print values.** Current Gemini key is a free-tier key (the old paid one cost $0.65; brother should get his own key). Models: main `gemini-3.5-flash` (LOW thinking, often 503 → retries), backup `gemini-3.5-flash-lite`.

## What's left (in order)
1. `git push` (main is 1 commit ahead).
2. Pick the **name** → update site, LICENSE, README.
3. **README** (problem, screenshots, how to run, proof check, data sources & standards OCEBM/ESCAT, limitations, disclaimer).
4. **Deploy on Render** (user creates account → New → Blueprint → repo → enter both keys). Consider Starter $7/mo for judging (free plan sleeps after 15 min, 30–60 s cold start); or free + keep-alive pinger. Then test the live link (demos, new variant, bad input, phone).
5. Brother makes the repo **public**.
6. **Slides** (10–12) and **3-min demo video** script (open with the Lewy body story on SNCA A53T, then BRAF as the main demo, show the proof check / quote highlighting / removed & flagged rows).
7. Submit (repo, live link, video, slides). Optional: update `docs/PLAN.md`, load test, keep-alive.

## Working with this user
- Do only what's asked; propose before big unrequested work (an early mistake: scaffolding/committing/installing without asking). Explain in simple terms, no weird analogies.
- They are fine with reasonable Gemini usage on the free key.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The user pushes (no GitHub credentials on the VM).
