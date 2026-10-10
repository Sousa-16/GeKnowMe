"""[3] Papers - Person A. See docs/PLAN.md section 5, step 3, and section 4 (scoring).

PubMed via NCBI E-utilities: esearch (ids, sorted by PubMed relevance) then efetch (details, in
batches). Scoring follows PLAN.md section 4: OCEBM 2011 design level from PubMed's publication
types, then our relevance points. Code, not the AI, picks the 50 papers the AI sees.

Two searches feed the 200 fetched papers (A22 finding): PubMed's relevance order for a big topic
like BRAF V600E (~9,000 papers) is full of case reports and never reaches the landmark trials, so
we also run the same query restricted to trial / review / guideline publication types and put
those ids first. `search_url` and `total_count` describe the plain (unrestricted) search.
"""

import asyncio
import logging
import re
import time
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import date
from urllib.parse import quote_plus

import httpx

from .. import config
from ..schemas import Aliases, Paper, PaperResults
from .proof_check import LAB_WORDS  # same word list Person B's tier check uses

log = logging.getLogger(__name__)

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
PUBMED_URL = "https://pubmed.ncbi.nlm.nih.gov/"
BATCH = 100  # ids per efetch call
MIN_RESULTS = 20  # fewer than this -> broaden the search (A14)
DESIGN_RETMAX = 100  # how many ids the design-restricted search contributes
DESIGN_FILTER = " OR ".join(f"{t}[pt]" for t in [
    "Randomized Controlled Trial", "Clinical Trial, Phase III", "Clinical Trial, Phase II", "Clinical Trial, Phase I",
    "Clinical Trial", "Controlled Clinical Trial", "Observational Study", "Meta-Analysis", "Systematic Review",
    "Practice Guideline",
])
RETRIES = 3
MAX_PER_DRUG = 8
MAX_AUTHORS = 5


class PaperSearchError(Exception):
    """PubMed could not be reached (after retries) or rejected the query."""


# ---------- A17: NCBI rate limit (3 requests/s without a key, 10/s with one) ----------

class RateLimiter:
    """Spaces requests out so we never exceed NCBI's limit, even when calls run concurrently."""

    def __init__(self):
        self._next = 0.0
        self._lock = asyncio.Lock()

    @staticmethod
    def interval() -> float:
        per_second = 10 if config.NCBI_API_KEY else 3
        return 1 / per_second + 0.02  # small margin: NCBI counts on its own clock

    async def wait(self) -> None:
        async with self._lock:
            now = time.monotonic()
            if self._next > now:
                await asyncio.sleep(self._next - now)
                now = time.monotonic()
            self._next = now + self.interval()


limiter = RateLimiter()  # one per process: all PubMed calls share the quota


async def _get(client: httpx.AsyncClient, endpoint: str, params: dict) -> httpx.Response:
    params = {**params, "db": "pubmed", "tool": "variant-trial-scope"}
    if config.NCBI_API_KEY:
        params["api_key"] = config.NCBI_API_KEY
    last = "unknown error"
    for attempt in range(RETRIES):
        await limiter.wait()
        try:
            resp = await client.get(EUTILS + endpoint, params=params)
        except (httpx.TimeoutException, httpx.TransportError) as e:
            last = type(e).__name__
        else:
            if resp.status_code == 200:
                return resp
            last = f"HTTP {resp.status_code}"
            if resp.status_code not in (429, 500, 502, 503, 504):
                break
        await asyncio.sleep(0.5 * 2**attempt)
    raise PaperSearchError(f"PubMed {endpoint} failed ({last})")


# ---------- A13/A14/A16: the search ----------

def _codons(aliases: Aliases) -> list[str]:
    out = []
    for a in aliases.names:
        if a.type == "protein_short" and (m := re.match(r"^([A-Z]\d+)", a.name)) and m.group(1) not in out:
            out.append(m.group(1))
    return out


def build_query(aliases: Aliases) -> str:
    """Exact search from the pubmed_terms. A phrase like "BRAF V600E" becomes
    (BRAF[tiab] AND V600E[tiab]): the same papers as the phrase plus the many that write
    "BRAF(V600E)", "exon 21 L858R mutation in EGFR" etc. The [tiab] tag keeps PubMed from
    expanding "EGFR" into every ErbB MeSH heading. The rs number is searched in all fields."""
    parts = []
    for term in aliases.pubmed_terms:
        if term.startswith('"'):
            words = term.strip('"').split()
            parts.append("(" + " AND ".join(f"{w}[tiab]" for w in words) + ")" if len(words) > 1 else f"{words[0]}[tiab]")
        else:
            parts.append(f"{term}[All Fields]")
    return " OR ".join(dict.fromkeys(parts))


