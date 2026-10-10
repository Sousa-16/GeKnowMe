import type { Brief, TreatmentsResponse } from "../types";

export const SAMPLE_RSID = "rs113488022";
export const DEMOS = [
  { rsid: "rs113488022", label: "BRAF V600E" },
  { rsid: "rs121913530", label: "KRAS G12C" },
  { rsid: "rs121434568", label: "EGFR L858R" },
];

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const useMock = () => new URLSearchParams(window.location.search).has("mock");

/** The bundled BRAF sample, loaded only when needed (offline or ?mock), so it doesn't slow the normal page. */
async function loadSample(): Promise<Brief & { offlineSample: true }> {
  const mod = await import("../mock/sample-brief-rs113488022.json");
  return { ...(mod.default as unknown as Brief), offlineSample: true };
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Can't reach the server. Check your connection and try again.");
  }
  if (!resp.ok) {
    let detail = `Server error (${resp.status})`;
    try { detail = (await resp.json()).detail ?? detail; } catch { /* not JSON */ }
    throw new ApiError(detail, resp.status);
  }
  return resp.json() as Promise<T>;
}

/** Steps 1-5 (fast). The AI table comes from fetchTreatments. Falls back to the bundled sample offline. */
export async function fetchBrief(rsid: string, signal?: AbortSignal): Promise<Brief & { offlineSample?: boolean }> {
  if (useMock() && rsid === SAMPLE_RSID) return loadSample();
  try {
    return await getJson<Brief>(`/api/brief/${encodeURIComponent(rsid)}?include_ai=false`, signal);
  } catch (e) {
    if (e instanceof ApiError && e.status === undefined && rsid === SAMPLE_RSID) {
      return loadSample();
    }
    throw e;
  }
}

export async function fetchTreatments(rsid: string, signal?: AbortSignal): Promise<TreatmentsResponse> {
  return getJson<TreatmentsResponse>(`/api/brief/${encodeURIComponent(rsid)}/treatments`, signal);
}
