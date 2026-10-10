import { useMemo, useState } from "react";
import type { Brief, Trial } from "../types";
import { downloadCsv } from "../lib/csv";
import { OPEN_STATUSES, nf, phaseLabel, statusLabel, statusTone } from "../lib/format";
import { Badge, BarList, Button, DownloadIcon, ExtLink, Section, Select, StatusNote } from "./ui";

const PAGE = 15;

export function TrialsSection({ brief }: { brief: Brief }) {
  const { trials, stats } = brief.trials;
  const [phase, setPhase] = useState("all");
  const [status, setStatus] = useState("all");
  const [drug, setDrug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [aiOnly, setAiOnly] = useState(false);
  const [sort, setSort] = useState<"relevance" | "score" | "newest">("relevance");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = trials.filter((t) =>
      (phase === "all" || phaseLabel(t.phases) === phase) &&
      (status === "all" || (status === "open" ? OPEN_STATUSES.has(t.status ?? "") : statusLabel(t.status) === status)) &&
      (!drug || t.interventions.some((i) => i.toLowerCase() === drug.toLowerCase())) &&
      (!aiOnly || t.sent_to_ai) &&
      (!q || `${t.nct_id} ${t.title} ${t.interventions.join(" ")} ${t.conditions.join(" ")} ${t.sponsor ?? ""}`.toLowerCase().includes(q)));
    if (sort === "score") list = [...list].sort((a, b) => b.score - a.score);
    if (sort === "newest") list = [...list].sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""));
    return list;
  }, [trials, phase, status, drug, query, aiOnly, sort]);

  const openCount = trials.filter((t) => OPEN_STATUSES.has(t.status ?? "")).length;
  const diseaseLevel = trials.filter((t) => t.disease_level).length;
  const exportCsv = () => downloadCsv(`${brief.rsid}-trials.csv`,
    ["nct_id", "title", "phase", "status", "randomized", "has_results", "interventions", "conditions", "sponsor", "start_date", "enrollment", "matched_terms", "score", "score_reasons", "sent_to_ai", "url"],
    filtered.map((t) => [t.nct_id, t.title, phaseLabel(t.phases), statusLabel(t.status), t.randomized, t.has_results, t.interventions.join("; "), t.conditions.join("; "), t.sponsor, t.start_date, t.enrollment, t.matched_terms.join("; "), t.score, t.score_reasons.join("; "), t.sent_to_ai, t.url]));

  const reset = () => { setPhase("all"); setStatus("all"); setDrug(null); setQuery(""); setAiOnly(false); setLimit(PAGE); };
  const filtersOn = phase !== "all" || status !== "all" || drug || query || aiOnly;

  return (
    <Section id="trials" title="Trial landscape"
      subtitle={trials.length ? <>
        {nf.format(stats.returned)} trials shown of {nf.format(stats.total_found)} found on ClinicalTrials.gov · {openCount} open to enrolment.
        Searches: {Object.entries(stats.search_urls).map(([term, url], i) => <span key={term}>{i ? ", " : " "}<ExtLink href={url}>{term}</ExtLink></span>)}
      </> : undefined}
      actions={trials.length > 0 && <Button onClick={exportCsv} title="Exports the trials matching the current filters"><DownloadIcon />Trials CSV</Button>}>
      {!trials.length ? <StatusNote status={brief.status.trials ?? "skipped"} emptyText="No trials on ClinicalTrials.gov mention this variant." warnings={brief.warnings.filter((w) => w.startsWith("trials"))} /> : (
        <>
          {diseaseLevel > 0 && (
            <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {diseaseLevel === trials.length ? "No trials" : "Few trials"} name this exact variant, so {diseaseLevel} trial{diseaseLevel === 1 ? "" : "s"} for the same gene and disease
              {" "}({(brief.aliases?.fallback_trial_terms ?? []).join(", ")}) {diseaseLevel === 1 ? "is" : "are"} included and marked <b>Disease-level match</b>.
              They aren't specific to this variant and aren't sent to the AI summary.
            </p>
          )}
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">By phase</p>
              <BarList items={Object.entries(stats.by_phase).map(([label, value]) => ({ label, value }))}
                onSelect={(l) => { setPhase(phase === l ? "all" : l); setLimit(PAGE); }} selected={phase} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">By status</p>
              <BarList tone="bg-sky-500" items={Object.entries(stats.by_status).map(([label, value]) => ({ label, value }))}
                onSelect={(l) => { setStatus(status === l ? "all" : l); setLimit(PAGE); }} selected={status} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Most-tested drugs</p>
              <BarList tone="bg-violet-500" items={stats.top_drugs.slice(0, 8).map(([label, value]) => ({ label, value, hint: `${value} trials` }))}
                onSelect={(l) => { setDrug(drug === l ? null : l); setLimit(PAGE); }} selected={drug} />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Filter by drug, condition, sponsor, NCT ID…"
              className="min-w-0 flex-1 rounded-lg border-0 py-1.5 pl-3 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 sm:max-w-xs" />
            <Select label="Status" value={status} onChange={(v) => { setStatus(v); setLimit(PAGE); }}
              options={[{ value: "all", label: "All statuses" }, { value: "open", label: "Open to enrolment" }, ...Object.keys(stats.by_status).map((s) => ({ value: s, label: s }))]} />
            <Select label="Sort" value={sort} onChange={(v) => setSort(v as typeof sort)}
              options={[{ value: "relevance", label: "Most relevant" }, { value: "score", label: "Evidence score" }, { value: "newest", label: "Newest" }]} />
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={aiOnly} onChange={(e) => setAiOnly(e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-600" />
              Sent to AI only
            </label>
            {filtersOn && <Button variant="ghost" onClick={reset}>Clear filters</Button>}
            <span className="ml-auto text-sm text-slate-500">{filtered.length} trials</span>
          </div>

          <ul className="mt-3 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {filtered.slice(0, limit).map((t) => <TrialRow key={t.nct_id} t={t} open={open === t.nct_id} onToggle={() => setOpen(open === t.nct_id ? null : t.nct_id)} />)}
            {!filtered.length && <li className="px-4 py-6 text-center text-sm text-slate-500">No trials match these filters.</li>}
          </ul>
          {filtered.length > limit && (
            <div className="mt-3 text-center"><Button onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</Button></div>
          )}
        </>
      )}
    </Section>
  );
}

function TrialRow({ t, open, onToggle }: { t: Trial; open: boolean; onToggle: () => void }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <ExtLink href={t.url} className="shrink-0 font-mono text-xs">{t.nct_id}</ExtLink>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onToggle} className="text-left text-sm font-medium text-slate-900 hover:text-brand-800">{t.title}</button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{phaseLabel(t.phases)}</Badge>
            <Badge tone={statusTone(t.status)}>{statusLabel(t.status)}</Badge>
            {t.disease_level && <Badge tone="amber" title="Found by a gene + disease search, not by a name of this variant">Disease-level match</Badge>}
            {t.randomized && <Badge>Randomized</Badge>}
            {t.has_results && <Badge tone="violet">Results posted</Badge>}
            {t.sent_to_ai && <Badge tone="amber" title="One of the top 30 trials sent to the AI treatment summary">Sent to AI</Badge>}
            {t.interventions.length > 0 && <span className="truncate text-xs text-slate-500">{t.interventions.slice(0, 4).join(" · ")}{t.interventions.length > 4 ? ` +${t.interventions.length - 4}` : ""}</span>}
          </div>
        </div>
        <span className="shrink-0 text-right text-xs text-slate-500" title={t.score_reasons.join("\n")}>
          score <span className="font-semibold tabular-nums text-slate-700">{t.score}</span>
        </span>
      </div>
      {open && (
        <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 text-sm md:grid-cols-3">
          <div className="space-y-1 text-slate-600 md:col-span-2">
            {t.brief_summary && <p className="whitespace-pre-line">{t.brief_summary}</p>}
            {t.conditions.length > 0 && <p><span className="font-medium text-slate-700">Conditions:</span> {t.conditions.join(", ")}</p>}
          </div>
          <dl className="space-y-1 text-xs text-slate-600">
            <div><dt className="inline font-medium text-slate-700">Sponsor: </dt><dd className="inline">{t.sponsor ?? "—"}</dd></div>
            <div><dt className="inline font-medium text-slate-700">Start: </dt><dd className="inline">{t.start_date ?? "—"}</dd></div>
            <div><dt className="inline font-medium text-slate-700">Enrolment: </dt><dd className="inline">{t.enrollment ?? "—"}</dd></div>
            <div><dt className="inline font-medium text-slate-700">Found by: </dt><dd className="inline">{t.matched_terms.join(", ")}</dd></div>
            <div><dt className="font-medium text-slate-700">Why this score:</dt>
              <dd><ul className="mt-0.5 list-inside list-disc">{t.score_reasons.map((r) => <li key={r}>{r}</li>)}</ul></dd></div>
          </dl>
        </div>
      )}
    </li>
  );
}
