import { useMemo, useState } from "react";
import type { Brief, Criterion, CriterionCategory } from "../types";
import { downloadCsv } from "../lib/csv";
import { countPatterns, isOncology, PATTERNS } from "../lib/patterns";
import { Ring } from "./charts";
import { Badge, Button, DownloadIcon, Eyebrow, ExtLink, Highlighted, Section, StatusNote, variantTerms, type Tone } from "./ui";

export const CATEGORY: Record<CriterionCategory, { label: string; tone: Tone }> = {
  biomarker_required: { label: "Mutation required", tone: "pine" },
  biomarker_excluded: { label: "Other alteration excluded", tone: "ink" },
  testing_method: { label: "Testing method", tone: "turquoise" },
  prior_therapy: { label: "Prior therapy", tone: "slate" },
  other_biomarker: { label: "Other biomarker", tone: "slate" },
};

/** Screening vocabulary underlined inside the quoted rules. */
const KEYWORDS = [
  "inhibitors?", "prior", "previous(?:ly)?", "mutations?", "mutant", "mutated", "wild[- ]type", "positive", "negative",
  "confirmed", "documented", "ctDNA", "liquid biopsy", "plasma", "tissue", "biopsy", "central(?:ly)?", "local(?:ly)?",
  "FDA[- ]approved", "validated", "sequencing", "NGS", "PCR",
];

const PAGE = 10;

