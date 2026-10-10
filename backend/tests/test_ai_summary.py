import pytest
from google.genai import errors

from app import config
from app.schemas import Paper, Trial, Variant
from app.sources import ai_summary as ai


def _paper(pmid="111", sent=True):
    return Paper(pmid=pmid, title="Dabrafenib plus trametinib in BRAF V600E melanoma",
                 abstract="The overall response rate was 64% and median progression-free survival was 11.0 months.",
                 publication_types=["Randomized Controlled Trial"], url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                 sent_to_ai=sent)


def _trial():
    return Trial(nct_id="NCT00000001", title="Encorafenib study", phases=["PHASE2"], status="RECRUITING",
                 url="https://clinicaltrials.gov/study/NCT00000001", sent_to_ai=True)


GOOD = ai.AIOutput(rows=[ai.AIRow(
    drug="Dabrafenib + trametinib", setting="Melanoma", outcome="ORR 64%, median PFS 11.0 months",
    escat_tier="I-A", escat_reason="Randomized trial with survival benefit",
    evidence=[ai.AIEvidence(source_id="PMID:111",
                            quote="The overall response rate was 64% and median progression-free survival was 11.0 months")],
)])


class FakeModels:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    async def generate_content(self, model, contents, config):
        self.calls.append(model)
        out = self.outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        return type("Resp", (), {"parsed": out, "text": out.model_dump_json(), "usage_metadata": None})()


class FakeClient:
    def __init__(self, outcomes):
        self.aio = type("Aio", (), {})()
        self.aio.models = FakeModels(outcomes)


def _busy():
    return errors.APIError(503, {"error": {"code": 503, "message": "overloaded", "status": "UNAVAILABLE"}})


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch, tmp_path):
    async def instant(_):
        return None
    monkeypatch.setattr(ai.asyncio, "sleep", instant)
    monkeypatch.setattr(ai, "CACHE_DIR", tmp_path)


def test_select_sources_uses_sent_to_ai_and_skips_missing_abstracts():
    papers = [_paper("111"), _paper("222", sent=False), Paper(pmid="333", title="x", url="u", sent_to_ai=True)]
    docs = ai.select_sources(papers, [_trial()])
    assert set(docs) == {"PMID:111", "NCT00000001"}
    assert docs["PMID:111"].is_randomized


def test_prompt_contains_sources_and_rules():
    docs = ai.select_sources([_paper()], [_trial()])
    prompt = ai.build_prompt(Variant(rsid="rs113488022", gene="BRAF"), _aliases(), docs)
    assert "[PMID:111]" in prompt and "[NCT00000001]" in prompt and "WORD FOR WORD" in prompt and "I-A:" in prompt


async def test_retries_then_falls_back(monkeypatch):
    client = FakeClient([_busy(), _busy(), _busy(), GOOD])
    out = await ai.call_gemini("p", client=client)
    assert out == GOOD
    assert client.aio.models.calls == [config.GEMINI_MODEL] * 3 + [config.GEMINI_FALLBACK_MODEL]


async def test_gives_friendly_error_when_everything_fails():
    client = FakeClient([_busy()] * 5)
    with pytest.raises(ai.AISummaryError, match="busy or over quota"):
        await ai.call_gemini("p", client=client)


async def test_summarize_runs_proof_check_and_caches(monkeypatch):
    calls = []

    async def fake_call(prompt):
        calls.append(prompt)
        return GOOD
    monkeypatch.setattr(ai, "call_gemini", fake_call)
    args = (Variant(rsid="rs113488022", gene="BRAF"), _aliases(), [_paper()], [_trial()])
    res = await ai.summarize_treatments(*args)
    assert len(res.rows) == 1 and res.rows[0].verified
    await ai.summarize_treatments(*args)
    assert len(calls) == 1  # second run came from the cache


async def test_no_sources_means_no_call(monkeypatch):
    async def boom(prompt):
        raise AssertionError("should not call Gemini")
    monkeypatch.setattr(ai, "call_gemini", boom)
    res = await ai.summarize_treatments(Variant(rsid="rs1"), _aliases(), [], [])
    assert res.rows == []


def _aliases():
    from app.schemas import Alias, Aliases
    return Aliases(gene="BRAF", names=[Alias(name="V600E", type="protein_short", derived_from="x")])
