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
