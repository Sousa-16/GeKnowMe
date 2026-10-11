import { useMemo, useState } from "react";
import type { Brief, Trial } from "../types";
import { downloadCsv } from "../lib/csv";
import { OPEN_STATUSES, nf, phaseLabel, statusLabel } from "../lib/format";
import { YearBars, type YearBar } from "./charts";
import { Icon } from "./icons";
import { Badge, BarList, Button, DownloadIcon, Eyebrow, ExtLink, Section, Select, StatusNote } from "./ui";

const PAGE = 15;
const PIPELINE = ["Early Phase 1", "Phase 1", "Phase 1/2", "Phase 2", "Phase 2/3", "Phase 3", "Phase 4"];

const STATUS_GROUPS = [
  { key: "open", label: "Open to enrolment", color: "bg-turquoise", test: (s: string) => OPEN_STATUSES.has(s) },
  { key: "active", label: "Active, not recruiting", color: "bg-pine", test: (s: string) => s === "ACTIVE_NOT_RECRUITING" },
  { key: "completed", label: "Completed", color: "bg-ink", test: (s: string) => s === "COMPLETED" },
  { key: "stopped", label: "Stopped early", color: "bg-slate-400", test: (s: string) => ["TERMINATED", "WITHDRAWN", "SUSPENDED"].includes(s) },
  { key: "other", label: "Unknown / other", color: "bg-alabaster", test: () => true },
];
const statusGroup = (s: string | null) => STATUS_GROUPS.find((g) => g.test(s ?? ""))!;

const startYear = (t: Trial) => (t.start_date ? Number(t.start_date.slice(0, 4)) : null);

/** Highest phase reached, on a 0-4 scale (Early Phase 1 counts as half a step). */
function phaseStep(phases: string[]) {
  const n = phases.map((p) => (p === "EARLY_PHASE1" ? 0.5 : Number(p.replace("PHASE", "")) || 0));
  return Math.max(0, ...n);
}

