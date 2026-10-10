import { useMemo, useState } from "react";
import type { Brief, CriterionCategory } from "../types";
import { downloadCsv } from "../lib/csv";
import { countPatterns, PATTERNS } from "../lib/patterns";
import { Badge, Button, DownloadIcon, ExtLink, Section, StatusNote } from "./ui";

export const CATEGORY: Record<CriterionCategory, { label: string; tone: "brand" | "red" | "blue" | "violet" | "slate" }> = {
  biomarker_required: { label: "Mutation required", tone: "brand" },
  biomarker_excluded: { label: "Other alteration excluded", tone: "red" },
  testing_method: { label: "Testing method", tone: "blue" },
  prior_therapy: { label: "Prior therapy", tone: "violet" },
  other_biomarker: { label: "Other biomarker", tone: "slate" },
};

const PAGE = 20;

export function EligibilitySection({ brief }: { brief: Brief }) {
  const criteria = brief.eligibility;
  const gene = brief.aliases?.gene ?? brief.variant?.gene ?? "";
  const titles = useMemo(() => new Map(brief.trials.trials.map((t) => [t.nct_id, t.title])), [brief.trials.trials]);
  const [category, setCategory] = useState<CriterionCategory | "all">("all");
  const [pattern, setPattern] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const { trialsWithRules, counts } = useMemo(() => countPatterns(criteria, gene), [criteria, gene]);
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

  const exportCsv = () => downloadCsv(`${brief.rsid}-eligibility.csv`, ["nct_id", "trial_title", "kind", "category", "text", "url"],
    filtered.map((c) => [c.nct_id, titles.get(c.nct_id) ?? "", c.kind, CATEGORY[c.category].label, c.text, c.url]));

  return (
    <Section id="eligibility" title="How other trials screen for this mutation"
      subtitle={criteria.length ? `${criteria.length} biomarker-related rules quoted word for word from ${trialsWithRules} trials.` : undefined}
      actions={criteria.length > 0 && <Button onClick={exportCsv}><DownloadIcon />Eligibility CSV</Button>}>
      {!criteria.length ? <StatusNote status={brief.status.eligibility ?? "skipped"} emptyText="No biomarker-related eligibility rules were found in these trials." /> : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Screening patterns <span className="normal-case tracking-normal">(share of the {trialsWithRules} trials)</span></p>
              <ul className="space-y-1.5">
                {counts.map((p) => {
                  const pct = trialsWithRules ? Math.round((p.trials / trialsWithRules) * 100) : 0;
                  const active = pattern === p.id;
                  return (
                    <li key={p.id}>
                      <button type="button" disabled={!p.trials} onClick={() => { setPattern(active ? null : p.id); setLimit(PAGE); }}
                        className={`flex w-full items-center gap-3 rounded-md px-1 py-1 text-left transition enabled:hover:bg-slate-50 disabled:opacity-40 ${active ? "bg-brand-50 ring-1 ring-brand-200" : ""}`}>
                        <span className="flex-1 text-sm text-slate-700">{p.label}</span>
                        <span className="relative hidden h-2 w-20 shrink-0 rounded bg-slate-100 sm:block">
                          <span className="absolute inset-y-0 left-0 rounded bg-brand-500" style={{ width: `${pct}%` }} />
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
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Rule types</p>
              <div className="flex flex-wrap gap-2">
                <CategoryChip active={category === "all"} onClick={() => { setCategory("all"); setLimit(PAGE); }} label="All" n={criteria.length} />
                {(Object.keys(CATEGORY) as CriterionCategory[]).filter((k) => byCategory.has(k)).map((k) => (
                  <CategoryChip key={k} active={category === k} onClick={() => { setCategory(k); setLimit(PAGE); }}
                    label={CATEGORY[k].label} n={byCategory.get(k)!.rules} sub={`${byCategory.get(k)!.trials.size} ${byCategory.get(k)!.trials.size === 1 ? "trial" : "trials"}`} />
                ))}
              </div>
              <p className="mt-3 text-sm text-slate-500">
                Use this to benchmark a draft protocol: if your rules are stricter than most comparable trials, the eligible
                patient pool shrinks and amendments become more likely.
              </p>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-sm text-slate-500">
            <span>{filtered.length} rules{activePattern ? ` matching "${counts.find((c) => c.id === pattern)?.label}"` : ""}</span>
            {(pattern || category !== "all") && <Button variant="ghost" onClick={() => { setPattern(null); setCategory("all"); }}>Clear filters</Button>}
          </div>
          <ul className="mt-2 space-y-2">
            {filtered.slice(0, limit).map((c, i) => (
              <li key={c.nct_id + i} className="rounded-xl p-3 ring-1 ring-slate-200">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={c.kind === "inclusion" ? "green" : "red"}>{c.kind === "inclusion" ? "Inclusion" : "Exclusion"}</Badge>
                  <Badge tone={CATEGORY[c.category].tone}>{CATEGORY[c.category].label}</Badge>
                  <ExtLink href={c.url} className="font-mono text-xs">{c.nct_id}</ExtLink>
                  <span className="truncate text-xs text-slate-500" title={titles.get(c.nct_id)}>{titles.get(c.nct_id)}</span>
                </div>
                <blockquote className="border-l-2 border-slate-200 pl-3 text-sm text-slate-700">“{c.text}”</blockquote>
              </li>
            ))}
          </ul>
          {filtered.length > limit && <div className="mt-3 text-center"><Button onClick={() => setLimit(limit + PAGE)}>Show more</Button></div>}
        </>
      )}
    </Section>
  );
}

function CategoryChip({ active, onClick, label, n, sub }: { active: boolean; onClick: () => void; label: string; n: number; sub?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-left text-sm ring-1 ring-inset transition ${active ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}>
      <span className="font-medium">{label}</span> <span className={active ? "text-brand-100" : "text-slate-500"}>{n}{sub ? ` · ${sub}` : ""}</span>
    </button>
  );
}
