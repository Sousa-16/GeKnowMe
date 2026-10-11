import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Brief, SectionStatus, TreatmentResults } from "./types";
import { ApiError, DEMOS, fetchBrief, fetchTreatments } from "./lib/api";
import { formatDate, OPEN_STATUSES } from "./lib/format";
import { prefersReducedMotion, withViewTransition } from "./lib/motion";
import { VariantSection } from "./components/VariantSection";
import { TrialsSection } from "./components/TrialsSection";
import { EligibilitySection } from "./components/EligibilitySection";
import { TreatmentsSection } from "./components/TreatmentsSection";
import { PapersSection } from "./components/PapersSection";
import { ACCENTS, Badge, CollapseContext, CountUp, ExtLink, Kpi, Reveal, Spinner, TONES, useCopy, type Accent } from "./components/ui";
import { Icon } from "./components/icons";
import { clinvarVerdict } from "./lib/clinvar";

const DnaHelix = lazy(() => import("./components/DnaHelix"));
const REPO_URL = "https://github.com/Sousa-16/hackathon-26";

export const APP_NAME = "GeKnowMe";
const RSID_RE = /^(rs)?\d{1,12}$/i;

type LoadedBrief = Brief & { offlineSample?: boolean };

function readRsid() {
  return new URLSearchParams(window.location.search).get("rs")?.trim().toLowerCase() ?? "";
}

