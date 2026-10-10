import type { Criterion } from "../types";

/** Screening patterns counted across trials (the "I/E competitor" view). Pure keyword rules over the
 * extracted eligibility criteria, so every count can be traced back to quoted rules. */
export interface Pattern { id: string; label: string; test: (c: Criterion, gene: string) => boolean; cancerOnly?: boolean }

export const PATTERNS: Pattern[] = [
  { id: "genetic_confirm", label: "Require genetic confirmation of the variant", test: (c) => /genetic(ally)? (test|confirm|analysis)|genotyp|sequenc|molecular (test|diagnos)|dna analysis/i.test(c.text) },
  { id: "zygosity", label: "Specify zygosity (homozygous / heterozygous / carrier)", test: (c) => /homozygous|heterozygous|hemizygous|compound heterozygous|carrier/i.test(c.text) },
  { id: "liquid", cancerOnly: true, label: "Accept blood-based testing (ctDNA / liquid biopsy)", test: (c) => /ctdna|cfdna|liquid biopsy|plasma|circulating tumou?r dna/i.test(c.text) },
  { id: "tissue", cancerOnly: true, label: "Mention tumour tissue testing", test: (c) => /tissue|archival|tumou?r (sample|specimen)|biopsy/i.test(c.text) && !/liquid biopsy/i.test(c.text) },
  { id: "central", label: "Require central lab confirmation", test: (c) => /central(ly)?\s*(lab|laborator|test|confirm|review|assess)|central(ly)? (confirmed|tested)/i.test(c.text) },
  { id: "local", label: "Accept local lab results", test: (c) => /local(ly)?\s*(lab|laborator|assay|test|result)|local(ly)? (determined|confirmed|tested)/i.test(c.text) },
  { id: "approved_test", label: "Require an FDA-approved / validated test", test: (c) => /fda[- ]approved|validated (test|assay)|companion diagnostic|clia/i.test(c.text) },
  { id: "prior_excluded", label: "Exclude prior {gene}-targeted therapy", test: (c, g) => c.kind === "exclusion" && c.category === "prior_therapy" && (new RegExp(`\\b${g}\\b`, "i").test(c.text) || /inhibitor|targeted|modulator|gene therapy|gene editing|enzyme replacement|antisense/i.test(c.text)) },
  { id: "prior_required", label: "Require or allow prior therapy", test: (c) => c.kind === "inclusion" && c.category === "prior_therapy" },
  { id: "co_mutation", label: "Exclude other genetic alterations", test: (c) => c.category === "biomarker_excluded" },
];

const CANCER = /cancer|carcinoma|tumou?r|neoplas|malignan|lymphoma|leuka?emia|melanoma|sarcoma|glioma|myeloma|blastoma|mesothelioma|metasta/i;

/** True when most matched trials are cancer trials, so cancer-only patterns (tissue, ctDNA) make sense. */
export function isOncology(conditions: string[][]): boolean {
  if (!conditions.length) return false;
  return conditions.filter((cs) => cs.some((c) => CANCER.test(c))).length / conditions.length >= 0.5;
}

export function countPatterns(criteria: Criterion[], gene: string, oncology: boolean) {
  const trialsWithRules = new Set(criteria.map((c) => c.nct_id)).size;
  return {
    trialsWithRules,
    counts: PATTERNS.filter((p) => oncology || !p.cancerOnly).map((p) => ({
      ...p,
      label: p.label.replace("{gene}", gene || "target"),
      trials: new Set(criteria.filter((c) => p.test(c, gene)).map((c) => c.nct_id)).size,
    })),
  };
}
