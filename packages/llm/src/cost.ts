import type { Price } from "@uxie/core";

export interface TokenCounts {
  /** Input tokens billed at the normal rate. */
  noCache: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/**
 * Estimated cost in EUR (PRD §8.3, §17.4). Prices are USD per million tokens from
 * LLM_PRICES_JSON; cache writes use the price for the configured TTL. Unknown models cost 0
 * (the boot log and `uxie doctor` warn about missing prices).
 */
export function costEur(
  model: string,
  t: TokenCounts,
  prices: Record<string, Price>,
  cacheTtl: "5m" | "1h",
  usdToEur: number,
): number {
  const p = prices[model];
  if (!p) return 0;
  const write = cacheTtl === "1h" ? p.write1h : p.write5m;
  const usd =
    (t.noCache * p.in + t.cacheRead * p.cached + t.cacheWrite * write + t.output * p.out) / 1e6;
  return Math.round(usd * usdToEur * 1e6) / 1e6;
}
