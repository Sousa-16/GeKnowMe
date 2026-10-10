"""The API (docs/PLAN.md section 6).

Run from backend/:  .venv/bin/uvicorn app.main:app --reload
Then open http://localhost:8000/docs
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .pipeline import InvalidRsid, build_brief, build_treatments
from .schemas import Brief, TreatmentsResponse
from .sources.variant import VariantNotFound

app = FastAPI(title="Variant Trial Scope API", version="0.1.0")


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "gemini_key_set": bool(config.GEMINI_API_KEY),
        "ncbi_key_set": bool(config.NCBI_API_KEY),
        "model": config.GEMINI_MODEL,
    }


@app.get("/api/brief/{rsid}", response_model=Brief)
async def get_brief(rsid: str, refresh: bool = False, include_ai: bool = True):
    """The full brief. include_ai=false returns in ~1-2 s with treatments "pending";
    then call /api/brief/{rsid}/treatments. refresh=true skips the pre-generated demo briefs."""
    try:
        return await build_brief(rsid, include_ai=include_ai, use_demo=not refresh)
    except InvalidRsid as e:
        raise HTTPException(status_code=400, detail=str(e))
    except VariantNotFound as e:
        raise HTTPException(status_code=404, detail=str(e) or "rs number not found")


@app.get("/api/brief/{rsid}/treatments", response_model=TreatmentsResponse)
async def get_treatments(rsid: str, refresh: bool = False):
    """Only the AI treatment table (slow: 10-90 s depending on Gemini load)."""
    try:
        return await build_treatments(rsid, use_demo=not refresh)
    except InvalidRsid as e:
        raise HTTPException(status_code=400, detail=str(e))
    except VariantNotFound as e:
        raise HTTPException(status_code=404, detail=str(e) or "rs number not found")


# Serve the built website (frontend/dist) from the same service, so the live app is one URL.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def website(path: str):
        file = (FRONTEND_DIST / path).resolve()
        if path and file.is_file() and FRONTEND_DIST in file.parents:
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")
