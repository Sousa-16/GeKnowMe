import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Brief, SectionStatus, TreatmentResults } from "./types";
import { ApiError, DEMOS, fetchBrief, fetchTreatments } from "./lib/api";
import { formatDate, nf, OPEN_STATUSES } from "./lib/format";
import { VariantSection } from "./components/VariantSection";
import { TrialsSection } from "./components/TrialsSection";
import { EligibilitySection } from "./components/EligibilitySection";
import { TreatmentsSection } from "./components/TreatmentsSection";
import { PapersSection } from "./components/PapersSection";
import { Badge, Kpi, Spinner } from "./components/ui";

export const APP_NAME = "Variant Trial Scope";
const RSID_RE = /^(rs)?\d{1,12}$/i;

type LoadedBrief = Brief & { offlineSample?: boolean };

function readRsid() {
  return new URLSearchParams(window.location.search).get("rs")?.trim().toLowerCase() ?? "";
}

export default function App() {
  const [rsid, setRsid] = useState(readRsid);
  const [brief, setBrief] = useState<LoadedBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tx, setTx] = useState<{ data: TreatmentResults; status: SectionStatus; warnings: string[]; startedAt: number | null }>(
    { data: { rows: [], removed: [] }, status: "pending", warnings: [], startedAt: null });
  const abort = useRef<AbortController | null>(null);

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
    setLoading(true);
    try {
      const b = await fetchBrief(id, ctrl.signal);
      setBrief(b);
      setLoading(false);
      window.scrollTo({ top: 0 });
      if (b.status.treatments === "pending") {
        void loadTreatments(b.rsid, ctrl);
      } else {
        setTx({ data: b.treatments, status: b.status.treatments ?? "skipped", warnings: b.warnings.filter((w) => w.startsWith("treatments")), startedAt: null });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setLoading(false);
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    }
  }, [loadTreatments]);

  useEffect(() => { void load(rsid); }, [rsid, load]);
  useEffect(() => {
    const onPop = () => setRsid(readRsid());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const search = (raw: string) => {
    let id = raw.trim().toLowerCase().replace(/\s+/g, "");
    if (!RSID_RE.test(id)) {
      setError(`"${raw.trim()}" isn't a dbSNP rs number. Try something like rs113488022.`);
      setBrief(null);
      return;
    }
    if (!id.startsWith("rs")) id = `rs${id}`;
    const url = new URL(window.location.href);
    url.searchParams.set("rs", id);
    window.history.pushState({}, "", url);
    if (id === rsid) void load(id); else setRsid(id);
  };

  const goHome = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("rs");
    window.history.pushState({}, "", url);
    setRsid(""); setError(null); setBrief(null);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <button type="button" onClick={goHome} className="flex shrink-0 items-center gap-2">
            <Logo />
            <span className="hidden font-semibold text-slate-900 sm:inline">{APP_NAME}</span>
          </button>
          {(rsid || error) && <SearchBox compact initial={rsid} onSearch={search} />}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {!rsid && !error && <Landing onSearch={search} />}
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
  const nav = [
    ["variant", "Variant"], ["treatments", "AI treatment summary"], ["trials", "Trial landscape"],
    ["eligibility", "Eligibility criteria"], ["papers", "Publications"],
  ] as const;

  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_1fr]">
      <aside className="hidden lg:block">
        <nav className="sticky top-20 space-y-1 text-sm">
          {nav.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm">{label}</a>
          ))}
          <p className="px-3 pt-4 text-xs leading-relaxed text-slate-400">Every section has its own CSV export and links each item to its source.</p>
        </nav>
      </aside>

      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {v?.gene ?? "Variant"} {short.slice(0, 3).join(" / ")}
              </h1>
              <Badge mono>{brief.rsid}</Badge>
              {brief.offlineSample && <Badge tone="amber" title="The server wasn't reachable, so a bundled sample is shown">Offline sample</Badge>}
              {brief.from_demo && <Badge tone="blue" title="Pre-generated for the demo; add ?refresh=true to the API call for live data">Saved demo brief</Badge>}
            </div>
            <p className="mt-1 text-sm text-slate-500">Trial scoping brief · generated {formatDate(brief.generated_at)}</p>
          </div>
        </div>

        {otherWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Some sources couldn't be loaded, so parts of this brief are incomplete:</p>
            <ul className="mt-1 list-inside list-disc text-amber-800">{otherWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Trials found" value={nf.format(brief.trials.stats.total_found)} hint={`${open} of ${trials.length} shown are open`} href="#trials" />
          <Kpi label="Papers" value={nf.format(brief.papers.total_count ?? brief.papers.papers.length)} hint={`${brief.papers.papers.length} ranked here`} href="#papers" />
          <Kpi label="Eligibility rules" value={nf.format(brief.eligibility.length)} hint={`from ${new Set(brief.eligibility.map((c) => c.nct_id)).size} trials`} href="#eligibility" />
          <Kpi label="AI treatments" href="#treatments"
            value={tx.status === "pending" ? <span className="inline-flex items-center gap-2 text-base font-medium text-slate-500"><Spinner />working…</span> : `${verified}/${tx.data.rows.length}`}
            hint={tx.status === "pending" ? "the rest is ready" : "fully verified"} />
        </div>

        <VariantSection brief={brief} />
        <TreatmentsSection brief={brief} treatments={tx.data} status={tx.status} warnings={tx.warnings} startedAt={tx.startedAt} onRetry={onRetryTx} />
        <TrialsSection brief={brief} />
        <EligibilitySection brief={brief} />
        <PapersSection brief={brief} />

        <p className="rounded-xl bg-slate-100 px-4 py-3 text-xs text-slate-500">{brief.disclaimer} Results depend on what PubMed and ClinicalTrials.gov contain and may be incomplete.</p>
      </div>
    </div>
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

function Landing({ onSearch }: { onSearch: (v: string) => void }) {
  const steps = [
    ["Variant & aliases", "Gene, every notation (rs, p., c., short form) and ClinVar significance, each with its source."],
    ["Trial landscape", "Matching ClinicalTrials.gov studies by phase, status and drug, ranked by evidence."],
    ["Eligibility benchmark", "The biomarker inclusion/exclusion rules other trials used, quoted word for word."],
    ["Publications", "PubMed papers ranked by study design (Oxford CEBM levels) and relevance."],
    ["Verified AI summary", "A treatment table where code checks every cited ID, quote, number and ESCAT tier."],
  ];
  return (
    <div className="py-8 sm:py-14">
      <div className="mx-auto max-w-3xl text-center">
        <Badge tone="brand">For clinical trial planners, researchers &amp; biostatisticians</Badge>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">From a mutation to a cited trial scoping brief</h1>
        <p className="mt-4 text-lg text-slate-600">
          Planning a trial for a genetic mutation means searching PubMed and ClinicalTrials.gov under every name the mutation goes by.
          Enter a dbSNP rs number and get the landscape in seconds, with a source for every fact.
        </p>
        <div className="mt-8 flex justify-center"><SearchBox onSearch={onSearch} /></div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-500">
          <span>Try:</span>
          {DEMOS.map((d) => (
            <button key={d.rsid} type="button" onClick={() => onSearch(d.rsid)}
              className="rounded-full bg-white px-3 py-1 font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:ring-brand-400">
              {d.label} <span className="font-mono text-xs text-slate-400">{d.rsid}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-14 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map(([title, text], i) => (
          <div key={title} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs font-semibold text-brand-700">{i + 1}</p>
            <p className="mt-1 font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-sm text-slate-600">{text}</p>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-10 max-w-2xl text-center text-xs text-slate-400">Research tool for clinical trial planning. Not medical advice.</p>
    </div>
  );
}

function LoadingPanel({ rsid }: { rsid: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
      <Spinner className="mx-auto h-8 w-8" />
      <p className="mt-4 font-medium text-slate-900">Building the brief for <span className="font-mono">{rsid}</span></p>
      <p className="mt-1 text-sm text-slate-500">Looking up the variant, its aliases, papers and trials…</p>
    </div>
  );
}

function ErrorPanel({ message, onSearch }: { message: string; onSearch: (v: string) => void }) {
  return (
    <div className="mx-auto mt-12 max-w-xl rounded-2xl bg-white p-6 shadow-sm ring-1 ring-rose-200">
      <p className="font-semibold text-rose-800">Couldn't build this brief</p>
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
