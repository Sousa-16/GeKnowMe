import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Brief, EscatTier, Evidence, TreatmentResults, TreatmentRow, SectionStatus } from "../types";
import { Icon } from "./icons";
import { downloadCsv } from "../lib/csv";
import { findQuoteRanges } from "../lib/highlight";
import { Badge, Button, DownloadIcon, ExtLink, Section, Spinner, StatusNote } from "./ui";

export const ESCAT: Record<EscatTier, string> = {
  "I-A": "Randomized trial(s) in this cancer type show a meaningful survival improvement",
  "I-B": "Non-randomized prospective trial(s) in this cancer type show meaningful clinical benefit",
  "I-C": "Trials across several cancer types (e.g. basket trials) show similar benefit",
  "II-A": "Retrospective studies show benefit compared with patients without the mutation",
  "II-B": "Prospective trial(s) show higher response rates, but no survival data yet",
  "III-A": "Benefit shown for this mutation, but in a different cancer type",
  "III-B": "A similar mutation in the same gene/pathway has evidence; this one doesn't yet",
  "IV": "Lab or animal evidence only",
  "V": "Responses seen, but no meaningful benefit on its own",
};

export const OCEBM: Record<number, string> = {
  1: "Systematic review / meta-analysis of randomized trials",
  2: "Randomized trial",
  3: "Non-randomized or observational study",
  4: "Case series / case report",
  5: "Lab or animal evidence only",
};

function levelTone(l: number) {
  return l <= 2 ? "pine" as const : l === 3 ? "turquoise" as const : "slate" as const;
}

function tierTone(t: EscatTier) {
  if (t.startsWith("I-")) return "pine" as const;
  if (t.startsWith("II-")) return "turquoise" as const;
  return "slate" as const;
}

const STRENGTHS = [
  { id: "strong", title: "Strongest evidence", dot: "bg-pine", text: "Randomized trials, or ESCAT I-A / I-B: clear benefit shown for this mutation." },
  { id: "supporting", title: "Supporting evidence", dot: "bg-turquoise", text: "Non-randomized studies, basket trials or response rates without survival data yet." },
  { id: "early", title: "Early or indirect evidence", dot: "bg-slate-400", text: "Case reports, lab work, or evidence from another cancer type or a related mutation." },
] as const;

/** ESCAT decides for cancer rows (it's judged per drug and cancer type); Oxford level otherwise. */
function strengthOf(r: TreatmentRow): (typeof STRENGTHS)[number]["id"] {
  if (r.is_cancer && r.escat_tier) {
    if (r.escat_tier === "I-A" || r.escat_tier === "I-B") return "strong";
    return r.escat_tier === "I-C" || r.escat_tier.startsWith("II-") ? "supporting" : "early";
  }
  const l = r.ocebm_level;
  return l != null && l <= 2 ? "strong" : l === 3 ? "supporting" : "early";
}

function TreatmentName({ r }: { r: TreatmentRow }) {
  return (
    <div>
      <p className="font-semibold text-slate-900">{r.drug}</p>
      <p className="mt-0.5 text-sm text-slate-500">{r.setting}</p>
      {r.variant_specific === false && (
        <p className="mt-1.5"><Badge tone="shadow" title="None of the cited sources mention this variant: the evidence is about the disease or gene in general, not carriers of this variant.">Not specific to this variant</Badge></p>
      )}
    </div>
  );
}

function Outcome({ r }: { r: TreatmentRow }) {
  return (
    <div className="leading-relaxed text-slate-700">
      {r.outcome}
      {r.verified
        ? <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-pine"><Icon name="shield" className="h-3.5 w-3.5" />Quotes and numbers checked</p>
        : r.warnings.map((w) => <p key={w} className="mt-1.5 text-xs font-medium text-shadow">! {w}</p>)}
    </div>
  );
}

const DOT_COLORS = { pine: "bg-pine", turquoise: "bg-turquoise", slate: "bg-slate-400" };

