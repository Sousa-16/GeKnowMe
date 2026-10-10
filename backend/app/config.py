import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
# .env may live in backend/ or in the repo root
load_dotenv(BACKEND_DIR / ".env")
load_dotenv(BACKEND_DIR.parent / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
GEMINI_FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash-lite")
NCBI_API_KEY = os.getenv("NCBI_API_KEY", "")

MAX_PAPERS = 200  # fetched and shown
MAX_TRIALS = 100
AI_PAPERS = 50  # sent to the AI (PLAN.md section 4)
AI_TRIALS = 30
