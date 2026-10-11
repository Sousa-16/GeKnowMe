export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Piece { text: string; kind: "term" | "keyword" | null }

/** Splits text into plain pieces and hits. `terms` are literal names (gene, variant aliases);
 * `keywords` are regex sources for screening vocabulary. Terms win where both match. */
export function splitHighlights(text: string, terms: string[], keywords: string[] = []): Piece[] {
  const t = [...new Set(terms.filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length).map(escapeRe);
  const alts = [t.length && `(?<term>${t.join("|")})`, keywords.length && `(?<keyword>${keywords.join("|")})`].filter(Boolean);
  if (!alts.length) return [{ text, kind: null }];
  const re = new RegExp(`(?<![A-Za-z0-9])(?:${alts.join("|")})(?![A-Za-z0-9])`, "gi");
  const out: Piece[] = [];
  let pos = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > pos) out.push({ text: text.slice(pos, m.index), kind: null });
    out.push({ text: m[0], kind: m.groups?.term ? "term" : "keyword" });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), kind: null });
  return out;
}

/** Find a quote inside source text, tolerating case, spacing, punctuation and "..." gaps.
 * Mirrors the backend proof check closely enough to show the user where the quote is. */
export function findQuoteRanges(source: string, quote: string): [number, number][] {
  const pieces = quote.split(/\.\.\.|…|\[\.\.\.\]/).map((p) => p.trim()).filter((p) => p.split(/\s+/).length >= 2);
  const ranges: [number, number][] = [];
  for (const piece of pieces) {
    const words = piece.match(/[A-Za-z0-9]+(?:\.[0-9]+)?/g);
    if (!words) continue;
    const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^A-Za-z0-9]+"), "i");
    const m = re.exec(source);
    if (m) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}
