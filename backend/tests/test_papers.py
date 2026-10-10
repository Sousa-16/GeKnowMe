import json
import time
from datetime import date
from pathlib import Path

import httpx
import pytest

from app import config
from app.schemas import Alias, Aliases, Paper
from app.sources import papers as pp

FIXTURES = Path(__file__).parent / "fixtures"
REAL_CLIENT = httpx.AsyncClient  # saved before tests monkeypatch pp.httpx.AsyncClient


def esearch_fixture(tag: str) -> dict:
    return json.loads((FIXTURES / f"pubmed_esearch_{tag}.json").read_text(encoding="utf-8"))


def efetch_fixture(tag: str) -> str:
    return (FIXTURES / f"pubmed_efetch_{tag}.xml").read_text(encoding="utf-8")


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    """No real waiting in tests: the rate limiter and retry backoff become instant."""
    monkeypatch.setattr(pp.RateLimiter, "interval", staticmethod(lambda: 0.0))

    async def instant(_):
        return None
    monkeypatch.setattr(pp.asyncio, "sleep", instant)


# ---------- A13/A14: queries ----------

def test_build_query_tags_phrases_and_rsid(braf_aliases):
    braf_aliases.pubmed_terms = ['"BRAF V600E"', '"BRAF p.V600E"', '"V600E"', "rs113488022"]
    q = pp.build_query(braf_aliases)
    assert q == "(BRAF[tiab] AND V600E[tiab]) OR (BRAF[tiab] AND p.V600E[tiab]) OR V600E[tiab] OR rs113488022[All Fields]"


def test_candidate_queries_get_broader(braf_aliases):
    braf_aliases.pubmed_terms = ['"BRAF V600E"', "rs113488022"]
    qs = pp.candidate_queries(braf_aliases)
    assert len(qs) == 3
    assert qs[0] in qs[1] and qs[1] in qs[2]
    assert "BRAF[tiab] AND (V600[tiab])" in qs[1]
    assert "mutation[tiab]" in qs[2]


def test_no_gene_means_no_broadening():
    a = Aliases(names=[Alias(name="rs1", type="rsid", derived_from="input")], pubmed_terms=["rs1"])
    assert pp.candidate_queries(a) == ["rs1[All Fields]"]
    assert pp.candidate_queries(Aliases()) == []


def test_search_url_reruns_the_search():
    url = pp.search_url("(BRAF[tiab] AND V600E[tiab]) OR rs113488022[All Fields]")
    assert url.startswith("https://pubmed.ncbi.nlm.nih.gov/?term=")
    assert "%28BRAF%5Btiab%5D+AND+V600E%5Btiab%5D%29" in url and url.endswith("&sort=relevance")


# ---------- A15/A18: parsing saved replies ----------

def test_parse_esearch_keeps_relevance_order():
    ids, count = pp.parse_esearch(esearch_fixture("braf_v600e"))
    assert count == 7877 and len(ids) == 200
    assert ids[:3] == ["25744437", "27500726", "31309539"]
    assert len(set(ids)) == len(ids)


def test_parse_esearch_error():
    with pytest.raises(pp.PaperSearchError, match="rejected"):
        pp.parse_esearch({"esearchresult": {"ERROR": "bad query"}})


def test_parse_efetch_reads_all_fields():
    papers = pp.parse_efetch(efetch_fixture("braf_v600e"))
    by_id = {p.pmid: p for p in papers}
    assert len(papers) == 49  # 50 ids, one is a book chapter (PubmedBookArticle) and is skipped
    assert "40737458" not in by_id
    review = by_id["25744437"]
    assert review.title == "BRAF V600E mutation-specific antibody: A review"
    assert review.journal == "Semin Diagn Pathol" and review.year == 2015
    assert review.authors[:2] == ["Ritterhouse LL", "Barletta JA"] and len(review.authors) <= pp.MAX_AUTHORS
    assert review.publication_types == ["Journal Article", "Review"]
    assert review.url == "https://pubmed.ncbi.nlm.nih.gov/25744437/"
    assert len(review.abstract) > 1000
    # structured abstracts keep their section labels so the AI sees "RESULTS: ..."
    assert by_id["38598020"].abstract.startswith("BACKGROUND:") and "RESULTS:" in by_id["38598020"].abstract
    # editorials have no abstract; that's fine (they just never go to the AI)
    assert by_id["31309539"].abstract == ""
    assert all(p.year and p.journal for p in papers)


