/** Small numeric helpers for scorecards. Empty input gives null, never NaN. */

export function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Nearest-rank percentile (p in 0..100). */
export function percentile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Run `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** "2m", "90s", "1500ms", or plain milliseconds. */
export function parseDuration(text: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/.exec(text);
  if (!m) throw new Error(`Invalid duration "${text}" (use e.g. 90s, 2m, 1500ms)`);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[(m[2] ?? "ms") as "ms"];
  return Math.round(Number(m[1]) * unit);
}
