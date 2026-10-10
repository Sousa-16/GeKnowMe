# Plan

Read this before writing code. If you want to change anything here, agree on it together first, because both halves depend on it.

## 1. How it works

```
User types rs number
        │
        ▼
[1] Variant lookup      (Person A)  MyVariant.info
        │  gene, mutation names, ClinVar
        ▼
[2] Aliases             (Person A)  no internet needed
        │  all names + search terms
        ├───────────────────────────┐
        ▼                           ▼
[3] Papers   (Person A)        [4] Trials   (Person B)
    PubMed                         ClinicalTrials.gov
        │                           │
        │                           ▼
        │                      [5] Eligibility  (Person B)
        │                           │  no internet needed
        ▼                           ▼
        └──────────►[ ] Code scores sources, picks the best
                        50 papers + 30 trials (section 4)
                            │
                            ▼
                    [6] AI treatment table (Person B)
                        Gemini + proof checks
                            │
                            ▼
                     One "brief" (JSON) → website
```

Steps 3 and 4 run at the same time to save time.

## 2. Tech choices (decided)

| Part | Choice |
|---|---|
| Backend | Python, FastAPI, httpx (async), pydantic |
| AI | Gemini via Google AI Studio (free tier) |
| AI model | Main: `gemini-3.5-flash`. Backup: `gemini-3.5-flash-lite`. (`gemini-3.8-flash` is newer but was overloaded when tested; try it later.) `gemini-2.5-flash` is retired. |
| Website | React + TypeScript + Tailwind |
| Hosting | One Render service: the Python backend also serves the website |
| Keys | `backend/.env`: `GEMINI_API_KEY`, `NCBI_API_KEY` (optional). Never commit it. |

## 3. The sourcing rule

**Every single fact in the brief must point to where it came from.** Not one link per section, one per fact. This lets anyone check the tool, and it's how we catch AI mistakes.

| Fact | Its source |
|---|---|
| Each ClinVar significance / condition | The exact ClinVar record (e.g. `RCV000014992`) with a link |
| Each mutation name (alias) | Where it came from, e.g. "converted from p.Val600Glu (MyVariant)" |
| Each paper | PubMed link |
| Each trial | ClinicalTrials.gov link |
| Each count in the trial stats | A link to that search on ClinicalTrials.gov |
| Each eligibility rule | The trial link + the original sentence, word for word |
| Each AI table row | Source IDs **plus a copied sentence from each source that proves the claim** |

### How we catch AI mistakes (the "proof check")

The AI must copy the exact sentence from the paper or trial that backs up its claim. Then our code (not the AI) checks:

1. **Is the source ID real?** The ID must be one of the papers/trials we sent it. If not → **row removed**.
2. **Is the copied sentence really in that source?** Code searches the source text for it (ignoring case, spaces and punctuation differences). If not found → **row removed**.
3. **Do the numbers match?** Every number in the "outcome" (e.g. `64%`) must appear in a copied sentence. If not → row kept but marked **"unverified"** with a warning.

The brief reports how many rows were removed and why. On the website, clicking a source shows the copied sentence highlighted inside the original text.

## 4. Choosing the best sources for the AI

We fetch up to **200 papers** and all matching trials (~50–100), and show them all on the website. But the AI only gets the **best 50 papers and best 30 trials** (~25,000 tokens: fast, cheap, fits the free tier). Code picks them with a points system, not the AI.

We use two published medical standards, each where it fits (full references in section 12):

| Where | Standard | Why this one |
|---|---|---|
| Ranking papers (this section) | **OCEBM 2011 Levels of Evidence**, "Does this intervention help?" row (Oxford Centre for Evidence-Based Medicine) | Ranks evidence by study design. Code can apply it automatically from PubMed's "publication type" labels. |
| Evidence level in the AI table, **every row** (section 5, step 6) | **OCEBM 2011** level of the strongest cited source, computed by code from the sources' study designs | Works for any disease, and the AI can't inflate it. |
| Evidence level in the AI table, **cancer rows only** | **ESMO ESCAT** (Mateo et al., *Annals of Oncology* 2018) | Built specifically for "how strong is the evidence that this drug works for this mutation in this cancer type". It's an oncology scale, so it isn't used for other diseases. |

### Papers

**Must have an abstract**, or it's skipped for the AI (the proof check needs text). It's still shown on the website.

