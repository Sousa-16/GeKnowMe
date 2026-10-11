export function phaseLabel(phases: string[]): string {
  const nums = phases.filter((p) => p !== "NA").map((p) => p.replace("EARLY_PHASE", "Early ").replace("PHASE", ""));
  if (!nums.length) return "N/A";
  if (nums.length === 1) return nums[0].startsWith("Early") ? `Early Phase ${nums[0].split(" ").pop()}` : `Phase ${nums[0]}`;
  return "Phase " + nums.map((n) => n.split(" ").pop()).join("/");
}

export function statusLabel(s: string | null): string {
  const t = (s ?? "UNKNOWN").replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const OPEN_STATUSES = new Set(["RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION"]);

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const nf = new Intl.NumberFormat();
