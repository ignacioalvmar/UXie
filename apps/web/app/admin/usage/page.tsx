import type { Metadata } from "next";
import Link from "next/link";
import { formatEur, monthOf, monthRange, type Share } from "@uxie/core";
import { ReviewRepo } from "@uxie/db";
import { Card } from "../../../components/admin/ui";
import { serverEnv } from "../../../lib/env";
import { MonthQuery } from "../../../lib/review/schemas";
import { serviceDb } from "../../../lib/supabase/server";

export const metadata: Metadata = { title: "Usage and cost" };

const pct = (s: Share) => (s.pct === null ? "–" : `${s.pct.toFixed(1)}%`);
const secs = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);
const int = (n: number) => n.toLocaleString("en-GB");
const PURPOSE: Record<string, string> = {
  tutor: "Tutor replies",
  assessment: "Assessment",
  summary: "History summaries",
  guide_draft: "Guide drafts",
  eval_student: "Eval: simulated students",
  eval_judge: "Eval: judge",
};

function shiftMonth(month: string, by: number) {
  const { from } = monthRange(month);
  return monthOf(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + by, 1)));
}

/** FR-7.4 usage & cost dashboard. All figures are sums over `llm_calls` (UTC calendar month). */
export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const current = monthOf(new Date());
  const parsed = MonthQuery.safeParse((await searchParams).month);
  const month = parsed.success ? parsed.data : current;
  const ceiling = serverEnv().MONTHLY_SPEND_CEILING_EUR;
  const r = await new ReviewRepo(serviceDb()).usage(month, ceiling);
  const used = Math.min(100, r.ceilingUsed.pct ?? 0);
  const th = "py-2 pr-4";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Usage and cost</h1>
          <p className="text-ink-muted">
            {month}
            {r.isCurrentMonth ? " · month to date" : ""} · UTC
          </p>
        </div>
        <nav aria-label="Month" className="flex gap-2">
          <Link
            href={`/admin/usage?month=${shiftMonth(month, -1)}`}
            className="inline-flex min-h-11 items-center rounded-field px-3 font-bold text-primary hover:bg-panel"
          >
            ← {shiftMonth(month, -1)}
          </Link>
          {month < current && (
            <Link
              href={`/admin/usage?month=${shiftMonth(month, 1)}`}
              className="inline-flex min-h-11 items-center rounded-field px-3 font-bold text-primary hover:bg-panel"
            >
              {shiftMonth(month, 1)} →
            </Link>
          )}
        </nav>
      </div>

      <Card title="Spend" id="spend-h">
        <p className="font-display text-3xl font-bold">
          {formatEur(r.totalCostEur)}{" "}
          <span className="text-lg font-normal text-ink-muted">
            of {formatEur(ceiling)} ceiling
          </span>
        </p>
        <div
          className="h-3 overflow-hidden rounded-pill bg-panel"
          role="meter"
          aria-label="Share of the monthly ceiling used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={used}
          aria-valuetext={pct(r.ceilingUsed)}
        >
          <div
            className={
              used >= 90
                ? "h-full bg-danger"
                : used >= 70
                  ? "h-full bg-cite-line"
                  : "h-full bg-primary"
            }
            style={{ width: `${used}%` }}
          />
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
          <dt className="text-sm font-bold text-ink-muted">Model calls</dt>
          <dd>{int(r.totalCalls)}</dd>
          <dt className="text-sm font-bold text-ink-muted">Errors</dt>
          <dd>{pct(r.errorRate)}</dd>
          <dt className="text-sm font-bold text-ink-muted">Cache hit ratio</dt>
          <dd>{pct(r.cacheHitRatio)}</dd>
          <dt className="text-sm font-bold text-ink-muted">Active students</dt>
          <dd>{r.activeStudents}</dd>
        </dl>
        <p className="text-sm text-ink-muted">
          New replies stop when the ceiling is reached (MONTHLY_SPEND_CEILING_EUR). Cache hit ratio
          = cached input tokens / input tokens.
        </p>
      </Card>

      <Card title="Tokens and cost by purpose and model" id="models-h">
        {r.byModel.length === 0 ? (
          <p className="text-ink-muted">No model calls this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="border-b border-line-soft text-sm text-ink-muted">
                <tr>
                  <th scope="col" className={th}>
                    Purpose
                  </th>
                  <th scope="col" className={th}>
                    Model
                  </th>
                  <th scope="col" className={th}>
                    Calls
                  </th>
                  <th scope="col" className={th}>
                    Errors
                  </th>
                  <th scope="col" className={th}>
                    Input
                  </th>
                  <th scope="col" className={th}>
                    Cached
                  </th>
                  <th scope="col" className={th}>
                    Output
                  </th>
                  <th scope="col" className="py-2">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.byModel.map((m) => (
                  <tr
                    key={`${m.purpose}-${m.provider}-${m.model}`}
                    className="border-b border-line-soft last:border-0"
                  >
                    <td className={th}>{PURPOSE[m.purpose] ?? m.purpose}</td>
                    <td className={th}>
                      {m.model} <span className="text-sm text-ink-muted">{m.provider}</span>
                    </td>
                    <td className={th}>{int(m.calls)}</td>
                    <td className={th}>{int(m.errors)}</td>
                    <td className={th}>{int(m.inputTokens)}</td>
                    <td className={th}>{int(m.cachedInputTokens)}</td>
                    <td className={th}>{int(m.outputTokens)}</td>
                    <td className="py-2">{formatEur(m.costEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Latency" id="latency-h">
          {r.latency.length === 0 ? (
            <p className="text-ink-muted">No successful calls this month.</p>
          ) : (
            <table className="w-full text-left">
              <thead className="border-b border-line-soft text-sm text-ink-muted">
                <tr>
                  <th scope="col" className={th}>
                    Purpose
                  </th>
                  <th scope="col" className={th}>
                    p50
                  </th>
                  <th scope="col" className={th}>
                    p95
                  </th>
                  <th scope="col" className="py-2">
                    First token p95
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.latency.map((l) => (
                  <tr key={l.purpose} className="border-b border-line-soft last:border-0">
                    <td className={th}>{PURPOSE[l.purpose] ?? l.purpose}</td>
                    <td className={th}>{secs(l.latencyP50Ms)}</td>
                    <td className={th}>{secs(l.latencyP95Ms)}</td>
                    <td className="py-2">{secs(l.ttftP95Ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="By day" id="days-h">
          {r.days.length === 0 ? (
            <p className="text-ink-muted">No activity this month.</p>
          ) : (
            <table className="w-full text-left">
              <thead className="border-b border-line-soft text-sm text-ink-muted">
                <tr>
                  <th scope="col" className={th}>
                    Day
                  </th>
                  <th scope="col" className={th}>
                    Active students
                  </th>
                  <th scope="col" className="py-2">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.days.map((d) => (
                  <tr key={d.day} className="border-b border-line-soft last:border-0">
                    <td className={th}>{d.day}</td>
                    <td className={th}>{d.activeStudents}</td>
                    <td className="py-2">{formatEur(d.costEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
