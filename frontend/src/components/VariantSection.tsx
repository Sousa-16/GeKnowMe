import { useState } from "react";
import type { Brief } from "../types";
import { downloadCsv } from "../lib/csv";
import { Badge, Button, DownloadIcon, ExtLink, Section, StatusNote } from "./ui";

const TYPE_LABEL = { rsid: "dbSNP", protein_short: "Protein (short)", protein_long: "Protein (HGVS)", dna: "DNA (HGVS c.)", common: "Common name" };

function significanceTone(s: string) {
  const l = s.toLowerCase();
  if (l.includes("pathogenic") && !l.includes("benign")) return "red" as const;
  if (l.includes("drug")) return "violet" as const;
  if (l.includes("benign")) return "green" as const;
  if (l.includes("uncertain") || l.includes("conflicting")) return "amber" as const;
  return "slate" as const;
}

export function VariantSection({ brief }: { brief: Brief }) {
  const v = brief.variant;
  const a = brief.aliases;
  const [showAll, setShowAll] = useState(false);
  const records = v?.clinvar_records ?? [];
  const shown = showAll ? records : records.slice(0, 8);
  const sigCounts = records.reduce<Record<string, number>>((m, r) => ({ ...m, [r.significance]: (m[r.significance] ?? 0) + 1 }), {});

  const exportCsv = () => downloadCsv(`${brief.rsid}-clinvar.csv`, ["accession", "significance", "condition", "protein_change", "url"],
    records.map((r) => [r.accession, r.significance, r.condition, r.protein_change, r.url]));

  return (
    <Section id="variant" title="Variant summary"
      subtitle={v ? <>Every name this variant goes by, and what ClinVar says about it.</> : undefined}
      actions={records.length > 0 && <Button onClick={exportCsv}><DownloadIcon />ClinVar CSV</Button>}>
      {!v ? <StatusNote status={brief.status.variant ?? "skipped"} warnings={brief.warnings.filter((w) => w.startsWith("variant"))} /> : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            <div>
              <p className="text-3xl font-bold tracking-tight text-slate-900">{v.gene ?? "Unknown gene"}</p>
              {v.gene_name && <p className="text-sm text-slate-500">{v.gene_name}</p>}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">All names (aliases)</p>
              {a ? (
                <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
                  {a.names.map((n) => (
                    <li key={n.type + n.name} className="flex flex-wrap items-center justify-between gap-x-3 px-3 py-1.5">
                      <span className="font-mono text-sm text-slate-900">{n.name}</span>
                      <span className="min-w-0 truncate text-right text-xs text-slate-500" title={`Derived from: ${n.derived_from}`}>
                        {TYPE_LABEL[n.type]} · <span className="italic">{n.derived_from}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <StatusNote status={brief.status.aliases ?? "skipped"} />}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {Object.entries(v.links).map(([name, url]) => <ExtLink key={name} href={url}>{name} ↗</ExtLink>)}
            </div>
            {a && (a.trial_terms.length > 0 || (a.extra_trial_terms ?? []).length > 0) && (
              <p className="text-xs text-slate-500">
                Trials searched as: {[...a.trial_terms, ...(a.extra_trial_terms ?? [])].map((t) => <code key={t} className="mr-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">{t}</code>)}
              </p>
            )}
          </div>

          <div className="min-w-0 lg:col-span-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">ClinVar records ({records.length})</p>
              {Object.entries(sigCounts).map(([s, n]) => <Badge key={s} tone={significanceTone(s)}>{s} · {n}</Badge>)}
            </div>
            {records.length === 0 ? <p className="text-sm text-slate-500">No ClinVar records for this variant.</p> : (
              <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr><th className="px-3 py-2 font-medium">Record</th><th className="px-3 py-2 font-medium">Significance</th><th className="px-3 py-2 font-medium">Condition</th><th className="px-3 py-2 font-medium">Change</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map((r) => (
                      <tr key={r.accession + r.condition}>
                        <td className="px-3 py-1.5"><ExtLink href={r.url} className="font-mono text-xs">{r.accession}</ExtLink></td>
                        <td className="px-3 py-1.5"><Badge tone={significanceTone(r.significance)}>{r.significance}</Badge></td>
                        <td className="px-3 py-1.5 text-slate-700">{r.condition}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{r.protein_change ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {records.length > 8 && (
              <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 text-sm font-medium text-brand-700 hover:text-brand-800">
                {showAll ? "Show fewer" : `Show all ${records.length} records`}
              </button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