**Part 1: study design (OCEBM 2011).** Use the paper's PubMed publication types; if it has several, take the highest.

| OCEBM level | What it means | PubMed publication types | Points |
|---|---|---|---|
| 1 | Systematic review of randomized trials | `Systematic Review`, `Meta-Analysis` | +5 |
| 2 | Randomized trial | `Randomized Controlled Trial`, `Clinical Trial, Phase III` | +4 |
| 3 | Non-randomized controlled / follow-up study | `Clinical Trial, Phase II`, `Clinical Trial, Phase I`, `Controlled Clinical Trial`, `Observational Study` | +3 |
| 4 | Case series, case-control | `Case Reports` | +2 |
| 5 | Mechanism-based reasoning (lab/animal only) | no clinical type + words like "cell line", "mice", "xenograft", "in vitro" | 0 |
| not ranked by OCEBM | Guidelines and narrative reviews | `Practice Guideline` / `Review` | +3 / +1 |

Two deliberate adjustments, so we can explain them if asked:
- **Single-arm Phase 1/2 trials are put at Level 3.** Strictly, OCEBM would call an uncontrolled trial a case series (Level 4). But in targeted cancer therapy, single-arm Phase 2 trials are often the main evidence for a mutation (ESCAT accepts them for tier I-B), so we rank them above case reports.
- **OCEBM doesn't rank guidelines or narrative reviews.** Guidelines summarize graded evidence, so they get +3. Narrative reviews add no new results, so they get +1.

**Part 2: relevance (our own rules, not from a standard).** OCEBM only judges study design, not whether the paper fits our question. OCEBM itself says to grade evidence down for "indirectness", so:

| What we check | Points |
|---|---|
| Exact mutation (e.g. "V600E") in the **title** | +3 |
| Exact mutation only in the abstract | +1 |
| Only the gene is mentioned (e.g. "BRAF-mutant"), not the exact mutation (indirect) | −1 |
| Has results (e.g. "response rate", "survival", "PFS", "OS", "hazard ratio") **and** numbers | +2 |
| Names a drug | +2 |
| Published in the last 5 years | +2 |
| Published 5–10 years ago | +1 |

- **Tie-break:** PubMed's own relevance order.
- **Cap per drug:** at most 8 papers about the same drug, so one drug doesn't fill all 50 slots.
- **No duplicates:** a paper found by several searches counts once.
- **Drug names:** taken from the trials' intervention lists, so we don't need a hand-made drug list.

### Trials

Same idea: design first (randomized beats non-randomized, later phase beats earlier), then relevance.

| What we check | Points |
|---|---|
| Randomized (`designModule.designInfo.allocation` = `RANDOMIZED`) | +2 |
| Phase 3 / Phase 2 / Phase 1 | +3 / +2 / +1 |
| Has posted results (`hasResults` = true) | +4 |
| Exact mutation in the title or the inclusion criteria | +3 |
| Completed or active | +1 |
| Started in the last 5 years | +1 |
| Mutation appears **only** in the exclusion criteria | −5 |

### Transparency
Each paper and trial keeps its `score` and a short list of `score_reasons` (e.g. `["OCEBM level 2 (RCT) +4", "V600E in title +3"]`), so anyone can see why something was picked.

The design points follow the standard; the relevance points are a first guess. After it runs, look at the top 50 for BRAF and adjust the relevance points if needed.

## 5. What each part takes in and gives back

This is the contract. Each person can build their part alone as long as it returns exactly these fields.

### [1] Variant lookup (Person A)
**In:** rs number, e.g. `rs113488022`
**Out: Variant**
| Field | Example |
|---|---|
| rsid | `rs113488022` |
| gene | `BRAF` |
| gene_name | `B-Raf proto-oncogene, serine/threonine kinase` |
| hgvs_c | `["c.1799T>A", "c.1799T>C", "c.1799T>G"]` |
| hgvs_p | `["p.Val600Glu", "p.Val600Ala", "p.Val600Gly"]` |
| clinvar_records | list of **ClinVarRecord** (below) |
| links | MyVariant, ClinVar, dbSNP URLs |

**ClinVarRecord**
| Field | Example |
|---|---|
| accession | `RCV000014992` |
| significance | `Pathogenic` |
| condition | `Melanoma` |
| protein_change | `p.Val600Glu` (which mutation this record is about, raw form) |
| url | `https://www.ncbi.nlm.nih.gov/clinvar/RCV000014992/` |

