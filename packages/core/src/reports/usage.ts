import { formatEur, share, type Share } from "./classReport";

/**
 * Usage & cost dashboard (FR-7.4) and `pnpm uxie costs`. The database aggregates `llm_calls` per
 * purpose and model (sums are exact, SQL `numeric`); this module adds totals, ratios and Markdown.
 * Cache hit ratio = cached_input_tokens / input_tokens (input tokens include the cached ones).
 */

export interface UsageModelRow {
  purpose: string;
  provider: string;
  model: string;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  costEur: number;
}

export interface UsageLatencyRow {
  purpose: string;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  ttftP95Ms: number | null;
}

export interface UsageDayRow {
  /** YYYY-MM-DD (UTC). */
  day: string;
  activeStudents: number;
  costEur: number;
}

export interface UsageInput {
  /** YYYY-MM. */
  month: string;
  ceilingEur: number;
  /** Month-to-date only for the current month: the dashboard says so. */
  isCurrentMonth: boolean;
  byModel: UsageModelRow[];
  latency: UsageLatencyRow[];
  days: UsageDayRow[];
  /** Distinct students with ≥1 turn in the month. */
  activeStudents: number;
}

export interface UsageReport extends UsageInput {
  totalCostEur: number;
  ceilingUsed: Share;
  totalCalls: number;
  errorRate: Share;
  cacheHitRatio: Share;
  byPurpose: (Omit<UsageModelRow, "provider" | "model"> & {
    errorRate: Share;
    cacheHitRatio: Share;
  })[];
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** `2026-10` → [2026-10-01T00:00Z, 2026-11-01T00:00Z). */
export function monthRange(month: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`Month must look like 2026-10, got "${month}"`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { from: new Date(Date.UTC(y, mo, 1)), to: new Date(Date.UTC(y, mo + 1, 1)) };
}

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export function buildUsageReport(input: UsageInput): UsageReport {
  const sum = (rows: UsageModelRow[], k: keyof UsageModelRow) =>
    rows.reduce((s, r) => s + (r[k] as number), 0);
  const purposes = [...new Set(input.byModel.map((r) => r.purpose))].sort();
  const totalCost = round5(sum(input.byModel, "costEur"));
  const totalCalls = sum(input.byModel, "calls");
  return {
    ...input,
    byModel: [...input.byModel].sort((a, b) => b.costEur - a.costEur),
    totalCostEur: totalCost,
    // n = cost in euros, total = the ceiling.
    ceilingUsed: {
      n: totalCost,
      total: input.ceilingEur,
      pct: input.ceilingEur > 0 ? Math.round((totalCost / input.ceilingEur) * 1000) / 10 : null,
    },
    totalCalls,
    errorRate: share(sum(input.byModel, "errors"), totalCalls),
    cacheHitRatio: share(
      sum(input.byModel, "cachedInputTokens"),
      sum(input.byModel, "inputTokens"),
    ),
    byPurpose: purposes.map((purpose) => {
      const rows = input.byModel.filter((r) => r.purpose === purpose);
      const calls = sum(rows, "calls");
      const inputTokens = sum(rows, "inputTokens");
      return {
        purpose,
        calls,
        errors: sum(rows, "errors"),
        inputTokens,
        outputTokens: sum(rows, "outputTokens"),
        cachedInputTokens: sum(rows, "cachedInputTokens"),
        cacheWriteInputTokens: sum(rows, "cacheWriteInputTokens"),
        costEur: round5(sum(rows, "costEur")),
        errorRate: share(sum(rows, "errors"), calls),
        cacheHitRatio: share(sum(rows, "cachedInputTokens"), inputTokens),
      };
    }),
  };
}

const ms = (n: number | null) => (n === null ? "–" : `${(n / 1000).toFixed(1)} s`);
const pct = (s: Share) => (s.pct === null ? "–" : `${s.pct.toFixed(1)}%`);
const int = (n: number) => n.toLocaleString("en-GB");

export function usageReportMarkdown(r: UsageReport): string {
  return [
    `# Usage and cost: ${r.month}${r.isCurrentMonth ? " (month to date)" : ""}`,
    "",
    `Cost ${formatEur(r.totalCostEur)} of the ${formatEur(r.ceilingEur)} ceiling (${pct(r.ceilingUsed)}). ` +
      `${int(r.totalCalls)} model calls, ${pct(r.errorRate)} errors, cache hit ratio ${pct(r.cacheHitRatio)}, ` +
      `${r.activeStudents} active students.`,
    "",
    "## By purpose and model",
    "",
    "| Purpose | Model | Calls | Errors | Input tokens | Cached | Cache writes | Output tokens | Cost |",
    "|---|---|---|---|---|---|---|---|---|",
    ...r.byModel.map(
      (m) =>
        `| ${m.purpose} | ${m.provider}:${m.model} | ${int(m.calls)} | ${int(m.errors)} | ${int(m.inputTokens)} | ${int(m.cachedInputTokens)} | ${int(m.cacheWriteInputTokens)} | ${int(m.outputTokens)} | ${formatEur(m.costEur)} |`,
    ),
    "",
    "## Latency",
    "",
    "| Purpose | p50 | p95 | First token p95 |",
    "|---|---|---|---|",
    ...r.latency.map(
      (l) =>
        `| ${l.purpose} | ${ms(l.latencyP50Ms)} | ${ms(l.latencyP95Ms)} | ${ms(l.ttftP95Ms)} |`,
    ),
    "",
    "## Daily",
    "",
    "| Day | Active students | Cost |",
    "|---|---|---|",
    ...r.days.map((d) => `| ${d.day} | ${d.activeStudents} | ${formatEur(d.costEur)} |`),
    "",
  ].join("\n");
}