@pytest.mark.parametrize("tag, n", [("kras_g12c", 13), ("egfr_l858r", 15)])
def test_parse_other_demo_variants(tag, n):
    papers = pp.parse_efetch(efetch_fixture(tag))
    assert len(papers) == n
    assert all(p.pmid.isdigit() and p.title for p in papers)


def test_parse_efetch_handles_sparse_and_odd_xml():
    xml = """<PubmedArticleSet>
      <PubmedArticle><MedlineCitation><PMID>1</PMID><Article>
        <ArticleTitle>Only a <i>title</i>.</ArticleTitle>
        <Journal><JournalIssue><PubDate><MedlineDate>2015 Sep-Oct</MedlineDate></PubDate></JournalIssue>
                 <Title>Some Journal</Title></Journal>
      </Article></MedlineCitation></PubmedArticle>
      <PubmedArticle><MedlineCitation><Article/></MedlineCitation></PubmedArticle>
    </PubmedArticleSet>"""
    papers = pp.parse_efetch(xml)
    assert len(papers) == 1  # the one without a PMID is dropped
    p = papers[0]
    assert p.title == "Only a title" and p.year == 2015 and p.journal == "Some Journal"
    assert p.abstract == "" and p.authors == [] and p.publication_types == []


def test_parse_efetch_invalid_xml():
    with pytest.raises(pp.PaperSearchError):
        pp.parse_efetch("<not xml")


# ---------- fetch_papers with saved replies served by a fake PubMed ----------

