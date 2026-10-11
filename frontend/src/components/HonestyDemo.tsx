import { useEffect, useState } from "react";
import { prefersReducedMotion, useInView } from "../lib/motion";
import { CountUp } from "./ui";

/** Landing-page run of the proof check: an AI-written row goes through the four code checks.
 * The first two cases are real rows from the saved demo briefs; the third is a labelled illustration. */

type Result = "pass" | "warn" | "fail" | "skip";
interface Case {
  tab: string; drug: string; setting: string; outcome: string; source: string; quote: string;
  results: [Result, string][]; verdict: string; tone: "pass" | "warn" | "fail"; note?: string;
}

const GATES = [
  ["Real source", "Is the cited ID one of the sources we gave the AI?"],
  ["Exact quote", "Is the quote in that source, word for word?"],
  ["Numbers match", "Is every number in the outcome inside a quote?"],
  ["Tier fits", "Does the evidence tier fit the cited study? (cancer rows)"],
] as const;

const CASES: Case[] = [
  {
    tab: "Passes", drug: "Encorafenib + Cetuximab + Binimetinib", setting: "BRAF V600E · metastatic colorectal cancer",
    outcome: "ORR 26.8%, median OS 9.3 months", source: "PMID:33503393",
    quote: "Median OS was 9.3 months (95% CI, 8.2 to 10.8) for triplet and 5.9 months (95% CI, 5.1 to 7.1) for control …",
    results: [["pass", "One of the top-ranked papers it was given"], ["pass", "Found word for word in the abstract"],
      ["pass", "26.8 and 9.3 each appear in a quote"], ["pass", "I-A fits: a randomized phase 3 with survival data"]],
    verdict: "Shown as fully verified", tone: "pass",
  },
  {
    tab: "Flagged", drug: "Tolcapone", setting: "COMT V158M · healthy volunteers",
    outcome: "… enhanced visual learning d=0.35 in low performers and reduced false alarm rate d=0.8", source: "PMID:29020372",
    quote: "Tolcapone enhanced visual learning in low-baseline MATRICS Consensus Cognitive Battery performers (d=0.35) …",
    results: [["pass", "One of the papers it was given"], ["pass", "Found word for word in the abstract"],
      ["warn", "0.8 isn't in any quote. It is in the abstract, but the AI didn't quote it"], ["skip", "Not a cancer row, so ESCAT doesn't apply"]],
    verdict: "Shown, flagged for a person to check", tone: "warn",
  },
  {
    tab: "Removed", drug: "A drug the AI made a claim about", setting: "Illustration: an invented citation",
    outcome: "A response rate, with a paper ID to back it up", source: "PMID that was never in its sources",
    quote: "A sentence that sounds right, but comes from nowhere we gave it …",
    results: [["fail", "Not one of the sources it was given"], ["skip", "Not checked: the row is already out"],
      ["skip", "Not checked"], ["skip", "Not checked"]],
    verdict: "Removed, and listed under \"removed by the checks\"", tone: "fail",
    note: "None of our demo variants produced a removal, so this case is an illustration of the rule, not a real row.",
  },
];

const STYLE: Record<Result, { ring: string; dot: string; icon: string; text: string }> = {
  pass: { ring: "ring-emerald-300 bg-emerald-50", dot: "bg-emerald-600", icon: "✓", text: "text-emerald-800" },
  warn: { ring: "ring-amber-300 bg-amber-50", dot: "bg-amber-500", icon: "!", text: "text-amber-800" },
  fail: { ring: "ring-rose-300 bg-rose-50", dot: "bg-rose-600", icon: "✕", text: "text-rose-800" },
  skip: { ring: "ring-slate-200 bg-slate-50", dot: "bg-slate-300", icon: "–", text: "text-slate-500" },
};
const STEP_MS = 850;
const HOLD_MS = 3200;

export function HonestyDemo() {
  const reduced = prefersReducedMotion();
  const [ref, seenAt] = useInView<HTMLDivElement>();
  const [c, setC] = useState(0);
  const [step, setStep] = useState(reduced ? 5 : 0);     // gates revealed so far; 5 = verdict shown
  const [paused, setPaused] = useState(false);
  const cur = CASES[c];

  useEffect(() => {
    if (seenAt == null || reduced) return;
    if (step < 5) { const id = setTimeout(() => setStep(step + 1), step === 0 ? 400 : STEP_MS); return () => clearTimeout(id); }
    if (paused) return;
    const id = setTimeout(() => { setC((c + 1) % CASES.length); setStep(0); }, HOLD_MS);
    return () => clearTimeout(id);
  }, [seenAt, reduced, step, paused, c]);

  const pick = (i: number) => { setC(i); setStep(reduced ? 5 : 0); };
  const verdict = STYLE[cur.tone];

  return (
    <div ref={ref} className="mt-10" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="flex flex-wrap gap-2" role="tablist">
        {CASES.map((k, i) => (
          <button key={k.tab} type="button" role="tab" aria-selected={i === c} onClick={() => pick(i)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ring-1 ring-inset transition ${i === c ? "bg-slate-900 text-white ring-slate-900" : "text-slate-600 ring-slate-300 hover:bg-slate-50"}`}>
            {k.tab}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        {/* the AI's row, as written */}
        <div key={`row-${c}`} className="wyg-in rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">What the AI wrote</p>
          <p className="mt-2 font-semibold text-slate-900">{cur.drug}</p>
          <p className="text-sm text-slate-500">{cur.setting}</p>
          <p className="mt-3 text-sm text-slate-800">{cur.outcome}</p>
          <p className="mt-3 font-mono text-xs text-brand-700">{cur.source}</p>
          <p className="mt-1 border-l-2 border-slate-200 pl-3 text-sm italic text-slate-600">“{cur.quote}”</p>
          {cur.note && <p className="mt-3 text-xs text-slate-500">{cur.note}</p>}
        </div>

        {/* the four checks, run one after another */}
        <div className="flex flex-col">
          <ol className="relative flex flex-col gap-3">
            <span aria-hidden className="absolute bottom-4 left-[15px] top-4 w-0.5 bg-slate-200" />
            {GATES.map(([title, q], i) => {
              const done = step > i;
              const [res, why] = cur.results[i];
              const st = done ? STYLE[res] : null;
              return (
                <li key={title} className={`relative flex gap-4 rounded-xl p-3 ring-1 ring-inset transition-colors duration-300 ${st ? st.ring : "bg-white ring-slate-200"}`}>
                  <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white transition-colors duration-300 ${st ? st.dot : "bg-slate-300"} ${step === i + 1 && !reduced ? "animate-pop" : ""}`}>
                    {st ? st.icon : i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{title} <span className="font-normal text-slate-500">· {q}</span></p>
                    <p key={`${c}-${i}-${done}`} className={`text-sm ${done ? `wyg-in ${st!.text}` : "text-slate-400"}`}>{done ? why : "Waiting…"}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ring-1 ring-inset transition-opacity duration-300 ${verdict.ring} ${verdict.text} ${step >= 5 ? "opacity-100" : "opacity-0"}`}>
            {verdict.icon} {cur.verdict}
          </div>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-slate-200 ring-1 ring-slate-200 md:grid-cols-4">
        {([[43, "AI rows checked"], [41, "passed every check"], [2, "flagged for a person"], [0, "invented sources shown"]] as const).map(([n, label]) => (
          <div key={label} className="bg-white p-5">
            <p className="font-serif text-4xl text-slate-900">{seenAt != null ? <CountUp value={n} /> : 0}</p>
            <p className="mt-1 text-sm text-slate-600">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">Across the four demo variants on this page.</p>
    </div>
  );
}