def candidate_queries(aliases: Aliases) -> list[str]:
    """Exact search first; each later query is the previous one plus a broader clause (A14).
    1. the exact names   2. + gene AND codon ("BRAF" AND "V600")   3. + gene AND mutation."""
    exact = build_query(aliases)
    if not exact:
        return []
    queries = [exact]
    gene = aliases.gene
    if gene:
        codons = _codons(aliases)
        if codons:
            codon_clause = " OR ".join(f"{c}[tiab]" for c in codons)
            queries.append(f"({queries[-1]}) OR ({gene}[tiab] AND ({codon_clause}))")
        queries.append(f"({queries[-1]}) OR ({gene}[tiab] AND (mutation[tiab] OR mutant[tiab] OR variant[tiab]))")
    return queries


def search_url(query: str) -> str:
    return f"{PUBMED_URL}?term={quote_plus(query)}&sort=relevance"


def parse_esearch(data: dict) -> tuple[list[str], int]:
    """(ids in PubMed relevance order, total count)."""
    res = data.get("esearchresult") or {}
    if "ERROR" in res:
        raise PaperSearchError(f"PubMed rejected the search: {res['ERROR']}")
    ids = [str(i) for i in res.get("idlist") or []]
    return list(dict.fromkeys(ids)), int(res.get("count") or 0)


async def _search(client: httpx.AsyncClient, query: str, retmax: int | None = None) -> tuple[list[str], int]:
    resp = await _get(client, "esearch.fcgi", {
        "term": query, "retmax": retmax or config.MAX_PAPERS, "sort": "relevance", "retmode": "json",
    })
    try:
        return parse_esearch(resp.json())
    except ValueError as e:
        raise PaperSearchError(f"PubMed esearch returned something that isn't JSON ({e})")


# ---------- A15: details ----------

def _text(el: ET.Element | None) -> str:
    return " ".join("".join(el.itertext()).split()) if el is not None else ""


def _abstract(article: ET.Element) -> str:
    parts = []
    for t in article.findall("Abstract/AbstractText"):
        text = _text(t)
        if not text:
            continue
        label = t.get("Label")
        parts.append(f"{label}: {text}" if label else text)
    return "\n".join(parts)


def _year(article: ET.Element) -> int | None:
    pubdate = article.find("Journal/JournalIssue/PubDate")
    candidates = [
        pubdate.findtext("Year") if pubdate is not None else None,
        pubdate.findtext("MedlineDate") if pubdate is not None else None,  # "2015 Sep-Oct"
        *[d.findtext("Year") for d in article.findall("ArticleDate")],
    ]
    for c in candidates:
        if c and (m := re.search(r"\d{4}", c)):
            return int(m.group())
    return None


def _authors(article: ET.Element) -> list[str]:
    out = []
    for au in article.findall("AuthorList/Author")[:MAX_AUTHORS]:
        last, initials, collective = au.findtext("LastName"), au.findtext("Initials"), au.findtext("CollectiveName")
        name = f"{last} {initials}".strip() if last else (collective or "")
        if name:
            out.append(name)
    return out


def parse_article(art: ET.Element) -> Paper | None:
    mc = art.find("MedlineCitation")
    article = mc.find("Article") if mc is not None else None
    pmid = mc.findtext("PMID") if mc is not None else None
    if article is None or not pmid:
        return None
    journal = article.find("Journal")
    return Paper(
        pmid=pmid,
        title=_text(article.find("ArticleTitle")).strip(". []") or "(no title)",
        abstract=_abstract(article),
        journal=(journal.findtext("ISOAbbreviation") or journal.findtext("Title")) if journal is not None else None,
        year=_year(article),
        authors=_authors(article),
        publication_types=[t.text.strip() for t in article.findall("PublicationTypeList/PublicationType") if t.text],
        url=f"{PUBMED_URL}{pmid}/",
    )