class FakePubMed:
    """Answers esearch from the saved JSON (optionally with a changed count) and efetch from the
    saved XML. The design-restricted search ("[pt]" in the query) answers with `design_ids`.
    Records every query so tests can check broadening and batching."""

    def __init__(self, tag="braf_v600e", counts=None, fail_efetch_times=0):
        self.esearch = esearch_fixture(tag)
        self.ids = self.esearch["esearchresult"]["idlist"][:50]
        self.design_ids = self.ids[45:50][::-1] + ["999999999"]  # some overlap, one unknown id
        self.efetch_xml = efetch_fixture(tag)
        self.counts = list(counts or [])
        self.fail_efetch_times = fail_efetch_times
        self.queries: list[str] = []
        self.efetch_batches: list[list[str]] = []

    @property
    def general_queries(self):
        return [q for q in self.queries if "[pt]" not in q]

    def __call__(self, req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("esearch.fcgi"):
            term = req.url.params["term"]
            self.queries.append(term)
            data = json.loads(json.dumps(self.esearch))
            if "[pt]" in term:
                data["esearchresult"]["idlist"] = self.design_ids
                data["esearchresult"]["count"] = str(len(self.design_ids))
                assert req.url.params["retmax"] == str(pp.DESIGN_RETMAX)
            else:
                data["esearchresult"]["idlist"] = self.ids
                if self.counts:
                    data["esearchresult"]["count"] = str(self.counts.pop(0))
            return httpx.Response(200, json=data)
        assert req.url.path.endswith("efetch.fcgi")
        self.efetch_batches.append(req.url.params["id"].split(","))
        if self.fail_efetch_times:
            self.fail_efetch_times -= 1
            return httpx.Response(503)
        return httpx.Response(200, text=self.efetch_xml)

    def install(self, monkeypatch):
        def factory(**kw):
            kw.pop("timeout", None)
            return REAL_CLIENT(transport=httpx.MockTransport(self), **kw)
        monkeypatch.setattr(pp.httpx, "AsyncClient", factory)
        return self


async def test_fetch_papers_batches_dedupes_and_keeps_order(monkeypatch, braf_aliases):
    braf_aliases.pubmed_terms = ['"BRAF V600E"', "rs113488022"]
    fake = FakePubMed().install(monkeypatch)
    monkeypatch.setattr(pp, "BATCH", 25)
    res = await pp.fetch_papers(braf_aliases)
    assert len(fake.general_queries) == 1  # 7877 results: no broadening
    assert len(fake.queries) == 2  # plus the design-restricted search
    assert fake.queries[1] == f"({fake.queries[0]}) AND ({pp.DESIGN_FILTER})"
    # 6 design ids + 50 general, minus 5 overlapping = 51 ids -> batches of 25, 25, 1
    assert [len(b) for b in fake.efetch_batches] == [25, 25, 1]
    pmids = [p.pmid for p in res.papers]
    assert len(pmids) == len(set(pmids)) == 49  # the fake returns all 49 for each batch; counted once
    design_known = [i for i in fake.design_ids if i in set(pmids)]
    assert pmids[: len(design_known)] == design_known  # design-restricted hits first, in their order
    rest = pmids[len(design_known):]
    assert rest == [i for i in fake.ids if i in set(rest)]  # then PubMed relevance order
    assert res.total_count == 7877
    assert res.search_url == pp.search_url(fake.queries[0])
    assert all(not p.score and not p.sent_to_ai for p in res.papers)  # scoring happens later


async def test_fetch_papers_broadens_when_few_results(monkeypatch, braf_aliases):
    braf_aliases.pubmed_terms = ['"BRAF V600E"']
    fake = FakePubMed(counts=[3, 150]).install(monkeypatch)
    res = await pp.fetch_papers(braf_aliases)
    assert len(fake.general_queries) == 2
    assert "BRAF[tiab] AND (V600[tiab])" in fake.general_queries[1]
    assert fake.queries[-1].startswith(f"({fake.general_queries[1]}) AND (")  # design search uses the broad query
    assert res.total_count == 150 and res.search_url == pp.search_url(fake.general_queries[1])


async def test_fetch_papers_gives_up_after_all_broadening(monkeypatch, braf_aliases):
    braf_aliases.pubmed_terms = ['"BRAF V600E"']
    fake = FakePubMed(counts=[1, 2, 3]).install(monkeypatch)
    res = await pp.fetch_papers(braf_aliases)
    assert len(fake.general_queries) == 3 and res.total_count == 3 and res.papers


async def test_fetch_papers_retries_server_errors(monkeypatch, braf_aliases):
    braf_aliases.pubmed_terms = ['"BRAF V600E"']
    fake = FakePubMed(fail_efetch_times=2).install(monkeypatch)
    res = await pp.fetch_papers(braf_aliases)
    assert len(fake.efetch_batches) == 3 and len(res.papers) == 49  # 2 failures + 1 success, one batch


async def test_fetch_papers_reports_outage(monkeypatch, braf_aliases):
    braf_aliases.pubmed_terms = ['"BRAF V600E"']
    FakePubMed(fail_efetch_times=99).install(monkeypatch)
    with pytest.raises(pp.PaperSearchError, match="HTTP 503"):
        await pp.fetch_papers(braf_aliases)


async def test_no_terms_means_no_calls(monkeypatch):
    fake = FakePubMed().install(monkeypatch)
    res = await pp.fetch_papers(Aliases(gene="BRAF"))
    assert res.papers == [] and fake.queries == []


async def test_api_key_is_sent_when_set(monkeypatch, braf_aliases):
    braf_aliases.pubmed_terms = ['"BRAF V600E"']
    fake = FakePubMed()
    seen = {}

    def handler(req):
        seen["key"] = req.url.params.get("api_key")
        return fake(req)
    monkeypatch.setattr(pp.httpx, "AsyncClient", lambda **kw: REAL_CLIENT(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(config, "NCBI_API_KEY", "abc123")
    await pp.fetch_papers(braf_aliases)
    assert seen["key"] == "abc123"


# ---------- A17: rate limit ----------

def test_rate_limit_depends_on_key(monkeypatch):
    monkeypatch.undo()  # drop the `fast` fixture's patch for this test
    monkeypatch.setattr(config, "NCBI_API_KEY", "")
    assert 1 / 3 < pp.RateLimiter.interval() < 0.4
    monkeypatch.setattr(config, "NCBI_API_KEY", "k")
    assert 0.1 < pp.RateLimiter.interval() < 0.15


async def test_rate_limiter_spaces_requests(monkeypatch):
    monkeypatch.undo()
    monkeypatch.setattr(pp.RateLimiter, "interval", staticmethod(lambda: 0.05))
    limiter = pp.RateLimiter()
    start = time.monotonic()
    for _ in range(4):
        await limiter.wait()
    assert time.monotonic() - start >= 0.14  # 3 gaps of 0.05 s


# ---------- A19/A21: scoring with hand-made papers ----------

def _paper(**kw) -> Paper:
    base = dict(pmid="1", title="t", url="u")
    base.update(kw)
    return Paper(**base)


TODAY = date(2026, 10, 10)


def test_score_rct_with_everything(braf_aliases):
    p = _paper(title="Dabrafenib in BRAF V600E melanoma: a randomized trial", year=2024,
               publication_types=["Randomized Controlled Trial", "Journal Article"],
               abstract="Median progression-free survival was 11.0 months; ORR 64%.")
    pp.score_paper(p, braf_aliases, pp._drug_patterns(["Dabrafenib"]), today=TODAY)
    assert p.score == 4 + 3 + 2 + 2 + 2
    assert p.score_reasons == [
        "OCEBM level 2 (randomized trial) +4", "exact mutation in title +3", "reports results with numbers +2",
        "names a drug (Dabrafenib) +2", "published in last 5 years +2",
    ]


@pytest.mark.parametrize("types, points, label", [
    (["Systematic Review"], 5, "level 1"),
    (["Meta-Analysis", "Review"], 5, "level 1"),  # several types: the highest level wins
    (["Clinical Trial, Phase III"], 4, "level 2"),
    (["Clinical Trial, Phase II"], 3, "level 3"),
    (["Clinical Trial, Phase I"], 3, "level 3"),
    (["Observational Study"], 3, "level 3"),
    (["Case Reports"], 2, "level 4"),
    (["Practice Guideline"], 3, "guideline"),
    (["Review"], 1, "narrative review"),
])
def test_design_points(types, points, label, braf_aliases):
    p = _paper(publication_types=types)
    pp.score_paper(p, braf_aliases, [], today=TODAY)
    assert p.score == points and label in p.score_reasons[0]


def test_lab_only_is_level_5(braf_aliases):
    p = _paper(title="Vemurafenib resistance in BRAF V600E cell lines", publication_types=["Journal Article"],
               abstract="We treated xenograft mice.")
    pp.score_paper(p, braf_aliases, [], today=TODAY)
    assert "OCEBM level 5 (lab/animal only) +0" in p.score_reasons
    assert "names a drug (vemurafenib) +2" in p.score_reasons  # drug-name stem fallback


def test_plain_article_gets_no_design_points(braf_aliases):
    p = _paper(publication_types=["Journal Article"], abstract="Patients were enrolled.")
    pp.score_paper(p, braf_aliases, [], today=TODAY)
    assert not any("OCEBM" in r for r in p.score_reasons)


def test_relevance_points(braf_aliases):
    in_abstract = _paper(title="Targeted therapy in melanoma", abstract="Patients had BRAF V600E tumours.")
    gene_only = _paper(title="BRAF-mutant melanoma outcomes", abstract="BRAF mutations are common.")
    long_form = _paper(title="Response to vemurafenib in BRAF Val600Glu melanoma")
    unrelated = _paper(title="Thyroid cancer screening")
    for p in (in_abstract, gene_only, long_form, unrelated):
        pp.score_paper(p, braf_aliases, [], today=TODAY)
    assert "exact mutation in abstract +1" in in_abstract.score_reasons
    assert "gene only, not the exact mutation (indirect) -1" in gene_only.score_reasons
    assert "exact mutation in title +3" in long_form.score_reasons
    assert not any("mutation" in r for r in unrelated.score_reasons)


def test_mutation_match_does_not_hit_other_codons(braf_aliases):
    p = _paper(title="BRAF V600E2 variant", abstract="see V600E2 and V600")
    pp.score_paper(p, braf_aliases, [], today=TODAY)
    assert "gene only, not the exact mutation (indirect) -1" in p.score_reasons


def test_results_need_both_words_and_numbers(braf_aliases):
    words_only = _paper(abstract="Overall survival was improved.")
    numbers_only = _paper(abstract="We enrolled patients for 12 months.")
    both = _paper(abstract="Overall survival improved (HR 0.61); median 12.3 months.")
    for p in (words_only, numbers_only, both):
        pp.score_paper(p, braf_aliases, [], today=TODAY)
    assert words_only.score == 0 and numbers_only.score == 0 and both.score == 2


def test_year_points(braf_aliases):
    for year, points in [(2026, 2), (2021, 2), (2020, 1), (2016, 1), (2015, 0), (None, 0)]:
        p = _paper(year=year)
        pp.score_paper(p, braf_aliases, [], today=TODAY)
        assert p.score == points, year


def test_drug_from_trial_list_beats_stem_and_handles_salts(braf_aliases):
    pats = pp._drug_patterns(["Dabrafenib", "Placebo", "Trametinib", "Dabrafenib Mesylate", "Trametinib Dimethyl Sulfoxide"])
    assert [n for n, _ in pats] == ["Dabrafenib", "Trametinib"]  # salts fold into the parent drug
    assert pp.find_drug("Patients received dabrafenib mesylate daily", pats) == "Dabrafenib"
    assert pp.find_drug("trametinib then dabrafenib", pats) == "Trametinib"  # first mentioned
    assert pp.find_drug("placebo-controlled", pats) is None
    assert pp.find_drug("treated with sotorasib and cetuximab", pats) == "sotorasib"  # stem fallback
    assert pp.find_drug("surgery only", pats) is None


def test_drug_points_and_drug_cap_agree(braf_aliases):
    pats = pp._drug_patterns(["Trametinib"])
    p = _paper(title="Selumetinib in BRAF tumours", abstract="Compared with trametinib.")
    assert pp.paper_drug(p, pats) == "selumetinib"  # title wins, even via the stem fallback
    pp.score_paper(p, braf_aliases, pats, today=TODAY)
    assert "names a drug (selumetinib) +2" in p.score_reasons


# ---------- A20: picking the 50 for the AI ----------

def test_score_papers_sorts_and_marks_top_50(braf_aliases):
    papers = [_paper(pmid=str(i), title=f"Paper {i}", abstract="text", year=2000) for i in range(60)]
    papers[7].publication_types = ["Randomized Controlled Trial"]
    papers[3].title = "BRAF V600E in paper 3"
    papers.append(_paper(pmid="3", title="duplicate of 3"))  # same pmid found twice
    out = pp.score_papers(papers, braf_aliases, [], today=TODAY)
    assert [p.pmid for p in out[:2]] == ["7", "3"]  # best first, then the rest in input order
    assert [p.pmid for p in out[2:5]] == ["0", "1", "2"]
    assert len(out) == 60 and sum(p.sent_to_ai for p in out) == 50
    assert all(p.sent_to_ai for p in out[:50]) and not any(p.sent_to_ai for p in out[50:])


def test_pick_requires_abstract_and_caps_each_drug(braf_aliases):
    papers = [_paper(pmid=f"d{i}", title="Dabrafenib study", abstract="a", score=10) for i in range(12)]
    papers += [_paper(pmid=f"o{i}", title="Other study", abstract="a", score=5) for i in range(3)]
    papers += [_paper(pmid="none", title="Dabrafenib letter", abstract="", score=100)]
    pp.pick_for_ai(papers, pp._drug_patterns(["Dabrafenib"]))
    sent = [p.pmid for p in papers if p.sent_to_ai]
    assert len([s for s in sent if s.startswith("d")]) == pp.MAX_PER_DRUG
    assert all(f"o{i}" in sent for i in range(3))
    assert "none" not in sent


def test_pick_respects_limit(braf_aliases):
    papers = [_paper(pmid=str(i), abstract="a") for i in range(10)]
    pp.pick_for_ai(papers, [], limit=4)
    assert [p.pmid for p in papers if p.sent_to_ai] == ["0", "1", "2", "3"]


def test_scoring_the_saved_braf_replies(braf_aliases):
    papers = pp.parse_efetch(efetch_fixture("braf_v600e"))
    out = pp.score_papers(papers, braf_aliases, ["Dabrafenib", "Trametinib", "Vemurafenib", "Encorafenib"], today=TODAY)
    assert [p.score for p in out] == sorted((p.score for p in out), reverse=True)
    sent = [p for p in out if p.sent_to_ai]
    assert 0 < len(sent) <= config.AI_PAPERS
    assert all(p.abstract for p in sent)
    assert all(p.score_reasons for p in sent)
    assert "V600E" in sent[0].title or "V600E" in sent[0].abstract