export function TrialsSection({ brief }: { brief: Brief }) {
  const { trials, stats } = brief.trials;
  const [phase, setPhase] = useState("all");
  const [status, setStatus] = useState("all");
  const [drug, setDrug] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
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
      (year == null || startYear(t) === year) &&
      (!aiOnly || t.sent_to_ai) &&
      (!q || `${t.nct_id} ${t.title} ${t.interventions.join(" ")} ${t.conditions.join(" ")} ${t.sponsor ?? ""}`.toLowerCase().includes(q)));
    if (sort === "score") list = [...list].sort((a, b) => b.score - a.score);
    if (sort === "newest") list = [...list].sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""));
    return list;
  }, [trials, phase, status, drug, year, query, aiOnly, sort]);

  const byYear = useMemo<YearBar[]>(() => {
    const years = trials.map(startYear).filter((y): y is number => y != null);
    if (!years.length) return [];
    const out: YearBar[] = [];
    for (let y = Math.min(...years); y <= Math.max(...years); y++) {
      const inYear = trials.filter((t) => startYear(t) === y);
      out.push({ year: y, segments: STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color, value: inYear.filter((t) => statusGroup(t.status).key === g.key).length })) });
    }
    return out;
  }, [trials]);

  const recruiting = useMemo(() => trials.filter((t) => OPEN_STATUSES.has(t.status ?? "") && !t.disease_level).sort((a, b) => b.score - a.score).slice(0, 4), [trials]);
  const openCount = trials.filter((t) => OPEN_STATUSES.has(t.status ?? "")).length;
  const diseaseLevel = trials.filter((t) => t.disease_level).length;
  const exportCsv = () => downloadCsv(`${brief.rsid}-trials.csv`,
    ["nct_id", "title", "phase", "status", "randomized", "has_results", "interventions", "conditions", "sponsor", "start_date", "enrollment", "matched_terms", "score", "score_reasons", "sent_to_ai", "url"],
    filtered.map((t) => [t.nct_id, t.title, phaseLabel(t.phases), statusLabel(t.status), t.randomized, t.has_results, t.interventions.join("; "), t.conditions.join("; "), t.sponsor, t.start_date, t.enrollment, t.matched_terms.join("; "), t.score, t.score_reasons.join("; "), t.sent_to_ai, t.url]));

  const reset = () => { setPhase("all"); setStatus("all"); setDrug(null); setYear(null); setQuery(""); setAiOnly(false); setLimit(PAGE); };
  const filtersOn = phase !== "all" || status !== "all" || drug || year != null || query || aiOnly;
  const pick = <T,>(set: (v: T) => void, v: T) => { set(v); setLimit(PAGE); };

  return (
    <Section id="trials" title="Trial landscape" icon="flask" accent="ink"
      subtitle={trials.length ? <>
        {nf.format(stats.returned)} trials shown of {nf.format(stats.total_found)} found on ClinicalTrials.gov · {openCount} open to enrolment.
        Searches: {Object.entries(stats.search_urls).map(([term, url], i) => <span key={term}>{i ? ", " : " "}<ExtLink href={url}>{term}</ExtLink></span>)}
      </> : undefined}
      actions={trials.length > 0 && <Button onClick={exportCsv} title="Exports the trials matching the current filters"><DownloadIcon />Trials CSV</Button>}>
      {!trials.length ? <StatusNote status={brief.status.trials ?? "skipped"} emptyText="No trials on ClinicalTrials.gov mention this variant." warnings={brief.warnings.filter((w) => w.startsWith("trials"))} /> : (
        <div className="space-y-8">
          {diseaseLevel > 0 && (
            <p className="rounded-xl border border-shadow/30 bg-white px-4 py-3 text-sm leading-relaxed text-shadow">
              {diseaseLevel === trials.length ? "No trials" : "Few trials"} name this exact variant, so {diseaseLevel} trial{diseaseLevel === 1 ? "" : "s"} for the same gene and disease
              {" "}({(brief.aliases?.fallback_trial_terms ?? []).join(", ")}) {diseaseLevel === 1 ? "is" : "are"} included and marked <b>Disease-level match</b>.
              They aren't specific to this variant and aren't sent to the AI summary.
            </p>
          )}

          {recruiting.length > 0 && (
            <div>
              <Eyebrow>Recruiting now · top {recruiting.length} of {openCount}</Eyebrow>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
                {recruiting.map((t) => <RecruitingCard key={t.nct_id} t={t} />)}
              </div>
            </div>
          )}

          <div>
            <Eyebrow>Development pipeline · click a phase to filter</Eyebrow>
            <PhasePipeline counts={stats.by_phase} selected={phase} onSelect={(p) => pick(setPhase, phase === p ? "all" : p)} />
          </div>

          <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            {byYear.length > 1 && (
              <div>
                <Eyebrow>Trials by start year</Eyebrow>
                <YearBars data={byYear} unit="trials" selected={year} onSelect={(y) => pick(setYear, year === y ? null : y)} />
                <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  {STATUS_GROUPS.map((g) => <li key={g.key} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ring-1 ring-black/10 ${g.color}`} />{g.label}</li>)}
                </ul>
              </div>
            )}
            <div>
              <Eyebrow>By status</Eyebrow>
              <BarList tone="bg-pine" items={Object.entries(stats.by_status).map(([label, value]) => ({ label, value }))}
                onSelect={(l) => pick(setStatus, status === l ? "all" : l)} selected={status} />
            </div>
            <div>
              <Eyebrow>Most-tested drugs</Eyebrow>
              <BarList tone="bg-ink" items={stats.top_drugs.slice(0, 8).map(([label, value]) => ({ label, value, hint: `${value} trials` }))}
                onSelect={(l) => pick(setDrug, drug === l ? null : l)} selected={drug} />
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-5 print:hidden">
              <input value={query} onChange={(e) => pick(setQuery, e.target.value)} placeholder="Filter by drug, condition, sponsor, NCT ID…"
                className="min-w-[14rem] flex-1 rounded-lg border-0 py-1.5 pl-3 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 sm:max-w-xs" />
              <Select label="Status" value={status} onChange={(v) => pick(setStatus, v)}
                options={[{ value: "all", label: "All statuses" }, { value: "open", label: "Open to enrolment" }, ...Object.keys(stats.by_status).map((s) => ({ value: s, label: s }))]} />
              <Select label="Sort" value={sort} onChange={(v) => setSort(v as typeof sort)}
                options={[{ value: "relevance", label: "Most relevant" }, { value: "score", label: "Evidence score" }, { value: "newest", label: "Newest" }]} />
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={aiOnly} onChange={(e) => setAiOnly(e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-600" />
                Sent to AI only
              </label>
              {filtersOn && <Button variant="ghost" onClick={reset}>Clear filters</Button>}
              <span className="ml-auto text-sm text-slate-500">{filtered.length} trials{year != null ? ` started in ${year}` : ""}</span>
            </div>

            <ul className="mt-3 space-y-2">
              {filtered.slice(0, limit).map((t) => <TrialRow key={t.nct_id} t={t} open={open === t.nct_id} onToggle={() => setOpen(open === t.nct_id ? null : t.nct_id)} />)}
              {!filtered.length && <li className="rounded-xl px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">No trials match these filters.</li>}
            </ul>
            {filtered.length > limit && (
              <div className="mt-3 text-center print:hidden"><Button onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</Button></div>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function RecruitingCard({ t }: { t: Trial }) {
  return (
    <a href={t.url} target="_blank" rel="noopener noreferrer"
      className="group flex flex-col rounded-xl bg-gradient-to-b from-turquoise/20 to-white p-4 ring-1 ring-turquoise transition hover:-translate-y-0.5 hover:shadow-md hover:ring-pine">
      <span className="flex items-center gap-2 text-xs font-semibold text-pine">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-turquoise opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-pine" />
        </span>
        {statusLabel(t.status)}
        <span className="ml-auto font-mono font-normal text-slate-400">{t.nct_id}</span>
      </span>
      <span className="mt-2 line-clamp-3 text-sm font-medium leading-snug text-slate-900 group-hover:text-brand-800">{t.title}</span>
      <span className="mt-auto space-y-0.5 pt-3 text-xs text-slate-500">
        <span className="block font-medium text-slate-700">{phaseLabel(t.phases)}{t.enrollment ? ` · ${nf.format(t.enrollment)} patients` : ""}</span>
        {t.sponsor && <span className="block truncate">{t.sponsor}</span>}
      </span>
    </a>
  );
}

function PhasePipeline({ counts, selected, onSelect }: { counts: Record<string, number>; selected: string; onSelect: (p: string) => void }) {
  const steps = [...PIPELINE.filter((p) => counts[p]), ...Object.keys(counts).filter((p) => !PIPELINE.includes(p) && p !== "N/A")];
  const max = Math.max(1, ...steps.map((p) => counts[p]));
  return (
    <div className="flex flex-wrap items-stretch gap-y-2">
      <ol className="flex min-w-0 flex-1 items-stretch overflow-x-auto py-1">
        {steps.map((p, i) => {
          const active = selected === p;
          return (
            <li key={p} className="flex min-w-[5rem] flex-1 items-center">
              <button type="button" onClick={() => onSelect(p)}
                className={`relative w-full min-w-0 overflow-hidden rounded-xl px-2 py-3 text-center ring-1 ring-inset transition hover:-translate-y-0.5 ${active ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-200 hover:ring-brand-300"}`}>
                <span className={`absolute inset-x-0 bottom-0 ${active ? "bg-white/20" : "bg-brand-100"}`} style={{ height: `${(counts[p] / max) * 100}%` }} />
                <span className="relative block text-2xl font-semibold tabular-nums">{counts[p]}</span>
                <span className={`relative block truncate text-xs ${active ? "text-brand-100" : "text-slate-500"}`} title={p}>{p === "Early Phase 1" ? "Early Ph. 1" : p}</span>
              </button>
              {i < steps.length - 1 && <Icon name="chevron" className="h-4 w-4 shrink-0 -rotate-90 text-slate-300" />}
            </li>
          );
        })}
      </ol>
      {counts["N/A"] > 0 && (
        <button type="button" onClick={() => onSelect("N/A")} title="Observational studies, registries and other trials without a phase"
          className={`ml-3 rounded-xl border border-dashed px-3 py-3 text-center transition ${selected === "N/A" ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 text-slate-600 hover:border-brand-300"}`}>
          <span className="block text-2xl font-semibold tabular-nums">{counts["N/A"]}</span>
          <span className={`block text-xs ${selected === "N/A" ? "text-brand-100" : "text-slate-500"}`}>No phase</span>
        </button>
      )}
    </div>
  );
}

function PhaseSteps({ phases }: { phases: string[] }) {
  const step = phaseStep(phases);
  return (
    <span className="inline-flex items-center gap-1.5" title={phaseLabel(phases)}>
      <span className="flex gap-0.5">
        {[1, 2, 3, 4].map((s) => <span key={s} className={`h-1.5 w-3 rounded-full ${step >= s ? "bg-brand-500" : step >= s - 0.5 ? "bg-brand-200" : "bg-slate-200"}`} />)}
      </span>
      <span className="text-xs font-medium text-slate-700">{phaseLabel(phases)}</span>
    </span>
  );
}

function TrialRow({ t, open, onToggle }: { t: Trial; open: boolean; onToggle: () => void }) {
  const meta = [t.sponsor, t.enrollment ? `${nf.format(t.enrollment)} patients` : null, t.start_date ? `started ${t.start_date.slice(0, 7)}` : null, t.randomized ? "randomized" : null, t.has_results ? "results posted" : null].filter(Boolean);
  return (
    <li className="rounded-xl bg-white ring-1 ring-slate-200 transition hover:ring-slate-300">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-4 px-4 py-3.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <PhaseSteps phases={t.phases} />
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600"><span className={`h-2 w-2 rounded-full ring-1 ring-black/10 ${statusGroup(t.status).color}`} />{statusLabel(t.status)}</span>
            {t.disease_level && <Badge tone="shadow" title="Found by a gene + disease search, not by a name of this variant">Disease-level match</Badge>}
            {t.sent_to_ai && <Badge tone="pine" title="One of the top 30 trials sent to the AI treatment summary">Sent to AI</Badge>}
          </div>
          <p className="mt-1.5 font-medium leading-snug text-slate-900">{t.title}</p>
          {t.interventions.length > 0 && <p className="mt-1 truncate text-sm font-medium text-pine">{t.interventions.slice(0, 4).join(" · ")}{t.interventions.length > 4 ? ` +${t.interventions.length - 4}` : ""}</p>}
          {meta.length > 0 && <p className="mt-1 truncate text-xs text-slate-500">{meta.join(" · ")}</p>}
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-slate-500">
          <span className="font-mono text-slate-400">{t.nct_id}</span>
          <span title={t.score_reasons.join("\n")}>score <span className="font-semibold tabular-nums text-slate-700">{t.score}</span></span>
          <Icon name="chevron" className={`h-4 w-4 text-slate-400 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      <div inert={!open} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="mx-4 mb-4 grid gap-4 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-3">
            <div className="space-y-2 leading-relaxed text-slate-600 md:col-span-2">
              {t.brief_summary && <p className="max-w-prose whitespace-pre-line">{t.brief_summary}</p>}
              {t.conditions.length > 0 && <p><span className="font-medium text-slate-700">Conditions:</span> {t.conditions.join(", ")}</p>}
              <ExtLink href={t.url} className="inline-flex items-center gap-1 text-sm font-medium">Open on ClinicalTrials.gov <Icon name="external" className="h-3.5 w-3.5" /></ExtLink>
            </div>
            <dl className="space-y-1.5 text-xs text-slate-600">
              <div><dt className="inline font-medium text-slate-700">Found by: </dt><dd className="inline">{t.matched_terms.join(", ")}</dd></div>
              <div><dt className="font-medium text-slate-700">Why this score:</dt>
                <dd><ul className="mt-0.5 list-inside list-disc">{t.score_reasons.map((r) => <li key={r}>{r}</li>)}</ul></dd></div>
            </dl>
          </div>
        </div>
      </div>
    </li>
  );
}