def parse_efetch(xml_text: str) -> list[Paper]:
    """efetch XML -> Papers. Books and anything without a PMID are skipped."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise PaperSearchError(f"PubMed efetch returned invalid XML ({e})")
    papers = []
    for art in root.iter("PubmedArticle"):
        if (p := parse_article(art)) is not None:
            papers.append(p)
    return papers


async def _details(client: httpx.AsyncClient, ids: list[str]) -> list[Paper]:
    papers: list[Paper] = []
    for i in range(0, len(ids), BATCH):
        resp = await _get(client, "efetch.fcgi", {"id": ",".join(ids[i:i + BATCH]), "retmode": "xml", "rettype": "abstract"})
        papers.extend(parse_efetch(resp.text))
    return papers


# ---------- main entry ----------

async def fetch_papers(aliases: Aliases) -> PaperResults:
    """Search (broadening if needed), fetch details in batches, keep PubMed's relevance order.
    Scoring is done afterwards by score_papers, once the trials' drug names are known."""
    queries = candidate_queries(aliases)
    if not queries:
        return PaperResults()
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "variant-trial-scope/0.1"}) as client:
        ids: list[str] = []
        count = 0
        query = queries[0]
        for query in queries:
            ids, count = await _search(client, query)
            if count >= MIN_RESULTS:
                break
            log.info("only %d PubMed results for %r; broadening", count, query)
        # Same search restricted to trials/reviews/guidelines; those ids go first (see module doc)
        design_ids, _ = await _search(client, f"({query}) AND ({DESIGN_FILTER})", retmax=DESIGN_RETMAX)
        ids = list(dict.fromkeys(design_ids + ids))[: config.MAX_PAPERS]
        papers = await _details(client, ids) if ids else []
    order = {pmid: i for i, pmid in enumerate(ids)}
    seen: set[str] = set()
    papers = [p for p in papers if not (p.pmid in seen or seen.add(p.pmid))]
    papers.sort(key=lambda p: order.get(p.pmid, len(order)))
    return PaperResults(papers=papers, total_count=count, search_url=search_url(query))


# ---------- A19: scoring (PLAN.md section 4) ----------

# OCEBM 2011 "Does this intervention help?" row, from PubMed publication types (lower-cased).
# Single-arm phase 1/2 trials sit at level 3 on purpose (see PLAN.md section 4).
OCEBM_LEVELS = [
    (1, 5, "systematic review / meta-analysis", {"systematic review", "meta-analysis"}),
    (2, 4, "randomized trial", {"randomized controlled trial", "clinical trial, phase iii", "pragmatic clinical trial",
                                 "equivalence trial"}),
    (3, 3, "non-randomized trial / cohort", {"clinical trial, phase ii", "clinical trial, phase i", "clinical trial, phase iv",
                                             "controlled clinical trial", "observational study", "clinical trial",
                                             "adaptive clinical trial"}),
    (4, 2, "case series / case report", {"case reports"}),
]
GUIDELINE_TYPES = {"practice guideline", "guideline", "consensus development conference"}
REVIEW_TYPES = {"review"}
CLINICAL_TYPES = set().union(*(types for _, _, _, types in OCEBM_LEVELS))

RESULT_WORDS = re.compile(
    r"\b(response rate|objective response|overall response|ORR|complete response|partial response|disease control|"
    r"survival|PFS|OS|DFS|EFS|hazard ratio|progression[- ]free|time to progression)\b", re.IGNORECASE)
RESULT_NUMBERS = re.compile(
    r"\d+(?:\.\d+)?\s*(?:%|percent)|\d+(?:\.\d+)?\s*(?:months?|weeks?|years?)\b|\bHR\s*[=:,]?\s*\d|\bn\s*=\s*\d",
    re.IGNORECASE)
# Fallback when no trial drug list is available: common oncology drug name endings (INN stems)
DRUG_STEMS = re.compile(
    r"\b[a-z]{3,}(?:tinib|rafenib|metinib|ciclib|lisib|parib|zomib|rolimus|mab|nib|degib|platin|taxel|rubicin|tecan|"
    r"citabine|mustine|sertib|rasib|clax)\b", re.IGNORECASE)


def _mention_patterns(names: list[str]) -> list[re.Pattern]:
    # Digits may not touch the name (V600E must not match V600E2), letters/punctuation may
    return [re.compile(rf"(?<![0-9]){re.escape(n)}(?![0-9])", re.IGNORECASE) for n in names]


def _exact_names(aliases: Aliases) -> list[str]:
    """Names that identify the exact mutation: V600E, p.V600E, Val600Glu, p.Val600Glu."""
    out: list[str] = []
    for a in aliases.names:
        if a.type == "protein_short":
            out += [a.name, f"p.{a.name}"]
        elif a.type == "protein_long":
            out += [a.name, a.name.removeprefix("p.")]
    return list(dict.fromkeys(n for n in out if n))


def _drug_patterns(drug_names: list[str]) -> list[tuple[str, re.Pattern]]:
    """One (name, pattern) per drug. Salt forms fold into the parent: "Dabrafenib Mesylate" is
    counted as "Dabrafenib" (and matches both spellings)."""
    pats = []
    seen: set[str] = set()
    for d in drug_names:
        d = d.strip()
        if not d or "placebo" in d.lower():
            continue
        first = d.split()[0]
        name = first if len(first) >= 5 and len(d.split()) > 1 else d
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        words = {d, name}
        pats.append((name, re.compile(r"\b(?:" + "|".join(re.escape(w) for w in words) + r")\b", re.IGNORECASE)))
    return pats