Notes: this step only stores raw data as MyVariant gives it. Converting `p.Val600Glu` → `V600E` happens in step 2. One rs number can return several mutations (collect all). MyVariant sometimes returns an empty reply, so retry. Unknown rs number → "not found" error.

### [2] Aliases (Person A)
**In:** Variant
**Out: Aliases**
| Field | Example |
|---|---|
| gene | `BRAF` |
| names | list of **Alias** (below) |
| pubmed_terms | `["\"BRAF V600E\"", "\"BRAF p.V600E\"", "\"BRAF Val600Glu\"", "rs113488022"]` |
| trial_terms | `["BRAF V600E", "BRAF V600A", "BRAF V600G", "BRAF V600"]` |

**Alias**
| Field | Example |
|---|---|
| name | `V600E` |
| type | `rsid`, `protein_short`, `protein_long`, `dna` |
| derived_from | `p.Val600Glu (MyVariant)` |

Key job: convert `p.Val600Glu` → `V600E`.

### [3] Papers (Person A)
**In:** Aliases
**Out:** list of **Paper** + total count + the search used
| Field | Example |
|---|---|
| pmid | `27080216` |
| title | text |
| abstract | text (needed for the proof check) |
| journal, year | `Lancet Oncol`, `2016` |
| authors | first few |
| publication_types | `["Clinical Trial, Phase II"]` |
| url | `https://pubmed.ncbi.nlm.nih.gov/27080216/` |
| score, score_reasons | `9`, `["Phase 2 trial +4", "V600E in title +3", "last 5 years +2"]` |
| sent_to_ai | `true` if it's in the top 50 |

Also return `search_url`: a PubMed link that reruns the same search.
Notes: use PubMed search sorted by relevance (LitVar2 returns 32,000+ unsorted IDs for BRAF V600E; use it only for the total count). Fetch up to **200** papers (details in batches). Scoring: section 4.

### [4] Trials (Person B)
**In:** Aliases
**Out:** list of **Trial** + **TrialStats**
| Field | Example |
|---|---|
| nct_id | `NCT05195632` |
| title | text |
| brief_summary | text (needed for the proof check) |
| phases | `["PHASE2"]` |
| status | `RECRUITING` |
| conditions | `["Non-Small Cell Lung Cancer"]` |
| interventions | `["Encorafenib", "Binimetinib"]` |
| sponsor, start_date, enrollment | |
| eligibility_text | full criteria text |
| matched_terms | which search terms found it |
| has_results | `true` / `false` |
| url | `https://clinicaltrials.gov/study/NCT05195632` |
| score, score_reasons | `8`, `["Phase 3 +3", "has results +4", "active +1"]` |
| sent_to_ai | `true` if it's in the top 30 |

**TrialStats**
| Field | Example |
|---|---|
| total_found | `256` |
| returned | `50` |
| by_phase | `{"Phase 2": 21, ...}` |
| by_status | `{"Recruiting": 14, ...}` |
| top_drugs | `[["Trametinib", 12], ...]` |
| search_urls | one ClinicalTrials.gov search link per search term |

Notes: keep all matching trials (up to ~100). Scoring: section 4. The search also matches exclusion text, so some hits may be trials that exclude the mutation.

### [5] Eligibility (Person B)
**In:** Trials + Aliases
**Out:** list of **Criterion**
| Field | Example |
|---|---|
| nct_id | `NCT05195632` |
| kind | `inclusion` or `exclusion` |
| category | `biomarker_required`, `biomarker_excluded`, `testing_method`, `prior_therapy`, `other_biomarker` |
| text | the original sentence, word for word |
| url | trial link |

Notes: rule-based (no AI), so it's fast and can't hit rate limits. This is the part closest to the Regeneron "I/E Competitor" starter idea.