export function EligibilitySection({ brief }: { brief: Brief }) {
  const criteria = brief.eligibility;
  const gene = brief.aliases?.gene ?? brief.variant?.gene ?? "";
  const terms = useMemo(() => variantTerms(brief), [brief]);
  const titles = useMemo(() => new Map(brief.trials.trials.map((t) => [t.nct_id, t.title])), [brief.trials.trials]);
  const [category, setCategory] = useState<CriterionCategory | "all">("all");
  const [pattern, setPattern] = useState<string | null>(null);

  const oncology = useMemo(() => isOncology(brief.trials.trials.map((t) => t.conditions)), [brief.trials.trials]);
  const { trialsWithRules, counts } = useMemo(() => countPatterns(criteria, gene, oncology), [criteria, gene, oncology]);
  const top = [...counts].filter((p) => p.trials > 0).sort((a, b) => b.trials - a.trials).slice(0, 4);
  const byCategory = useMemo(() => {
    const m = new Map<CriterionCategory, { rules: number; trials: Set<string> }>();
    for (const c of criteria) {
      const e = m.get(c.category) ?? { rules: 0, trials: new Set<string>() };
      e.rules++; e.trials.add(c.nct_id); m.set(c.category, e);
    }
    return m;
  }, [criteria]);

  const activePattern = PATTERNS.find((p) => p.id === pattern);
  const filtered = criteria.filter((c) => (category === "all" || c.category === category) && (!activePattern || activePattern.test(c, gene)));
  const togglePattern = (id: string) => setPattern(pattern === id ? null : id);

  const exportCsv = () => downloadCsv(`${brief.rsid}-eligibility.csv`, ["nct_id", "trial_title", "kind", "category", "text", "url"],
    filtered.map((c) => [c.nct_id, titles.get(c.nct_id) ?? "", c.kind, CATEGORY[c.category].label, c.text, c.url]));

  return (
    <Section id="eligibility" title="How other trials screen for this mutation" icon="clipboard" accent="shadow"
      subtitle={criteria.length ? `${criteria.length} biomarker-related rules quoted word for word from ${trialsWithRules} trials.` : undefined}
      actions={criteria.length > 0 && <Button onClick={exportCsv}><DownloadIcon />Eligibility CSV</Button>}>
      {!criteria.length ? <StatusNote status={brief.status.eligibility ?? "skipped"} emptyText="No biomarker-related eligibility rules were found in these trials." /> : (
        <div className="space-y-8">
          {top.length > 0 && (
            <div>
              <Eyebrow>Most common screening rules · share of the {trialsWithRules} trials</Eyebrow>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 [&>*]:min-w-0">
                {top.map((p, i) => (
                  <Ring key={p.id} pct={trialsWithRules ? Math.round((p.trials / trialsWithRules) * 100) : 0} label={p.label}
                    sub={`${p.trials} ${p.trials === 1 ? "trial" : "trials"}`} active={pattern === p.id} onClick={() => togglePattern(p.id)}
                    color={["text-pine", "text-turquoise", "text-ink", "text-slate-400"][i]} />
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
            <div>
              <Eyebrow>All screening patterns</Eyebrow>
              <ul className="space-y-1">
                {counts.map((p) => {
                  const pct = trialsWithRules ? Math.round((p.trials / trialsWithRules) * 100) : 0;
                  const active = pattern === p.id;
                  return (
                    <li key={p.id}>
                      <button type="button" disabled={!p.trials} onClick={() => togglePattern(p.id)}
                        className={`flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-left transition enabled:hover:bg-slate-50 disabled:opacity-40 ${active ? "bg-brand-50 ring-1 ring-brand-200" : ""}`}>
                        <span className="flex-1 text-sm text-slate-700">{p.label}</span>
                        <span className="relative hidden h-2 w-20 shrink-0 rounded bg-slate-100 sm:block">
                          <span className="absolute inset-y-0 left-0 rounded bg-pine" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="w-28 shrink-0 whitespace-nowrap text-right text-sm tabular-nums text-slate-600"><span className="font-semibold text-slate-800">{p.trials}</span> {p.trials === 1 ? "trial" : "trials"} · {pct}%</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-slate-400">Keyword counts over the quoted rules. Click a pattern to see the rules behind it.</p>
            </div>
            <div>
              <Eyebrow>Rule types</Eyebrow>
              <div className="flex flex-wrap gap-2">
                <CategoryChip active={category === "all"} onClick={() => setCategory("all")} label="All" n={criteria.length} />
                {(Object.keys(CATEGORY) as CriterionCategory[]).filter((k) => byCategory.has(k)).map((k) => (
                  <CategoryChip key={k} active={category === k} onClick={() => setCategory(k)}
                    label={CATEGORY[k].label} n={byCategory.get(k)!.rules} sub={`${byCategory.get(k)!.trials.size} ${byCategory.get(k)!.trials.size === 1 ? "trial" : "trials"}`} />
                ))}
              </div>
              <p className="mt-4 max-w-prose text-sm leading-relaxed text-slate-500">
                Use this to benchmark a draft protocol: if your rules are stricter than most comparable trials, the eligible
                patient pool shrinks and amendments become more likely.
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-5 text-sm text-slate-500">
              <span>{filtered.length} rules{activePattern ? ` matching "${counts.find((c) => c.id === pattern)?.label}"` : ""}
                <span className="ml-3 hidden text-xs sm:inline">
                  <span className="rounded bg-brand-100 px-1 font-medium text-brand-900">{gene || "variant"}</span> = this variant ·{" "}
                  <span className="font-medium text-slate-700 underline decoration-turquoise decoration-2 underline-offset-2">keyword</span> = screening term
                </span>
              </span>
              {(pattern || category !== "all") && <Button variant="ghost" onClick={() => { setPattern(null); setCategory("all"); }}>Clear filters</Button>}
            </div>
            <div className="mt-3 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
              <RuleColumn key={`in-${category}-${pattern}`} kind="inclusion" rules={filtered.filter((c) => c.kind === "inclusion")} titles={titles} terms={terms} />
              <RuleColumn key={`ex-${category}-${pattern}`} kind="exclusion" rules={filtered.filter((c) => c.kind === "exclusion")} titles={titles} terms={terms} />
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function RuleColumn({ kind, rules, titles, terms }: { kind: Criterion["kind"]; rules: Criterion[]; titles: Map<string, string>; terms: string[] }) {
  const [limit, setLimit] = useState(PAGE);
  const inc = kind === "inclusion";
  return (
    <div>
      <h3 className={`mb-3 flex items-center gap-2 text-base font-semibold ${inc ? "text-pine" : "text-shadow"}`}>
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${inc ? "bg-turquoise text-ink" : "bg-shadow text-white"}`}>{inc ? "✓" : "✕"}</span>
        {inc ? "Inclusion: patients must…" : "Exclusion: patients can't…"}
        <span className="font-normal text-slate-400">{rules.length}</span>
      </h3>
      {!rules.length ? <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">No {kind} rules match these filters.</p> : (
        <ul className="space-y-2">
          {rules.slice(0, limit).map((c, i) => (
            <li key={c.nct_id + i} className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={CATEGORY[c.category].tone}>{CATEGORY[c.category].label}</Badge>
                <ExtLink href={c.url} className="font-mono text-xs">{c.nct_id}</ExtLink>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={titles.get(c.nct_id)}>{titles.get(c.nct_id)}</span>
              </div>
              <blockquote className="text-sm leading-relaxed text-slate-700">“<Highlighted text={c.text} terms={terms} keywords={KEYWORDS} />”</blockquote>
            </li>
          ))}
        </ul>
      )}
      {rules.length > limit && <div className="mt-3 text-center print:hidden"><Button onClick={() => setLimit(limit + PAGE)}>Show more {kind} rules</Button></div>}
    </div>
  );
}

function CategoryChip({ active, onClick, label, n, sub }: { active: boolean; onClick: () => void; label: string; n: number; sub?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-left text-sm ring-1 ring-inset transition ${active ? "bg-ink text-white ring-ink" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}>
      <span className="font-medium">{label}</span> <span className={active ? "text-turquoise" : "text-slate-500"}>{n}{sub ? ` · ${sub}` : ""}</span>
    </button>
  );
}