function EvidenceStrength({ r }: { r: TreatmentRow }) {
  const l = r.ocebm_level;
  return (
    <div className="space-y-2">
      <div title={l != null ? `Oxford CEBM level ${l}: ${OCEBM[l]} (from the cited sources' study design). Level 1 is strongest.` : "No cited source has a rankable study design (e.g. narrative reviews)"}>
        <div className="flex items-center gap-1" aria-label={l != null ? `Oxford level ${l} of 5` : "Oxford level not available"}>
          {[1, 2, 3, 4, 5].map((d) => <span key={d} className={`h-2 w-2 rounded-full ${l != null && d <= 6 - l ? DOT_COLORS[levelTone(l)] : "bg-slate-200"}`} />)}
          <span className="ml-1.5 text-xs font-medium text-slate-700">{l != null ? `Oxford ${l}` : "Oxford n/a"}</span>
        </div>
        {l != null && <p className="mt-0.5 text-xs text-slate-500">{OCEBM[l]}</p>}
      </div>
      {r.is_cancer && r.escat_tier && (
        <div>
          <Badge tone={tierTone(r.escat_tier)} title={ESCAT[r.escat_tier]}>ESCAT {r.escat_tier}</Badge>
          {r.escat_reason && <p className="mt-1 text-xs leading-relaxed text-slate-500">{r.escat_reason}</p>}
        </div>
      )}
    </div>
  );
}

function Sources({ r, onView }: { r: TreatmentRow; onView: (e: Evidence) => void }) {
  const [all, setAll] = useState(false);
  const list = all ? r.evidence : r.evidence.slice(0, 1);
  return (
    <div>
      <ul className="space-y-3">
        {list.map((e, j) => (
          <li key={j} className={`text-sm ${j ? "animate-fade-up" : ""}`}>
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
              <ExtLink href={e.url} className="font-mono">{e.source_id}</ExtLink>
              <button type="button" onClick={() => onView(e)} className="font-medium text-slate-500 hover:text-brand-700 print:hidden">view in source</button>
            </span>
            <span className="mt-1 block border-l-2 border-slate-200 pl-2.5 leading-relaxed text-slate-600">“{e.quote}”</span>
          </li>
        ))}
      </ul>
      {r.evidence.length > 1 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-xs font-semibold text-brand-700 hover:text-brand-800 print:hidden">
          {all ? "Show fewer" : `+${r.evidence.length - 1} more source${r.evidence.length > 2 ? "s" : ""}`}
        </button>
      )}
    </div>
  );
}

interface Props { brief: Brief; treatments: TreatmentResults; status: SectionStatus; warnings: string[]; startedAt: number | null; onRetry: () => void }