### [6] AI treatment table (Person B)
**In:** Variant, Aliases, Papers, Trials
**Out:** list of **TreatmentRow** + list of **RemovedRow**
| Field | Example |
|---|---|
| drug | `Dabrafenib + trametinib` |
| setting | `Metastatic NSCLC` |
| outcome | `ORR 64%` |
| is_cancer | `true` if the row's setting is a cancer (AI flag, or cancer words in `setting`) |
| ocebm_level | `1`–`5`: Oxford level of the strongest cited source, computed by code; `null` if none is rankable |
| escat_tier | **cancer rows only:** `I-A`, `I-B`, `I-C`, `II-A`, `II-B`, `III-A`, `III-B`, `IV`, `V` (see below); otherwise `null` |
| escat_reason | **cancer rows only:** one short sentence, e.g. `Randomized phase 3 showed longer overall survival` |
| evidence | list of **Evidence** (below), at least one |
| verified | `true` if all checks passed, `false` if the number check failed |

**Evidence**
| Field | Example |
|---|---|
| source_id | `PMID:27080216` or `NCT01336634` |
| quote | `"the overall response rate was 64%"` (copied word for word) |
| url | link to the source |

**RemovedRow** (shown in a "removed by checks" section, for transparency)
| Field | Example |
|---|---|
| drug | `Vemurafenib` |
| reason | `quote not found in PMID:12345678` |

**ESCAT tiers** (Mateo et al., *Annals of Oncology* 2018, Table 2), used for `escat_tier`. Each row is one drug + one cancer type, which is how ESCAT is meant to be applied.

| Tier | Meaning (shortened from the paper) |
|---|---|
| I-A | Randomized trial(s) in this cancer type show a meaningful **survival** improvement |
| I-B | Non-randomized prospective trial(s) in this cancer type show meaningful clinical benefit |
| I-C | Trials across several cancer types (e.g. basket trials) show similar benefit |
| II-A | Retrospective studies show benefit vs. patients without the mutation |
| II-B | Prospective trial(s) show higher response rates, but no survival data yet |
| III-A | Benefit shown for this mutation, but in a **different** cancer type |
| III-B | Similar mutation in the same gene/pathway has evidence; this one doesn't yet |
| IV | Lab/animal (or computer-predicted) evidence only |
| V | Responses seen, but no meaningful benefit alone (combinations may help) |

ESCAT tier X ("no evidence") isn't used for rows: a row with no evidence shouldn't exist.

**Tier check (code, part of the proof check, cancer rows only):** the tier must match the evidence types cited.
- `I-A` needs at least one cited source that is randomized (paper type `Randomized Controlled Trial` / `Clinical Trial, Phase III`, or a randomized trial record) **and** a quote mentioning survival (`overall survival`, `progression-free survival`, `OS`, `PFS`).
- `I-B`, `I-C`, `II-B` need at least one cited clinical trial (paper or trial record).
- `IV` sources must be lab/animal studies.
- If the cited sources don't support the tier, the row is kept but marked **"tier not supported"**, and the tier is shown with a warning.

Simplification to mention in the README: ESCAT defines "clinically meaningful benefit" using the ESMO-MCBS scale, which we don't compute.

Rules: AI only sees the top 50 papers and top 30 trials (section 4); it must use only those. Retry on "overloaded", then switch to the backup model.

### Final output: the Brief
Everything above in one JSON, plus:
- `status` per section: `ok`, `empty`, `error`, `skipped`
- `warnings`: plain-English messages, e.g. "PubMed is unavailable right now"
- `disclaimer`: "Research tool for clinical trial planning. Not medical advice."
- `generated_at`: date and time, since results change over time

## 6. Backend endpoints

| Endpoint | What it does |
|---|---|
| `GET /api/brief/{rsid}` | Returns the full Brief. `?include_ai=false` returns steps 1–5 fast with treatments `pending`. `?refresh=true` skips saved demo briefs. |
| `GET /api/brief/{rsid}/treatments` | Only the AI treatment table (slow, 10–90 s); reuses the work from the earlier call. |
| `GET /api/health` | Says if the server is up and keys are set. |

Errors: bad input (`BRAF`, `rs12a`) → message "not a valid rs number". Unknown rs → "not found". Any other failure only marks that one section as `error`; the rest of the brief still shows.

## 7. Folder layout

```
backend/
  app/
    main.py          shared   - the API
    pipeline.py      shared   - runs steps 1–6 in order
    schemas.py       shared   - the contract above, as Python classes
    sources/
      variant.py     Person A
      aliases.py     Person A
      papers.py      Person A
      trials.py      Person B
      eligibility.py Person B
      ai_summary.py  Person B
      proof_check.py Person B
  tests/             each person tests their own files
  requirements.txt
  .env               keys (not in git)
frontend/            website (built later)
docs/                plan, problem statement, notes
```

