"""The API (docs/PLAN.md section 6).

Run from backend/:  .venv/bin/uvicorn app.main:app --reload
Then open http://localhost:8000/docs
"""

from fastapi import FastAPI, HTTPException

from . import config
from .pipeline import InvalidRsid, build_brief
from .schemas import Brief
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
async def get_brief(rsid: str, refresh: bool = False):
    # refresh=true will skip the cache once caching exists (PLAN.md step T3 / B23)
    try:
        return await build_brief(rsid)
    except InvalidRsid as e:
        raise HTTPException(status_code=400, detail=str(e))
    except VariantNotFound as e:
        raise HTTPException(status_code=404, detail=str(e) or "rs number not found")