def find_drug(text: str, drug_pats: list[tuple[str, re.Pattern]]) -> str | None:
    """The first drug named in the text: from the trials' list, else by drug-name stem."""
    best: tuple[int, str] | None = None
    for name, pat in drug_pats:
        if (m := pat.search(text)) and (best is None or m.start() < best[0]):
            best = (m.start(), name)
    if best:
        return best[1]
    if m := DRUG_STEMS.search(text):
        return m.group().lower()
    return None


def paper_drug(paper: Paper, drug_pats: list[tuple[str, re.Pattern]]) -> str | None:
    """The drug a paper is about: the first one named in the title, else in the abstract. Used
    both for the "names a drug" points and for the 8-per-drug cap, so they always agree."""
    return find_drug(paper.title, drug_pats) or find_drug(paper.abstract, drug_pats)


def design_points(publication_types: list[str], text: str) -> tuple[int, str] | None:
    """(points, reason) from the study design. Several types -> the highest OCEBM level."""
    types = {t.lower() for t in publication_types}
    for level, points, label, members in OCEBM_LEVELS:
        if types & members:
            return points, f"OCEBM level {level} ({label})"
    if types & GUIDELINE_TYPES:
        return 3, "guideline"
    if types & REVIEW_TYPES:
        return 1, "narrative review"
    if any(w in text.lower() for w in LAB_WORDS):
        return 0, "OCEBM level 5 (lab/animal only)"
    return None


def score_paper(paper: Paper, aliases: Aliases, drug_pats: list[tuple[str, re.Pattern]],
                today: date | None = None) -> None:
    today = today or date.today()
    score, reasons = 0, []

    def add(points: int, why: str):
        nonlocal score
        score += points
        reasons.append(f"{why} {points:+d}")

    text = f"{paper.title}\n{paper.abstract}"
    if design := design_points(paper.publication_types, text):
        add(*design)

    exact = _mention_patterns(_exact_names(aliases))
    gene = _mention_patterns([aliases.gene]) if aliases.gene else []
    if any(p.search(paper.title) for p in exact):
        add(3, "exact mutation in title")
    elif any(p.search(paper.abstract) for p in exact):
        add(1, "exact mutation in abstract")
    elif any(p.search(text) for p in gene):
        add(-1, "gene only, not the exact mutation (indirect)")

    if RESULT_WORDS.search(text) and RESULT_NUMBERS.search(text):
        add(2, "reports results with numbers")
    if drug := paper_drug(paper, drug_pats):
        add(2, f"names a drug ({drug})")
    if paper.year:
        age = today.year - paper.year
        if age <= 5:
            add(2, "published in last 5 years")
        elif age <= 10:
            add(1, "published 5-10 years ago")
    paper.score, paper.score_reasons = score, reasons


# ---------- A20: picking the 50 for the AI ----------

def pick_for_ai(papers: list[Paper], drug_pats: list[tuple[str, re.Pattern]], limit: int | None = None) -> None:
    """Mark the best `limit` papers sent_to_ai. Rules: must have an abstract (the proof check needs
    text), at most MAX_PER_DRUG papers about the same drug, each paper once. `papers` must already
    be sorted best first."""
    limit = limit if limit is not None else config.AI_PAPERS
    per_drug: Counter = Counter()
    seen: set[str] = set()
    chosen = 0
    for p in papers:
        p.sent_to_ai = False
        if chosen >= limit or not p.abstract.strip() or p.pmid in seen:
            continue
        drug = paper_drug(p, drug_pats)
        if drug and per_drug[drug] >= MAX_PER_DRUG:
            continue
        seen.add(p.pmid)
        if drug:
            per_drug[drug] += 1
        p.sent_to_ai = True
        chosen += 1


def score_papers(papers: list[Paper], aliases: Aliases, drug_names: list[str],
                 today: date | None = None) -> list[Paper]:
    """Set score, score_reasons and sent_to_ai (top 50). drug_names come from the trials.
    Returns the papers best first; ties keep PubMed's relevance order."""
    seen: set[str] = set()
    papers = [p for p in papers if not (p.pmid in seen or seen.add(p.pmid))]
    drug_pats = _drug_patterns(drug_names)
    for p in papers:
        score_paper(p, aliases, drug_pats, today)
    papers = sorted(papers, key=lambda p: -p.score)  # stable: PubMed relevance breaks ties
    pick_for_ai(papers, drug_pats)
    return papers
