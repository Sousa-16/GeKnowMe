import { useEffect, useState, type ReactNode } from "react";
import { prefersReducedMotion, useInView } from "../lib/motion";

/** Landing-page tour of what a brief contains. Every snippet is taken from the real BRAF V600E brief. */

const ITEMS = [
  { title: "Every name it goes by", line: "rs number, protein and DNA notation, and the names papers actually use, with what ClinVar says about it." },
  { title: "Who's running trials", line: "Every matching study on ClinicalTrials.gov by phase and status, with the ones recruiting now up front." },
  { title: "How they screen patients", line: "The genetic inclusion and exclusion rules other trials used, quoted word for word." },
  { title: "The papers worth reading", line: "Up to 200 PubMed papers, strongest study designs first." },
  { title: "A treatment summary you can check", line: "Written by AI from the top sources only. Code checks every quote before you see it." },
] as const;

const DURATION = 5600;

export function WhatYouGet() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ref, seenAt] = useInView<HTMLDivElement>();
  const reduced = prefersReducedMotion();
  const running = seenAt != null && !paused && !reduced;

  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setActive((a) => (a + 1) % ITEMS.length), DURATION);
    return () => clearTimeout(id);
  }, [running, active]);

  return (
    <div ref={ref} className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
      <ol className="flex flex-col">
        {ITEMS.map((it, i) => {
          const on = i === active;
          return (
            <li key={it.title}>
              <button type="button" onClick={() => { setActive(i); setPaused(true); }} aria-pressed={on}
                className={`relative w-full overflow-hidden border-t border-slate-200 py-4 pl-1 pr-3 text-left transition-colors ${on ? "" : "hover:bg-slate-50"}`}>
                <p className={`text-lg transition-colors ${on ? "font-semibold text-slate-900" : "text-slate-500"}`}>{it.title}</p>
                <p className={`grid transition-all duration-300 ${on ? "mt-1 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <span className="overflow-hidden text-sm text-slate-600">{it.line}</span>
                </p>
                {on && (
                  <span key={`${active}-${running}`} aria-hidden
                    className={`absolute left-0 top-0 h-0.5 w-full origin-left bg-brand-600 ${running ? "wyg-progress" : ""}`}
                    style={{ animationDuration: `${DURATION}ms` }} />
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span className="h-2 w-2 rounded-full bg-brand-500" />
          <span className="font-mono">rs113488022</span>
          <span>· BRAF V600E · real brief</span>
        </div>
        <div key={active} className="min-h-[300px] p-6">
          {[<Names key="n" />, <Trials key="t" />, <Rules key="r" />, <Papers key="p" />, <AiRow key="a" />][active]}
        </div>
      </div>
    </div>
  );
}

function In({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return <div className={`wyg-in ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</div>;
}

function Names() {
  const names = ["rs113488022", "V600E", "p.Val600Glu", "c.1799T>A", "BRAF V600"];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setInterval(() => setI((n) => (n + 1) % names.length), 1000);
    return () => clearInterval(id);
  }, [names.length]);
  return (
    <div className="flex h-full flex-col gap-6">
      <In><p className="text-sm text-slate-500">One mutation, written five different ways:</p></In>
      <p key={i} className="wyg-in font-mono text-4xl text-slate-900 sm:text-5xl">{names[i]}</p>
      <In delay={200} className="flex flex-wrap gap-2">
        {names.map((n, k) => (
          <span key={n} className={`rounded-md px-2 py-1 font-mono text-xs ring-1 ring-inset transition-colors ${k === i ? "bg-brand-50 text-brand-800 ring-brand-300" : "text-slate-500 ring-slate-200"}`}>{n}</span>
        ))}
      </In>
      <In delay={350}>
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3.5 py-1.5 text-sm font-semibold text-white">
          <span className="h-2 w-2 rounded-full bg-current" />Pathogenic or likely pathogenic
          <span className="font-normal opacity-75">· 16 of 20 ClinVar records</span>
        </span>
      </In>
    </div>
  );
}

function Trials() {
  const phases: [string, number][] = [["Early 1", 3], ["Phase 1", 13], ["Phase 1/2", 10], ["Phase 2", 41], ["Phase 2/3", 4], ["Phase 3", 13], ["Phase 4", 2]];
  const max = 41;
  return (
    <div className="flex flex-col gap-5">
      <In><p className="text-sm text-slate-500"><b className="text-slate-900">256 trials</b> found · <b className="text-slate-900">31</b> of the top 100 open to enrollment</p></In>
      <div className="flex h-44 items-end gap-2 sm:gap-3">
        {phases.map(([label, n], k) => (
          <div key={label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <span className="wyg-in text-xs font-semibold tabular-nums text-slate-700" style={{ animationDelay: `${300 + k * 90}ms` }}>{n}</span>
            <div className="wyg-bar w-full rounded-t-md bg-gradient-to-t from-brand-700 to-brand-400"
              style={{ height: `${(n / max) * 100}%`, animationDelay: `${k * 90}ms` }} />
            <span className="whitespace-nowrap text-[11px] text-slate-500">{label}</span>
          </div>
        ))}
      </div>
      <In delay={800}><p className="text-sm text-slate-600">Most are Phase 2: early evidence that a drug works.</p></In>
    </div>
  );
}

function Rules() {
  return (
    <div className="flex flex-col gap-4">
      <In><p className="text-sm text-slate-500">Quoted from the trial records, word for word:</p></In>
      <In delay={150} className="rounded-xl p-4 ring-1 ring-slate-200">
        <p className="mb-2 flex flex-wrap gap-1.5 text-xs">
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">Inclusion</span>
          <span className="rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-800">Mutation required</span>
          <span className="font-mono text-slate-500">NCT05503797</span>
        </p>
        <p className="text-slate-700">“Documented <mark className="wyg-mark rounded bg-transparent px-0.5 text-slate-900">BRAF V600E</mark> mutation in tumor and/or liquid biopsy detected by an analytically validated test.”</p>
      </In>
      <In delay={700} className="rounded-xl p-4 ring-1 ring-slate-200">
        <p className="mb-2 flex flex-wrap gap-1.5 text-xs">
          <span className="rounded bg-rose-50 px-1.5 py-0.5 font-medium text-rose-700">Exclusion</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">Other alteration excluded</span>
          <span className="font-mono text-slate-500">NCT06610682</span>
        </p>
        <p className="text-slate-700">“Known co-occurring NF1 and/or RAS-related alteration known to cause resistance.”</p>
      </In>
      <In delay={1100}><p className="text-sm text-slate-600">256 rules like these, from 88 trials, sorted by what they screen for.</p></In>
    </div>
  );
}

function Papers() {
  const papers = [
    ["N Engl J Med · 2019", "Encorafenib, Binimetinib, and Cetuximab in BRAF V600E-Mutated Colorectal Cancer"],
    ["J Clin Oncol · 2021", "Encorafenib Plus Cetuximab as a New Standard of Care for Previously Treated BRAF V600E-Mutant Metastatic Colorectal Cancer: Updated Survival Results and Subgroup Analyses from the BEACON Study"],
    ["Eur J Cancer · 2024", "COLUMBUS 7-year update: A randomized, open-label, phase III trial of encorafenib plus binimetinib versus vemurafenib or encorafenib in patients with BRAF V600E/K-mutant melanoma"],
  ];
  return (
    <div className="flex flex-col gap-3">
      <In><p className="text-sm text-slate-500">8,966 papers mention it. These come first:</p></In>
      {papers.map(([meta, title], k) => (
        <In key={title} delay={150 + k * 220} className="flex items-start gap-3 rounded-xl p-3 ring-1 ring-slate-200">
          <span className="mt-0.5 shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Randomized · Phase III</span>
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-900" title={title}>{title}</p>
            <p className="mt-0.5 text-xs text-slate-500">{meta}</p>
          </div>
        </In>
      ))}
      <In delay={900}><p className="text-sm text-slate-600">Ranked by study design (Oxford levels of evidence), then by how closely they match the mutation.</p></In>
    </div>
  );
}

function AiRow() {
  const checks = ["PMID:33503393 is one of the sources it was given", "The quote is in that paper, word for word", "26.8 and 9.3 each appear in a quote", "ESCAT I-A fits a randomized trial with survival data"];
  return (
    <div className="flex flex-col gap-4">
      <In className="rounded-xl p-4 ring-1 ring-slate-200">
        <p className="font-semibold text-slate-900">Encorafenib + Cetuximab + Binimetinib</p>
        <p className="text-sm text-slate-500">Previously treated metastatic colorectal cancer</p>
        <p className="mt-2 text-sm text-slate-800">ORR 26.8%, median OS 9.3 months</p>
        <p className="mt-2 border-l-2 border-brand-300 pl-3 text-sm text-slate-600">
          “Median OS was <mark className="wyg-mark rounded bg-transparent px-0.5 text-slate-900">9.3 months</mark> (95% CI, 8.2 to 10.8) for triplet and 5.9 months (95% CI, 5.1 to 7.1) for control …”
        </p>
      </In>
      <ul className="space-y-1.5 text-sm">
        {checks.map((c, k) => (
          <li key={c} className="wyg-in flex items-center gap-2 text-slate-700" style={{ animationDelay: `${600 + k * 450}ms` }}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">✓</span>{c}
          </li>
        ))}
      </ul>
      <In delay={2500}><p className="text-sm font-semibold text-brand-800">Fully verified. Rows that fail are removed or flagged, never hidden.</p></In>
    </div>
  );
}