export default function App() {
  const [rsid, setRsid] = useState(readRsid);
  const [brief, setBrief] = useState<LoadedBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [tx, setTx] = useState<{ data: TreatmentResults; status: SectionStatus; warnings: string[]; startedAt: number | null }>(
    { data: { rows: [], removed: [] }, status: "pending", warnings: [], startedAt: null });
  const abort = useRef<AbortController | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const onLanding = !rsid && !error;
  const loading = !!rsid && !brief && !error;

  const loadTreatments = useCallback(async (id: string, ctrl: AbortController) => {
    setTx({ data: { rows: [], removed: [] }, status: "pending", warnings: [], startedAt: Date.now() });
    try {
      const r = await fetchTreatments(id, ctrl.signal);
      setTx({ data: r.treatments, status: r.status, warnings: r.warnings, startedAt: null });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setTx({ data: { rows: [], removed: [] }, status: "error", warnings: [(e as Error).message], startedAt: null });
    }
  }, []);

  const load = useCallback(async (id: string) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null); setBrief(null);
    if (!id) return;
    try {
      const b = await fetchBrief(id, ctrl.signal);
      withViewTransition(() => {
        if (ctrl.signal.aborted) return;
        setBrief(b);
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      if (b.status.treatments === "pending") {
        void loadTreatments(b.rsid, ctrl);
      } else {
        setTx({ data: b.treatments, status: b.status.treatments ?? "skipped", warnings: b.warnings.filter((w) => w.startsWith("treatments")), startedAt: null });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    }
  }, [loadTreatments]);

  useEffect(() => { void load(rsid); }, [rsid, load]);
  useEffect(() => {
    const onPop = () => setRsid(readRsid());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** `from` is the element showing the rs number that was clicked; it morphs into the brief's rs badge. */
  const search = (raw: string, from?: HTMLElement | null) => {
    if (leaving) return;
    let id = raw.trim().toLowerCase().replace(/\s+/g, "");
    if (!RSID_RE.test(id)) {
      setError(`"${raw.trim()}" isn't a dbSNP rs number. Try something like rs113488022.`);
      setBrief(null);
      return;
    }
    if (!id.startsWith("rs")) id = `rs${id}`;
    const go = () => {
      if (from) from.style.viewTransitionName = "rsid";
      withViewTransition(() => {
        setLeaving(false); setError(null); setBrief(null);
        const url = new URL(window.location.href);
        url.searchParams.set("rs", id);
        window.history.pushState({}, "", url);
        if (id === rsid) void load(id); else setRsid(id);
        window.scrollTo({ top: 0, behavior: "instant" });
      });
    };
    if (onLanding && !prefersReducedMotion()) {
      setLeaving(true);
      setTimeout(go, 380);
    } else go();
  };

  const goHome = () => withViewTransition(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("rs");
    window.history.pushState({}, "", url);
    setRsid(""); setError(null); setBrief(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  });

  return (
    <div className="flex min-h-screen flex-col">
      <header className={`sticky top-0 z-30 border-b transition-colors duration-300 print:hidden ${onLanding && !scrolled
        ? "border-slate-900/10 bg-transparent" : "border-slate-200 bg-white/90 backdrop-blur"}`}>
        <div className={`mx-auto flex h-16 items-center gap-4 px-4 sm:px-6 ${onLanding ? "max-w-7xl" : "max-w-[88rem]"}`}>
          <button type="button" onClick={goHome} className="flex shrink-0 items-center gap-2">
            <Logo />
            <span className="hidden font-semibold text-slate-900 sm:inline">{APP_NAME}</span>
          </button>
          {(rsid || error) ? <SearchBox compact initial={rsid} onSearch={search} /> : (
            <>
              <nav className="ml-4 hidden items-center gap-7 border-l border-slate-200 pl-8 text-sm text-slate-600 md:flex">
                <a href="#how" className="hover:text-slate-900">How it works ↓</a>
                <a href="#honest" className="hover:text-slate-900">How it stays honest ↓</a>
                <a href="#standards" className="hover:text-slate-900">Data &amp; standards ↓</a>
              </nav>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer"
                className="ml-auto rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700">GitHub</a>
            </>
          )}
        </div>
      </header>

      {onLanding && <Landing onSearch={search} leaving={leaving} />}
      <main className={`mx-auto w-full max-w-[88rem] flex-1 px-4 py-6 sm:px-6 ${onLanding ? "hidden" : ""}`}>
        {error && <ErrorPanel message={error} onSearch={search} />}
        {loading && <LoadingPanel rsid={rsid} />}
        {brief && !loading && <BriefView brief={brief} tx={tx} onRetryTx={() => { const c = new AbortController(); abort.current = c; void loadTreatments(brief.rsid, c); }} />}
      </main>

      <Footer />
    </div>
  );
}

function BriefView({ brief, tx, onRetryTx }: {
  brief: LoadedBrief; onRetryTx: () => void;
  tx: { data: TreatmentResults; status: SectionStatus; warnings: string[]; startedAt: number | null };
}) {
  const v = brief.variant;
  const short = brief.aliases?.names.filter((n) => n.type === "protein_short").map((n) => n.name) ?? [];
  const trials = brief.trials.trials;
  const open = trials.filter((t) => OPEN_STATUSES.has(t.status ?? "")).length;
  const verified = tx.data.rows.filter((r) => r.verified).length;
  const otherWarnings = brief.warnings.filter((w) => !w.startsWith("treatments"));
  const [txJustLoaded, setTxJustLoaded] = useState(false);
  const [prevTxStatus, setPrevTxStatus] = useState(tx.status);
  if (prevTxStatus !== tx.status) {
    setPrevTxStatus(tx.status);
    if (prevTxStatus === "pending") setTxJustLoaded(true);
  }
  const verdict = clinvarVerdict(v?.clinvar_records ?? []);
  const [collapse, setCollapse] = useState({ signal: 0, open: true });
  const toggleAll = () => setCollapse((c) => ({ signal: c.signal + 1, open: !c.open }));
  const counts: Record<string, string> = {
    variant: String(v?.clinvar_records.length ?? 0),
    treatments: tx.status === "pending" ? "…" : String(tx.data.rows.length),
    trials: String(trials.length),
    eligibility: String(brief.eligibility.length),
    papers: String(brief.papers.papers.length),
  };

  return (
    <CollapseContext.Provider value={collapse}>
    <BackToTop />
    <div className="grid gap-6 xl:grid-cols-[9.5rem_1fr]">
      <aside className="hidden animate-fade-in xl:block print:hidden">
        <BriefNav counts={counts} allOpen={collapse.open} onToggleAll={toggleAll} />
      </aside>

      <div className="min-w-0 space-y-6">
        <HeroShell>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex" style={{ viewTransitionName: "rsid" }}><Badge mono>{brief.rsid}</Badge></span>
            {brief.offlineSample && <Badge tone="shadow" title="The server wasn't reachable, so a bundled sample is shown">Offline sample</Badge>}
          </div>
          <div className="animate-fade-in">
            <h1 className="mt-4 font-serif text-5xl leading-[1.05] tracking-tight text-slate-900 sm:text-6xl">
              {v?.gene ?? "Variant"}{short.length > 0 && <span className="text-brand-700"> {short.slice(0, 3).join(" / ")}</span>}
            </h1>
            {v?.gene_name && <p className="mt-2 text-lg text-slate-600">{v.gene_name}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              {verdict && (
                <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset ${TONES[verdict.tone]}`}>
                  <span className="h-2 w-2 rounded-full bg-current" />
                  {verdict.label}
                  <span className="font-normal opacity-75">· {verdict.n} of {verdict.of} ClinVar records</span>
                </span>
              )}
              <span className="text-sm text-slate-500">Trial scoping brief · generated {formatDate(brief.generated_at)}</span>
            </div>
            <HeroActions allOpen={collapse.open} onToggleAll={toggleAll} />
          </div>
        </HeroShell>

        {otherWarnings.length > 0 && (
          <div className="rounded-xl border border-shadow/30 bg-white px-4 py-3 text-sm text-shadow">
            <p className="font-medium">Some sources couldn't be loaded, so parts of this brief are incomplete:</p>
            <ul className="mt-1 list-inside list-disc text-slate-600">{otherWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Trials found" delay={80} value={<CountUp value={brief.trials.stats.total_found} />} hint={`${open} of ${trials.length} shown are open`} href="#trials" />
          <Kpi label="Publications" delay={140} value={<CountUp value={brief.papers.total_count ?? brief.papers.papers.length} />} hint={`${brief.papers.papers.length} ranked here`} href="#papers" />
          <Kpi label="Eligibility rules" delay={200} value={<CountUp value={brief.eligibility.length} />} hint={`from ${new Set(brief.eligibility.map((c) => c.nct_id)).size} trials`} href="#eligibility" />
          <Kpi label="AI treatments" href="#treatments" delay={260} glow={txJustLoaded}
            value={tx.status === "pending"
              ? <span className="inline-flex items-center gap-2 text-base font-medium text-slate-500"><Spinner />working…</span>
              : <span key="done" className="inline-block animate-pop"><CountUp value={verified} />/{tx.data.rows.length}</span>}
            hint={tx.status === "pending" ? "the rest is ready" : "fully verified"} />
        </div>

        <Reveal delay={320}><VariantSection brief={brief} /></Reveal>
        <Reveal delay={420}><TrialsSection brief={brief} /></Reveal>
        <Reveal delay={520}><TreatmentsSection brief={brief} treatments={tx.data} status={tx.status} warnings={tx.warnings} startedAt={tx.startedAt} onRetry={onRetryTx} /></Reveal>
        <Reveal delay={620}><EligibilitySection brief={brief} /></Reveal>
        <Reveal delay={720}><PapersSection brief={brief} /></Reveal>

        <p className="rounded-xl bg-slate-100 px-4 py-3 text-xs text-slate-500">{brief.disclaimer} Results depend on what PubMed and ClinicalTrials.gov contain and may be incomplete.</p>
      </div>
    </div>
    </CollapseContext.Provider>
  );
}

const NAV: { id: string; label: string; accent: Accent }[] = [
  { id: "variant", label: "Variant", accent: "pine" },
  { id: "trials", label: "Trials", accent: "ink" },
  { id: "treatments", label: "Treatments", accent: "turquoise" },
  { id: "eligibility", label: "Eligibility", accent: "shadow" },
  { id: "papers", label: "Publications", accent: "alabaster" },
];
const NAV_ROW_REM = 2;

/** Sticky section list that highlights the section currently in view. */
function BriefNav({ counts, allOpen, onToggleAll }: { counts: Record<string, string>; allOpen: boolean; onToggleAll: () => void }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      let current = 0;
      NAV.forEach((n, i) => { const el = document.getElementById(n.id); if (el && el.getBoundingClientRect().top < 160) current = i; });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = NAV.length - 1;
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <nav className="sticky top-24 text-[13px]">
      <div className="relative">
        <span className="absolute inset-x-0 top-0 rounded-md bg-white shadow-sm ring-1 ring-slate-200 transition-transform duration-300 ease-out"
          style={{ height: `${NAV_ROW_REM}rem`, transform: `translateY(${active * NAV_ROW_REM}rem)` }} />
        {NAV.map((n, i) => (
          <a key={n.id} href={`#${n.id}`} style={{ height: `${NAV_ROW_REM}rem` }}
            className={`relative flex items-center gap-2 rounded-md px-2 transition-colors ${active === i ? "font-medium text-slate-900" : "text-slate-500 hover:text-slate-900"}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ACCENTS[n.accent].dot}`} />
            <span className="min-w-0 flex-1 truncate">{n.label}</span>
            <span className="text-[11px] tabular-nums text-slate-400">{counts[n.id]}</span>
          </a>
        ))}
      </div>
      <button type="button" onClick={onToggleAll} className="mt-3 flex items-center gap-1.5 px-2 text-xs text-slate-500 transition hover:text-slate-900">
        <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform ${allOpen ? "rotate-180" : ""}`} />{allOpen ? "Collapse all" : "Expand all"}
      </button>
    </nav>
  );
}

function HeroActions({ allOpen, onToggleAll }: { allOpen: boolean; onToggleAll: () => void }) {
  const [copied, copy] = useCopy();
  const btn = "inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 backdrop-blur transition hover:bg-white hover:text-slate-900";
  return (
    <div className="mt-6 flex flex-wrap gap-2 print:hidden">
      <button type="button" onClick={onToggleAll} className={`${btn} xl:hidden`}>
        <Icon name="chevron" className={`h-4 w-4 transition-transform ${allOpen ? "rotate-180" : ""}`} />{allOpen ? "Collapse all" : "Expand all"}
      </button>
      <button type="button" onClick={() => copy(window.location.href)} className={`${btn} ${copied ? "!text-pine !ring-turquoise" : ""}`}>
        <Icon name={copied ? "check" : "link"} className="h-4 w-4" />{copied ? "Link copied" : "Copy link"}
      </button>
      <button type="button" onClick={() => window.print()} className={btn}><Icon name="printer" className="h-4 w-4" />Print / PDF</button>
    </div>
  );
}

function HeroShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-turquoise/15 via-white to-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8 print:shadow-none">
      <Icon name="dna" className="pointer-events-none absolute -right-8 -top-10 h-64 w-64 text-pine/[0.06]" />
      <div className="relative">{children}</div>
    </div>
  );
}

function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 900);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (!show) return null;
  return (
    <button type="button" onClick={() => window.scrollTo({ top: 0 })} aria-label="Back to top"
      className="fixed bottom-6 right-6 z-30 flex h-11 w-11 animate-pop items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-700 print:hidden">
      <Icon name="arrowUp" className="h-5 w-5" />
    </button>
  );
}

function SearchBox({ onSearch, initial = "", compact = false }: { onSearch: (v: string) => void; initial?: string; compact?: boolean }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  const submit = (e: FormEvent) => { e.preventDefault(); if (value.trim()) onSearch(value); };
  return (
    <form onSubmit={submit} className={`flex w-full gap-2 ${compact ? "max-w-md" : "max-w-xl"}`} role="search">
      <label htmlFor={compact ? "q-compact" : "q"} className="sr-only">dbSNP rs number</label>
      <input id={compact ? "q-compact" : "q"} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Enter an rs number, e.g. rs113488022"
        autoComplete="off" spellCheck={false}
        className={`min-w-0 flex-1 rounded-xl border-0 bg-white font-mono shadow-sm ring-1 ring-inset ring-slate-300 placeholder:font-sans placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 ${compact ? "py-1.5 pl-3 text-sm" : "py-3 pl-4 text-base"}`} />
      <button type="submit" className={`shrink-0 rounded-xl bg-brand-700 font-semibold text-white shadow-sm transition hover:bg-brand-800 ${compact ? "px-3 text-sm" : "px-5"}`}>
        {compact ? "Search" : "Build brief"}
      </button>
    </form>
  );
}

function Landing({ onSearch, leaving }: { onSearch: (v: string, from?: HTMLElement | null) => void; leaving: boolean }) {
  const steps = [
    ["Variant & aliases", "Gene, every notation (rs, p., c., short form) and ClinVar significance, each with its source."],
    ["Trial landscape", "Matching ClinicalTrials.gov studies by phase, status and drug, ranked by evidence."],
    ["Eligibility benchmark", "The biomarker inclusion/exclusion rules other trials used, quoted word for word."],
    ["Publications", "PubMed papers ranked by study design (Oxford CEBM levels) and relevance."],
    ["Verified AI summary", "A treatment table where code checks every cited ID, quote, number and ESCAT tier."],
  ];
  const checks = [
    ["Real source", "Every row must cite a PubMed or ClinicalTrials.gov ID we actually gave the AI. Anything else is removed."],
    ["Word-for-word quote", "Each claim carries a quote; code finds it in the source text or removes the row."],
    ["Numbers match", "Every number in the outcome must appear in a quote, or the row is flagged for a human check."],
    ["Evidence tier fits", "ESMO ESCAT tiers are checked against the sources, e.g. I-A needs a randomized trial with survival data."],
  ];
  return (
    <div className="flex-1">
      <div className="relative -mt-16 overflow-hidden border-b border-slate-200 bg-slate-50 pt-16">
        <Suspense fallback={null}><DnaHelix className="absolute inset-0" boost={leaving} /></Suspense>
      <section className="relative">
        <div className="relative mx-auto flex min-h-[calc(100svh-4rem-12rem)] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 md:min-h-[600px]">
          <p className="font-serif text-xl italic text-brand-700">For clinical trial planners</p>
          <h1 className="mt-3 max-w-3xl text-[2.6rem] font-normal leading-[1.05] tracking-tight text-slate-900 sm:text-7xl sm:leading-[1.02]">
            From mutation to <br className="hidden sm:block" />trial brief.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-slate-600">
            Enter a dbSNP rs number. Get the papers, the trial landscape, how other trials screened patients, and a
            treatment summary where every claim is cited and checked.
          </p>
          <div className="mt-8 max-w-xl"><SearchBox onSearch={onSearch} /></div>
        </div>
      </section>

      <section className="relative border-t border-slate-900/10 bg-white/35">
        <div className="mx-auto grid max-w-7xl md:grid-cols-2 md:divide-x md:divide-slate-900/10">
          <div className="px-4 py-8 sm:px-6">
            <p className="font-serif text-lg italic text-slate-500">Try a demo</p>
            <p className="mt-1 text-xl text-slate-900">Cancer, cystic fibrosis, psychiatry and Lewy body dementia</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {DEMOS.map((d) => (
                <button key={d.rsid} type="button" onClick={(e) => onSearch(d.rsid, e.currentTarget.querySelector("span"))}
                  className="rounded-md border border-slate-900 px-4 py-2 text-left text-sm font-medium text-slate-900 transition hover:bg-slate-900 hover:text-white active:scale-95">
                  {d.label} <span className="ml-1 font-mono text-xs opacity-60">{d.rsid}</span>
                  <span className="block text-xs font-normal opacity-60">{d.disease}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-slate-900/10 px-4 py-8 sm:px-6 md:border-t-0 md:pl-10">
            <p className="font-serif text-lg italic text-slate-500">Why it's different</p>
            <p className="mt-1 max-w-md text-xl text-slate-900">Every AI claim is cited, and code checks the quote against its source.</p>
            <a href="#honest" className="mt-5 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700">See how it works</a>
          </div>
        </div>
      </section>
      </div>

      <section id="how" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <p className="font-serif text-lg italic text-brand-700">What you get</p>
        <h2 className="mt-1 text-3xl tracking-tight text-slate-900">One brief instead of days of searching</h2>
        <p className="mt-3 max-w-2xl text-slate-600">
          Planning a trial for a mutation means searching PubMed and ClinicalTrials.gov under every name it goes by, then
          reading protocols to see how others screened patients. This does it in seconds.
        </p>
        <ol className="mt-8 grid gap-px overflow-hidden rounded-2xl bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map(([title, text], i) => (
            <li key={title} className="bg-white p-5">
              <p className="font-mono text-xs text-brand-700">0{i + 1}</p>
              <p className="mt-2 font-medium text-slate-900">{title}</p>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="honest" className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <p className="font-serif text-lg italic text-brand-700">How it stays honest</p>
          <h2 className="mt-1 text-3xl tracking-tight text-slate-900">The AI writes. Code checks.</h2>
          <p className="mt-3 max-w-2xl text-slate-600">
            The AI only sees the highest-ranked papers and trials, and must quote them word for word. Before anything is shown,
            four checks run on every row. Rows that fail are removed, and you can see why.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {checks.map(([title, text], i) => (
              <div key={title} className="rounded-2xl border border-slate-200 p-5">
                <p className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{i + 1}</p>
                <p className="mt-3 font-medium text-slate-900">{title}</p>
                <p className="mt-1 text-sm text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="standards" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <p className="font-serif text-lg italic text-brand-700">Data &amp; standards</p>
            <h2 className="mt-1 text-2xl tracking-tight text-slate-900">Public data, published standards</h2>
          </div>
          <dl className="grid gap-6 text-sm sm:grid-cols-2 md:col-span-2">
            <div><dt className="font-medium text-slate-900">Data sources</dt>
              <dd className="mt-1 text-slate-600">MyVariant.info and ClinVar (variant), PubMed (papers), ClinicalTrials.gov (trials), Google Gemini (summary).</dd></div>
            <div><dt className="font-medium text-slate-900">Ranking papers</dt>
              <dd className="mt-1 text-slate-600"><ExtLink href="https://www.cebm.ox.ac.uk/resources/levels-of-evidence/ocebm-levels-of-evidence">Oxford CEBM 2011 Levels of Evidence</ExtLink>, by study design.</dd></div>
            <div><dt className="font-medium text-slate-900">Treatment evidence</dt>
              <dd className="mt-1 text-slate-600"><ExtLink href="https://doi.org/10.1093/annonc/mdy263">ESMO ESCAT</ExtLink> tiers (Mateo et al., Annals of Oncology 2018).</dd></div>
            <div><dt className="font-medium text-slate-900">Not medical advice</dt>
              <dd className="mt-1 text-slate-600">A research tool for planning trials. Results can be incomplete; check every claim against its source.</dd></div>
          </dl>
        </div>
      </section>
    </div>
  );
}

function LoadingPanel({ rsid }: { rsid: string }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[9.5rem_1fr]" aria-busy="true">
      <aside className="hidden space-y-3 px-2 pt-2 xl:block">
        {[78, 92, 70, 85, 64].map((w) => <div key={w} className="skeleton h-5 rounded-md" style={{ width: `${w}%` }} />)}
      </aside>
      <div className="min-w-0 space-y-6">
        <HeroShell>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex" style={{ viewTransitionName: "rsid" }}><Badge mono>{rsid}</Badge></span>
          </div>
          <div className="skeleton mt-4 h-14 w-72 max-w-full rounded-xl" />
          <div className="skeleton mt-3 h-5 w-56 rounded" />
          <p className="mt-6 flex items-center gap-2 text-sm text-slate-500">
            <Spinner />Building the brief: looking up the variant, its aliases, papers and trials…
          </p>
        </HeroShell>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="skeleton h-3 w-20 rounded" />
              <div className="skeleton mt-3 h-7 w-16 rounded" />
              <div className="skeleton mt-2 h-3 w-28 rounded" />
            </div>
          ))}
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="space-y-2 border-b border-slate-100 px-5 py-4">
              <div className="skeleton h-5 w-48 rounded" />
              <div className="skeleton h-3 w-80 max-w-full rounded" />
            </div>
            <div className="space-y-3 p-5">
              <div className="skeleton h-4 rounded" />
              <div className="skeleton h-4 w-11/12 rounded" />
              <div className="skeleton h-4 w-3/4 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorPanel({ message, onSearch }: { message: string; onSearch: (v: string) => void }) {
  return (
    <div className="mx-auto mt-12 max-w-xl rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <p className="font-semibold text-ink">Couldn't build this brief</p>
      <p className="mt-1 text-sm text-slate-600">{message}</p>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <span className="text-slate-500">Try a demo:</span>
        {DEMOS.map((d) => <button key={d.rsid} type="button" onClick={() => onSearch(d.rsid)} className="font-medium text-brand-700 hover:text-brand-800">{d.label}</button>)}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:justify-between sm:px-6">
        <p>Data: MyVariant.info · ClinVar · PubMed · ClinicalTrials.gov · Google Gemini. Evidence levels: Oxford CEBM 2011, ESMO ESCAT.</p>
        <p>Open source (MIT) · Built at HackRU 2026 · Not medical advice</p>
      </div>
    </footer>
  );
}

function Logo() {
  return (
    <svg className="h-8 w-8" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-brand-700" />
      <path d="M10 6c0 7 12 7 12 13s-12 6-12 7M22 6c0 7-12 7-12 13s12 6 12 7" stroke="white" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