export function TreatmentsSection({ brief, treatments, status, warnings, startedAt, onRetry }: Props) {
  const [source, setSource] = useState<Evidence | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const { rows, removed } = treatments;
  const verified = rows.filter((r) => r.verified).length;
  const sentPapers = brief.papers.papers.filter((p) => p.sent_to_ai && p.abstract).length;
  const sentTrials = brief.trials.trials.filter((t) => t.sent_to_ai).length;

  const exportCsv = () => downloadCsv(`${brief.rsid}-treatments.csv`,
    ["drug", "setting", "outcome", "variant_specific", "is_cancer", "oxford_level", "escat_tier", "escat_reason", "verified", "warnings", "sources", "quotes", "urls"],
    rows.map((r) => [r.drug, r.setting, r.outcome, r.variant_specific, r.is_cancer, r.ocebm_level, r.escat_tier, r.escat_reason, r.verified, r.warnings.join("; "),
      r.evidence.map((e) => e.source_id).join("; "), r.evidence.map((e) => e.quote).join(" | "), r.evidence.map((e) => e.url).join("; ")]));

  return (
    <Section id="treatments" title="AI treatment summary" icon="pill" accent="turquoise"
      subtitle={<>Written by Gemini from the {sentPapers} highest-scoring papers and {sentTrials} trials only. Every claim cites a source and a word-for-word quote, which code checks.</>}
      actions={<>
        <Button variant="ghost" onClick={() => setShowLegend(!showLegend)}>{showLegend ? "Hide" : "What do the levels mean?"}</Button>
        {rows.length > 0 && <Button onClick={exportCsv}><DownloadIcon />Treatments CSV</Button>}
      </>}>
      <div inert={!showLegend} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${showLegend ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden"><EscatLegend /></div>
      </div>
      {status === "pending" ? <Pending startedAt={startedAt} /> :
        status === "error" ? (
          <div className="space-y-3">
            <StatusNote status="error" warnings={warnings} />
            <Button onClick={onRetry}>Try again</Button>
          </div>
        ) : !rows.length ? <StatusNote status={status === "ok" ? "empty" : status} emptyText="The AI found no treatments that the sources support." warnings={warnings} /> : (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="pine"><Icon name="shield" className="h-3.5 w-3.5" />{verified} fully verified</Badge>
              {rows.length - verified > 0 && <Badge tone="shadow">! {rows.length - verified} need a check</Badge>}
              {removed.length > 0 && <Badge tone="shadow">✕ {removed.length} removed by the proof check</Badge>}
              {rows.some((r) => r.variant_specific === false) && (
                <Badge tone="shadow" title="Their sources discuss the disease or gene in general, not carriers of this variant">
                  {rows.filter((r) => r.variant_specific === false).length} not specific to this variant
                </Badge>
              )}
            </div>
            <div className="space-y-8">
              {STRENGTHS.map((g) => {
                const groupRows = rows.filter((r) => strengthOf(r) === g.id);
                if (!groupRows.length) return null;
                const start = rows.findIndex((r) => strengthOf(r) === g.id);
                return (
                  <div key={g.id}>
                    <div className="mb-3 flex items-baseline gap-3">
                      <span className={`h-2.5 w-2.5 shrink-0 translate-y-[-1px] rounded-full ${g.dot}`} />
                      <h3 className="text-lg font-semibold text-slate-900">{g.title} <span className="font-normal text-slate-400">· {groupRows.length}</span></h3>
                      <p className="hidden text-sm text-slate-500 md:block">{g.text}</p>
                    </div>
                    <div className="hidden overflow-x-auto rounded-xl ring-1 ring-slate-200 md:block">
                      <table className="w-full min-w-[760px] table-fixed text-sm">
                        <colgroup><col className="w-[22%]" /><col className="w-[26%]" /><col className="w-[20%]" /><col className="w-[32%]" /></colgroup>
                        <thead className="bg-slate-50 text-left text-xs text-slate-500">
                          <tr>
                            <th className="px-4 py-2.5 font-medium">Treatment</th>
                            <th className="px-4 py-2.5 font-medium">Reported outcome</th>
                            <th className="px-4 py-2.5 font-medium">Evidence strength</th>
                            <th className="px-4 py-2.5 font-medium">Sources &amp; quotes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 align-top">
                          {groupRows.map((r, i) => (
                            <tr key={r.drug + i} className={`animate-fade-up ${r.verified ? "" : "bg-slate-50"}`} style={{ animationDelay: `${(start + i) * 90}ms` }}>
                              <td className="px-4 py-4"><TreatmentName r={r} /></td>
                              <td className="px-4 py-4"><Outcome r={r} /></td>
                              <td className="px-4 py-4"><EvidenceStrength r={r} /></td>
                              <td className="px-4 py-4"><Sources r={r} onView={setSource} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <ul className="space-y-3 md:hidden">
                      {groupRows.map((r, i) => (
                        <li key={r.drug + i} className={`animate-fade-up space-y-3 rounded-xl p-4 ring-1 ring-slate-200 ${r.verified ? "" : "bg-slate-50"}`} style={{ animationDelay: `${(start + i) * 90}ms` }}>
                          <TreatmentName r={r} />
                          <Outcome r={r} />
                          <EvidenceStrength r={r} />
                          <div className="border-t border-slate-100 pt-3"><Sources r={r} onView={setSource} /></div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            {removed.length > 0 && (
              <details className="mt-4 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
                <summary className="cursor-pointer font-medium text-shadow">{removed.length} AI rows removed because their sources didn't back them up</summary>
                <ul className="mt-2 space-y-1 text-slate-700">
                  {removed.map((r, i) => <li key={i}><span className="font-medium">{r.drug}</span>: {r.reason}</li>)}
                </ul>
              </details>
            )}
          </>
        )}
      {source && <SourcePanel brief={brief} evidence={source} onClose={() => setSource(null)} />}
    </Section>
  );
}

function Pending({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const secs = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const steps = [
    [0, "Sending the top papers and trials to Gemini"],
    [8, "Gemini is writing the treatment table"],
    [25, "Still working: the model is busy, retrying or switching to the backup model"],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl bg-brand-50/60 p-4 ring-1 ring-brand-100">
        <Spinner className="mt-0.5 h-5 w-5" />
        <div className="text-sm">
          <p className="font-medium text-brand-900">Generating the treatment summary… <span className="tabular-nums text-brand-700">{secs}s</span></p>
          <ul className="mt-1 space-y-0.5 text-brand-800/80">
            {steps.filter(([t]) => secs >= t).map(([, s]) => <li key={s} className="animate-fade-up">{s}</li>)}
            {secs >= 3 && <li className="animate-fade-up">Then code checks every quote, number and evidence tier against the sources</li>}
          </ul>
          <p className="mt-2 text-xs text-brand-800/70">Usually 10–30 seconds. Everything else above is ready to use.</p>
        </div>
      </div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200" aria-hidden>
        <div className="h-8 bg-slate-50" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid grid-cols-[19%_22%_21%_1fr] gap-4 px-3 py-4">
            <div className="space-y-2"><div className="skeleton h-4 w-3/4 rounded" /><div className="skeleton h-3 w-1/2 rounded" /></div>
            <div className="space-y-2"><div className="skeleton h-3 rounded" /><div className="skeleton h-3 w-2/3 rounded" /></div>
            <div className="flex gap-1"><div className="skeleton h-5 w-16 rounded-md" /><div className="skeleton h-5 w-14 rounded-md" /></div>
            <div className="space-y-2"><div className="skeleton h-3 w-24 rounded" /><div className="skeleton h-3 rounded" /><div className="skeleton h-3 w-5/6 rounded" /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EscatLegend() {
  return (
    <div className="mb-4 space-y-4 rounded-xl bg-slate-50 p-4 text-sm ring-1 ring-slate-200">
      <div>
        <p className="mb-2 text-slate-600">
          <span className="font-medium text-slate-800">Every row: </span>
          <ExtLink href="https://www.cebm.ox.ac.uk/resources/levels-of-evidence/ocebm-levels-of-evidence">Oxford CEBM 2011 level</ExtLink> of
          the strongest cited source, worked out by code from each source's study design (not by the AI). Works for any disease.
        </p>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {Object.entries(OCEBM).map(([l, text]) => (
            <div key={l} className="flex gap-2"><dt><Badge tone={levelTone(Number(l))}>Oxford {l}</Badge></dt><dd className="text-slate-600">{text}</dd></div>
          ))}
        </dl>
      </div>
      <p className="text-slate-600">
        <span className="font-medium text-slate-800">Cancer rows only: </span>
        <ExtLink href="https://doi.org/10.1093/annonc/mdy263">ESMO ESCAT</ExtLink> tier, judged per drug and cancer type. ESCAT is an
        oncology scale, so it isn't shown for other diseases. Code checks that the cited sources can support the tier (e.g. I-A needs a randomized trial and a survival result).
      </p>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {(Object.keys(ESCAT) as EscatTier[]).map((t) => (
          <div key={t} className="flex gap-2"><dt><Badge tone={tierTone(t)}>{t}</Badge></dt><dd className="text-slate-600">{ESCAT[t]}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function SourcePanel({ brief, evidence, onClose }: { brief: Brief; evidence: Evidence; onClose: () => void }) {
  const doc = useMemo(() => {
    if (evidence.source_id.startsWith("PMID:")) {
      const p = brief.papers.papers.find((x) => `PMID:${x.pmid}` === evidence.source_id);
      return p && { title: p.title, meta: [p.journal, p.year, p.publication_types.join(", ")].filter(Boolean).join(" · "), text: p.abstract };
    }
    const t = brief.trials.trials.find((x) => x.nct_id === evidence.source_id);
    return t && { title: t.title, meta: `ClinicalTrials.gov · ${t.interventions.join(", ")}`, text: t.brief_summary };
  }, [brief, evidence]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const full = doc ? `${doc.title}\n\n${doc.text}` : "";
  const ranges = doc ? findQuoteRanges(full, evidence.quote) : [];
  const parts: ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([a, b], i) => { parts.push(full.slice(pos, a), <mark key={i} className="highlight-sweep">{full.slice(a, b)}</mark>); pos = b; });
  parts.push(full.slice(pos));

  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => panel.current?.querySelector("mark")?.scrollIntoView({ block: "center", behavior: "smooth" }), 350);
    return () => clearTimeout(t);
  }, [evidence]);

  return createPortal(
    <div className="fixed inset-0 z-40 flex animate-fade-in justify-end bg-slate-900/30" onClick={onClose} role="dialog" aria-modal="true">
      <div ref={panel} className="h-full w-full max-w-xl animate-slide-in-right overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <ExtLink href={evidence.url} className="font-mono text-sm">{evidence.source_id} ↗</ExtLink>
            {doc && <p className="mt-1 text-xs text-slate-500">{doc.meta}</p>}
          </div>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {!doc ? <p className="text-sm text-slate-500">Source text isn't included in this brief. Open the link above.</p> : (
          <>
            <p className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${ranges.length ? "bg-brand-50 text-pine" : "bg-slate-100 text-shadow"}`}>
              {ranges.length ? "✓ The quote is highlighted below, exactly where it appears in the source." : "The quote couldn't be located automatically; compare it with the text below."}
            </p>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{parts}</p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
