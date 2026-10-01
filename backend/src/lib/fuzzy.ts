/** Lightweight name matching for materials/products/suppliers (no external dependency). */
const STOP = new Set(['ip', 'bp', 'usp', 'ph', 'eur', 'grade', 'pharma', 'pharmaceutical', 'powder', 'the', 'of', 'and', 'ltd', 'pvt', 'private', 'limited']);

/** Joins grade codes written with separators ("K-30", "PH 102" → "k30", "ph102") before tokenising. */
export const tokens = (s: string) =>
  s.toLowerCase().replace(/\b([a-z]{1,3})[\s\-]+(\d{2,4})\b/g, '$1$2').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t));

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** 0..1 similarity: blend of token overlap and edit distance on the normalised strings. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta), sb = new Set(tb);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  const jaccard = inter / (sa.size + sb.size - inter);
  const na = ta.join(' '), nb = tb.join(' ');
  const lev = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  const contains = na.includes(nb) || nb.includes(na) ? 0.15 : 0;
  return Math.min(1, 0.55 * jaccard + 0.45 * lev + contains);
}

export function bestMatch<T>(needle: string, haystack: T[], get: (t: T) => string[], threshold = 0.72) {
  let best: { item: T; score: number } | null = null;
  for (const item of haystack) {
    const score = Math.max(...get(item).filter(Boolean).map((c) => similarity(needle, c)), 0);
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= threshold ? best : null;
}
