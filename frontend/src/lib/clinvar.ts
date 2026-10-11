import type { ClinVarRecord } from "../types";

export function significanceTone(s: string) {
  const l = s.toLowerCase();
  if (l.includes("pathogenic") && !l.includes("benign")) return "ink" as const;
  if (l.includes("drug")) return "turquoise" as const;
  if (l.includes("benign")) return "pine" as const;
  return "slate" as const;
}

/** Bar colour per significance, strongest shades for the definite calls. */
export function significanceColor(s: string) {
  const l = s.toLowerCase();
  if (l.includes("pathogenic") && !l.includes("benign")) return l.includes("likely") ? "bg-slate-600" : "bg-ink";
  if (l.includes("benign")) return l.includes("likely") ? "bg-turquoise" : "bg-pine";
  if (l.includes("drug")) return "bg-brand-500";
  if (l.includes("uncertain") || l.includes("conflicting")) return "bg-slate-300";
  return "bg-alabaster";
}

export function significanceCounts(records: ClinVarRecord[]) {
  const m = new Map<string, number>();
  for (const r of records) m.set(r.significance, (m.get(r.significance) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** The most common informative ClinVar call, e.g. { label: "Pathogenic", n: 13, of: 20 }. */
export function clinvarVerdict(records: ClinVarRecord[]) {
  const counts = significanceCounts(records).filter(([s]) => !/not provided|other/i.test(s));
  if (!counts.length) return null;
  const pathogenic = records.filter((r) => significanceTone(r.significance) === "ink").length;
  const [label, n] = counts[0];
  return significanceTone(label) === "ink"
    ? { label: "Pathogenic or likely pathogenic", n: pathogenic, of: records.length, tone: "ink" as const }
    : { label, n, of: records.length, tone: significanceTone(label) };
}
