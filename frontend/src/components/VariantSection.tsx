import { useMemo, useState } from "react";
import type { Alias, Brief } from "../types";
import { downloadCsv } from "../lib/csv";
import { significanceColor, significanceCounts, significanceTone } from "../lib/clinvar";
import { StackedBar } from "./charts";
import { Icon } from "./icons";
import { Badge, Button, DownloadIcon, Eyebrow, ExtLink, Section, StatusNote, useCopy } from "./ui";

const GROUPS: { type: Alias["type"]; label: string }[] = [
  { type: "protein_short", label: "Short form" },
  { type: "protein_long", label: "Protein change (HGVS p.)" },
  { type: "dna", label: "DNA change (HGVS c.)" },
  { type: "common", label: "Common name" },
  { type: "rsid", label: "dbSNP" },
];

const LINK_INFO: Record<string, string> = {
  ClinVar: "Clinical significance reports",
  dbSNP: "The variant's reference record",
  MyVariant: "Raw combined annotations",
};

const PAGE = 8;

export function VariantSection({ brief }: { brief: Brief }) {
  const v = brief.variant;
  const a = brief.aliases;
  const [showAll, setShowAll] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const records = useMemo(() => v?.clinvar_records ?? [], [v]);

  const conditions = useMemo(() => {
    const m = new Map<string, { condition: string; sigs: Set<string>; records: typeof records; changes: Set<string> }>();
    for (const r of records) {
      if (sig && r.significance !== sig) continue;
      const g = m.get(r.condition) ?? { condition: r.condition, sigs: new Set(), records: [], changes: new Set() };
      g.sigs.add(r.significance); g.records.push(r);
      if (r.protein_change) g.changes.add(r.protein_change);
      m.set(r.condition, g);
    }
    return [...m.values()].sort((x, y) => y.records.length - x.records.length);
  }, [records, sig]);
  const shown = showAll ? conditions : conditions.slice(0, PAGE);

  const exportCsv = () => downloadCsv(`${brief.rsid}-clinvar.csv`, ["accession", "significance", "condition", "protein_change", "url"],
    records.map((r) => [r.accession, r.significance, r.condition, r.protein_change, r.url]));

  return (
    <Section id="variant" title="Variant summary" icon="dna" accent="pine"
      subtitle={v ? <>Every name this variant goes by, and what ClinVar says about it.</> : undefined}
      actions={records.length > 0 && <Button onClick={exportCsv}><DownloadIcon />ClinVar CSV</Button>}>
      {!v ? <StatusNote status={brief.status.variant ?? "skipped"} warnings={brief.warnings.filter((w) => w.startsWith("variant"))} /> : (
        <div className="grid gap-8 lg:grid-cols-5">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <div>
              <Eyebrow>All names (click to copy)</Eyebrow>
              {a ? (
                <div className="space-y-3">
                  {GROUPS.map((g) => {
                    const names = a.names.filter((n) => n.type === g.type);
                    if (!names.length) return null;
                    return (
                      <div key={g.type}>
                        <p className="mb-1.5 text-sm text-slate-500">{g.label}</p>
                        <div className="flex flex-wrap gap-1.5">{names.map((n) => <AliasChip key={n.name} alias={n} />)}</div>
                      </div>
                    );
                  })}
                </div>
              ) : <StatusNote status={brief.status.aliases ?? "skipped"} />}
            </div>

            <div>
              <Eyebrow>Look it up elsewhere</Eyebrow>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {Object.entries(v.links).map(([name, url]) => (
                  <a key={name} href={url} target="_blank" rel="noopener noreferrer"
                    className="group flex items-center justify-between gap-3 rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-300">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{name}</span>
                      <span className="block truncate text-xs text-slate-500">{LINK_INFO[name] ?? "External record"}</span>
                    </span>
                    <Icon name="external" className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-brand-600" />
                  </a>
                ))}
              </div>
            </div>

            {a && (a.trial_terms.length > 0 || (a.extra_trial_terms ?? []).length > 0) && (
              <p className="text-sm leading-relaxed text-slate-500">
                Trials searched as: {[...a.trial_terms, ...(a.extra_trial_terms ?? [])].map((t) => <code key={t} className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{t}</code>)}
              </p>
            )}
          </div>

          <div className="min-w-0 lg:col-span-3">
            <Eyebrow>ClinVar verdicts · {records.length} records</Eyebrow>
            {records.length === 0 ? <StatusNote status="empty" emptyText="No ClinVar records for this variant." /> : (
              <>
                <StackedBar selected={sig} onSelect={(k) => { setSig(sig === k ? null : k); setShowAll(false); }}
                  segments={significanceCounts(records).map(([s, n]) => ({ key: s, label: s, value: n, color: significanceColor(s) }))} />
                <div className="mt-5 overflow-x-auto rounded-xl ring-1 ring-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr><th className="px-4 py-2.5 font-medium">Condition</th><th className="px-4 py-2.5 font-medium">Verdict</th><th className="px-4 py-2.5 font-medium">Records</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shown.map((g) => (
                        <tr key={g.condition} className="align-top">
                          <td className="px-4 py-2.5 text-slate-800">
                            {g.condition}
                            {g.records.length > 1 && <span className="ml-1.5 text-xs font-medium text-slate-400">×{g.records.length}</span>}
                            {g.changes.size > 0 && <span className="block font-mono text-xs text-slate-400">{[...g.changes].join(", ")}</span>}
                          </td>
                          <td className="px-4 py-2.5"><div className="flex flex-wrap gap-1">{[...g.sigs].map((s) => <Badge key={s} tone={significanceTone(s)}>{s}</Badge>)}</div></td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5">{g.records.map((r, i) => <ExtLink key={r.accession + i} href={r.url} className="font-mono text-xs">{r.accession}</ExtLink>)}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {conditions.length > PAGE && (
                  <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 text-sm font-medium text-brand-700 hover:text-brand-800 print:hidden">
                    {showAll ? "Show fewer" : `Show all ${conditions.length} conditions`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function AliasChip({ alias }: { alias: Alias }) {
  const [copied, copy] = useCopy();
  return (
    <button type="button" onClick={() => copy(alias.name)} title={`Derived from: ${alias.derived_from}. Click to copy.`}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-sm ring-1 ring-inset transition ${copied ? "bg-turquoise/25 text-ink ring-turquoise" : "bg-white text-slate-800 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300"}`}>
      {alias.name}
      <Icon name={copied ? "check" : "copy"} className={`h-3.5 w-3.5 ${copied ? "text-pine" : "text-slate-400"}`} />
      {copied && <span className="animate-fade-in font-sans text-xs font-medium">Copied</span>}
    </button>
  );
}