Rule: only edit your own files. Shared files: ask the other person first.

## 8. Step-by-step tasks

Do them in order. Each step is small and ends with something you can check. Tick them off as you go.

### Setup (together, ~30 min)
- [ ] S1. Both can `git pull` and `git push` to the repo.
- [ ] S2. Create the folders from section 7 (empty files are fine).
- [ ] S3. Write `requirements.txt` and make a Python virtual environment; both can install it.
- [ ] S4. Write `schemas.py` from section 5 (the contract). Both review it. Push.
- [ ] S5. Write a basic `main.py` with `/api/health`. Check it opens in the browser at `localhost:8000/docs`.
- [ ] S6. Write `pipeline.py` that calls all six steps and turns any failure into a warning. Each step can just return empty results for now.
- [ ] S7. Each person creates their `.env` with their own Gemini key.

### Person A
**Variant lookup (`variant.py`)**
- [ ] A1. Call MyVariant for `rs113488022` and save the raw reply to a file (for tests).
- [ ] A2. Pull out gene and gene name.
- [ ] A3. Pull out all `hgvs_p` and `hgvs_c` (there can be several mutations).
- [ ] A4. Pull out ClinVar records: accession, significance, condition, which mutation, link.
- [ ] A5. Unknown rs number → "not found" error. Empty reply → retry.
- [ ] A6. Test with all 3 demo rs numbers + one fake one.

**Aliases (`aliases.py`)**
- [ ] A7. Convert `p.Val600Glu` → `V600E` (table of 3-letter → 1-letter amino acids).
- [ ] A8. Handle stop codons (`Ter` → `*`) and skip forms it can't convert.
- [ ] A9. Build the alias list, each with where it came from.
- [ ] A10. Build `pubmed_terms` and `trial_terms`.
- [ ] A11. Tests for A7–A10 (no internet needed).
- [ ] A12. **Push.** Person B needs `trial_terms` from here.

