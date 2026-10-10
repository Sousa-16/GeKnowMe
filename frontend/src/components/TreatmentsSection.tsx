import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Brief, EscatTier, Evidence, TreatmentResults, SectionStatus } from "../types";
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
  return l <= 2 ? "green" as const : l === 3 ? "blue" as const : "slate" as const;
}

function tierTone(t: EscatTier) {
  if (t.startsWith("I-")) return "green" as const;
  if (t.startsWith("II-")) return "blue" as const;
  if (t.startsWith("III")) return "amber" as const;
  return "slate" as const;
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
    <Section id="treatments" title="AI treatment summary"
      subtitle={<>Written by Gemini from the {sentPapers} highest-scoring papers and {sentTrials} trials only. Every claim cites a source and a word-for-word quote, which code checks.</>}
      actions={<>
        <Button variant="ghost" onClick={() => setShowLegend(!showLegend)}>{showLegend ? "Hide" : "What do the levels mean?"}</Button>
        {rows.length > 0 && <Button onClick={exportCsv}><DownloadIcon />Treatments CSV</Button>}
      </>}>
      {showLegend && <EscatLegend />}
      {status === "pending" ? <Pending startedAt={startedAt} /> :
        status === "error" ? (
          <div className="space-y-3">
            <StatusNote status="error" warnings={warnings} />
            <Button onClick={onRetry}>Try again</Button>
          </div>
        ) : !rows.length ? <StatusNote status={status === "ok" ? "empty" : status} emptyText="The AI found no treatments that the sources support." warnings={warnings} /> : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="green">✓ {verified} fully verified</Badge>
              {rows.length - verified > 0 && <Badge tone="amber">! {rows.length - verified} need a check</Badge>}
              {removed.length > 0 && <Badge tone="red">✕ {removed.length} removed by the proof check</Badge>}
              {rows.some((r) => r.variant_specific === false) && (
                <Badge tone="amber" title="Their sources discuss the disease or gene in general, not carriers of this variant">
                  {rows.filter((r) => r.variant_specific === false).length} not specific to this variant
                </Badge>
              )}
            </div>
            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
              <table className="w-full min-w-[760px] table-fixed text-sm">
                <colgroup><col className="w-[19%]" /><col className="w-[22%]" /><col className="w-[21%]" /><col className="w-[38%]" /></colgroup>
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Treatment</th>
                    <th className="px-3 py-2 font-medium">Reported outcome</th>
                    <th className="px-3 py-2 font-medium">Evidence level</th>
                    <th className="px-3 py-2 font-medium">Sources &amp; quotes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {rows.map((r, i) => (
                    <tr key={r.drug + i} className={r.verified ? "" : "bg-amber-50/40"}>
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-900">{r.drug}</p>
                        <p className="text-xs text-slate-500">{r.setting}</p>
                        {r.variant_specific === false && (
                          <p className="mt-1"><Badge tone="amber" title="None of the cited sources mention this variant: the evidence is about the disease or gene in general, not carriers of this variant.">Not specific to this variant</Badge></p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        {r.outcome}
                        {r.verified
                          ? <p className="mt-1 text-xs font-medium text-emerald-700">✓ Quotes and numbers checked</p>
                          : r.warnings.map((w) => <p key={w} className="mt-1 text-xs font-medium text-amber-700">! {w}</p>)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {r.ocebm_level != null
                            ? <Badge tone={levelTone(r.ocebm_level)} title={`Oxford CEBM level ${r.ocebm_level}: ${OCEBM[r.ocebm_level]} (from the cited sources' study design)`}>Oxford {r.ocebm_level}</Badge>
                            : <Badge title="No cited source has a rankable study design (e.g. narrative reviews)">Oxford n/a</Badge>}
                          {r.is_cancer && r.escat_tier && <Badge tone={tierTone(r.escat_tier)} title={ESCAT[r.escat_tier]}>ESCAT {r.escat_tier}</Badge>}
                        </div>
                        {r.ocebm_level != null && <p className="mt-1 text-xs text-slate-500">{OCEBM[r.ocebm_level]}</p>}
                        {r.is_cancer && r.escat_reason && <p className="mt-1 text-xs text-slate-500">{r.escat_reason}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <ul className="space-y-2">
                          {r.evidence.map((e, j) => (
                            <li key={j} className="text-xs">
                              <span className="flex items-center gap-2">
                                <ExtLink href={e.url} className="font-mono">{e.source_id}</ExtLink>
                                <button type="button" onClick={() => setSource(e)} className="font-medium text-slate-500 hover:text-brand-700">view in source</button>
                              </span>
                              <span className="mt-0.5 block text-slate-600">“{e.quote}”</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {removed.length > 0 && (
              <details className="mt-4 rounded-xl bg-rose-50/60 p-3 text-sm ring-1 ring-rose-200">
                <summary className="cursor-pointer font-medium text-rose-800">{removed.length} AI rows removed because their sources didn't back them up</summary>
                <ul className="mt-2 space-y-1 text-rose-900">
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
    <div className="flex items-start gap-3 rounded-xl bg-brand-50/60 p-4 ring-1 ring-brand-100">
      <Spinner className="mt-0.5 h-5 w-5" />
      <div className="text-sm">
        <p className="font-medium text-brand-900">Generating the treatment summary… <span className="tabular-nums text-brand-700">{secs}s</span></p>
        <ul className="mt-1 space-y-0.5 text-brand-800/80">
          {steps.filter(([t]) => secs >= t).map(([, s]) => <li key={s}>{s}</li>)}
          {secs >= 3 && <li>Then code checks every quote, number and evidence tier against the sources</li>}
        </ul>
        <p className="mt-2 text-xs text-brand-800/70">Usually 10–30 seconds. Everything else above is ready to use.</p>
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
  ranges.forEach(([a, b], i) => { parts.push(full.slice(pos, a), <mark key={i}>{full.slice(a, b)}</mark>); pos = b; });
  parts.push(full.slice(pos));

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose} role="dialog" aria-modal="true">
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <ExtLink href={evidence.url} className="font-mono text-sm">{evidence.source_id} ↗</ExtLink>
            {doc && <p className="mt-1 text-xs text-slate-500">{doc.meta}</p>}
          </div>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {!doc ? <p className="text-sm text-slate-500">Source text isn't included in this brief. Open the link above.</p> : (
          <>
            <p className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${ranges.length ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
              {ranges.length ? "✓ The quote is highlighted below, exactly where it appears in the source." : "The quote couldn't be located automatically; compare it with the text below."}
            </p>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{parts}</p>
          </>
        )}
      </div>
    </div>
  );
}
