// Mirrors backend/app/schemas.py (the contract in docs/PLAN.md section 5).

export type SectionStatus = "ok" | "empty" | "error" | "skipped" | "pending";

export interface ClinVarRecord { accession: string; significance: string; condition: string; protein_change: string | null; url: string }
export interface Variant {
  rsid: string; gene: string | null; gene_name: string | null; hgvs_c: string[]; hgvs_p: string[];
  clinvar_records: ClinVarRecord[]; literature_names: string[]; links: Record<string, string>;
}
export interface Alias { name: string; type: "rsid" | "protein_short" | "protein_long" | "dna" | "common"; derived_from: string }
export interface Aliases {
  gene: string | null; names: Alias[]; pubmed_terms: string[]; trial_terms: string[];
  extra_trial_terms: string[]; fallback_trial_terms: string[];
}

export interface Paper {
  pmid: string; title: string; abstract: string; journal: string | null; year: number | null; authors: string[];
  publication_types: string[]; url: string; score: number; score_reasons: string[]; sent_to_ai: boolean;
}
export interface PaperResults { papers: Paper[]; total_count: number | null; search_url: string | null }

export interface Trial {
  nct_id: string; title: string; brief_summary: string; phases: string[]; status: string | null; conditions: string[];
  interventions: string[]; sponsor: string | null; start_date: string | null; enrollment: number | null;
  eligibility_text: string; matched_terms: string[]; has_results: boolean; randomized: boolean | null; url: string;
  disease_level: boolean;
  score: number; score_reasons: string[]; sent_to_ai: boolean;
}
export interface TrialStats {
  total_found: number; returned: number; by_phase: Record<string, number>; by_status: Record<string, number>;
  top_drugs: [string, number][]; search_urls: Record<string, string>;
}
export interface TrialResults { trials: Trial[]; stats: TrialStats }

export type CriterionCategory = "biomarker_required" | "biomarker_excluded" | "testing_method" | "prior_therapy" | "other_biomarker";
export interface Criterion { nct_id: string; kind: "inclusion" | "exclusion"; category: CriterionCategory; text: string; url: string }

export type EscatTier = "I-A" | "I-B" | "I-C" | "II-A" | "II-B" | "III-A" | "III-B" | "IV" | "V";
export interface Evidence { source_id: string; quote: string; url: string }
export interface TreatmentRow {
  drug: string; setting: string; outcome: string; is_cancer: boolean; ocebm_level: number | null;
  escat_tier: EscatTier | null; escat_reason: string | null;
  evidence: Evidence[]; verified: boolean; warnings: string[];
}
export interface RemovedRow { drug: string; reason: string }
export interface TreatmentResults { rows: TreatmentRow[]; removed: RemovedRow[] }

export interface Brief {
  rsid: string; generated_at: string; variant: Variant | null; aliases: Aliases | null; papers: PaperResults;
  trials: TrialResults; eligibility: Criterion[]; treatments: TreatmentResults;
  status: Record<string, SectionStatus>; warnings: string[]; disclaimer: string; from_demo: boolean;
}
export interface TreatmentsResponse { rsid: string; status: SectionStatus; treatments: TreatmentResults; warnings: string[] }