**Papers (`papers.py`)**
- [ ] A13. PubMed search (esearch) with all `pubmed_terms`, sorted by relevance; get up to 200 IDs.
- [ ] A14. If too few results, run a broader search (e.g. gene + codon).
- [ ] A15. Fetch details (efetch) in batches: title, abstract, journal, year, authors, types.
- [ ] A16. Build `search_url` and total count (LitVar2 or PubMed count).
- [ ] A17. Respect NCBI limits (3/second without key, 10/second with key).
- [ ] A18. Save raw replies for tests; write tests.
- [ ] A19. Score each paper with the section 4 points table; save `score` + `score_reasons`.
- [ ] A20. Pick the top 50 for the AI: abstract required, max 8 per drug, no duplicates; set `sent_to_ai`. (Drug names come from the trials; until Person B's part works, use a short test list.)
- [ ] A21. Tests for scoring with a few hand-made papers.
- [ ] A22. Check the top 50 for all 3 demo rs numbers look relevant; adjust points if not.

### Person B
**Trials (`trials.py`)**
- [x] B1. Call ClinicalTrials.gov for `BRAF V600E` and save the raw reply to a file.
- [x] B2. Turn each study into a Trial (all fields in section 5).
- [x] B3. Search every `trial_terms` entry; merge duplicates by `nct_id`; record which terms matched.
- [x] B4. Sort: exact-mutation matches first, then recruiting, then later phase, then newest.
- [x] B5. Build TrialStats, including a search link for each term.
- [x] B6. If one search fails, keep the others; if all fail → error.
- [x] B7. Get `has_results` for each trial (field: `hasResults`; randomized: `designModule.designInfo.allocation`).
- [x] B8. Score each trial with the section 4 points table; save `score` + `score_reasons`; pick the top 30 and set `sent_to_ai`.
- [x] B9. Tests using the saved reply (including scoring).

**Eligibility (`eligibility.py`)**
- [x] B10. Split eligibility text into inclusion and exclusion parts.
- [x] B11. Split each part into single rules (numbers, bullets, new lines).
- [x] B12. Keep only rules about the gene, mutation, testing, or prior targeted drugs.
- [x] B13. Put each rule in a category (section 5 list).
- [x] B14. Never crash on weird text (empty, no headings, odd symbols).
- [x] B15. Tests with real eligibility text from the saved replies.

**AI table (`ai_summary.py` + `proof_check.py`)**
- [x] B16. Send one tiny test prompt to Gemini from Python; get a reply.
- [x] B17. Build the AI input from the papers and trials marked `sent_to_ai` (50 papers: ID, title, abstract; 30 trials: ID, phase, status, drugs, summary).
- [x] B18. Write the instructions: only use given sources; every row needs source ID + copied sentence; include the ESCAT tier table so the AI assigns `escat_tier` + `escat_reason`.
- [x] B19. Ask Gemini for JSON in the TreatmentRow shape.
- [x] B20. `proof_check.py`: ID check → quote check → number check (section 3) → ESCAT tier check (section 5, step 6).
- [x] B21. Tests for the proof check with a fake AI reply (fake ID, fake quote, wrong number, I-A tier citing only a Phase 1 trial).
- [x] B22. Retry on "overloaded"; then switch to backup model; then give a friendly error.
- [x] B23. Save AI answers so the same input doesn't call Gemini twice.

### Together, after both halves work (~8 PM)
- [ ] T1. Run the full brief for all 3 demo rs numbers.
- [ ] T2. Try bad inputs: `BRAF`, `rs0`, `rs99999999999`, a common harmless variant with no trials.
- [ ] T3. Save the 3 demo briefs as files, so the demo works without internet.
- [ ] T4. Start the website.
- [ ] T5. Deploy to Render; test the live link.
- [ ] T6. README, demo video, slides.

## 9. Demo rs numbers (checked)

| rs number | What it is |
|---|---|
| `rs113488022` | BRAF V600E (also V600A, V600G) |
| `rs121913530` | KRAS G12C (also G12S, G12R) |
| `rs121434568` | EGFR L858R (also L858Q) |

Note: `rs121913529` is KRAS G12D/G12V/G12A, **not** G12C.

## 10. Timeline (Eastern)

| Time | Goal |
|---|---|
| ~5:30 PM | Setup done; A1–A12 and B1–B9 working |
| ~8:00 PM | All 6 steps work for the 3 demo rs numbers; start the website |
| ~11:00 PM | Handle odd inputs, empty results, outages; save demo briefs |
| ~2:00 AM | Stop adding features; only fix bugs |
| Morning | Demo video, slides, README; submit by 9:30 AM |

## 11. Still to decide

- Project name
- Who builds the website, and when
- Whether the docs go into the public repo

## Changes since the plan was first written (Person B, for Person A's agent)

- **Shared files changed (additions only):** `schemas.py` adds `Trial.randomized`, `TreatmentRow.is_cancer` / `ocebm_level` (ESCAT fields now cancer-only and optional), `Brief.from_demo`, `SectionStatus` `"pending"`, and `TreatmentsResponse`. `pipeline.py` / `main.py` add the separate AI-table endpoint, saved demo briefs (`app/demo_data/`), and serve the website from `frontend/dist`.
- **Website** (`frontend/`, React + TypeScript + Tailwind) and **Render config** (`render.yaml`) exist. `scripts/make_demo_briefs.py` saves demo briefs once all steps work.
- **Works beyond cancer:** eligibility extraction knows general genetic terms; ESCAT only applies to cancer rows.
- **Aliases matter a lot for non-cancer variants:** trials and papers often use historical names, not HGVS ones (sickle cell = "HbS" / "E6V", not "HBB E7V"; MTHFR = "C677T"). With only HGVS names, `HBB E7V` found 2 trials. Consider adding well-known legacy names to `trial_terms` / `pubmed_terms` where they can be derived.

## 12. Standards we use (references)

- **OCEBM Levels of Evidence (2011).** OCEBM Levels of Evidence Working Group, Oxford Centre for Evidence-Based Medicine. https://www.cebm.ox.ac.uk/resources/levels-of-evidence/ocebm-levels-of-evidence. Used for: ranking papers by study design (section 4).
- **ESMO Scale for Clinical Actionability of molecular Targets (ESCAT).** Mateo J, et al. *Annals of Oncology* 2018;29(9):1895–1902. doi:10.1093/annonc/mdy263. Used for: `escat_tier` in the AI table (section 5, step 6). Tier definitions taken from the paper's Table 2.
