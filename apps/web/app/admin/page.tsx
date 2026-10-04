import type { Metadata } from "next";
import Link from "next/link";
import { describeLlmSettings, formatEur, monthOf } from "@uxie/core";
import { DataRightsRepo, isOverdue, ReviewRepo } from "@uxie/db";
import { Badge } from "../../components/admin/ui";
import { serverEnv } from "../../lib/env";
import { spendAlertDue } from "../../lib/limits";
import { effectiveSettings } from "../../lib/llmSettings";
import { retentionReminder } from "../../lib/review/text";
import { serviceDb } from "../../lib/supabase/server";

export const metadata: Metadata = { title: "Instructor" };

const card = "flex flex-col gap-2 rounded-chip border-[1.5px] border-line-soft bg-surface p-5";
const more = "mt-auto pt-2 font-bold text-primary hover:underline";

/** Admin landing: what needs attention, then the areas. */
export default async function AdminHome() {
  const env = serverEnv();
  const db = serviceDb();
  const now = new Date();
  const [eff, requests, usage] = await Promise.all([
    effectiveSettings(),
    new DataRightsRepo(db).listRequests({ openOnly: true }),
    new ReviewRepo(db).usage(monthOf(now), env.MONTHLY_SPEND_CEILING_EUR, now),
  ]);
  const d = describeLlmSettings(eff.settings);
  const overdue = requests.filter((r) => isOverdue(r, now)).length;
  const retention = retentionReminder(env.RETENTION_REVIEW_DATE, now);
  const ceiling = env.MONTHLY_SPEND_CEILING_EUR;
  const spendHigh = spendAlertDue(usage.totalCostEur, ceiling);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Instructor</h1>

      {(overdue > 0 || retention || spendHigh) && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-alert border-[1.5px] border-danger-line bg-danger-bg p-4 text-danger-ink"
        >
          {overdue > 0 && (
            <p className="font-bold">
              {overdue} data request{overdue === 1 ? " is" : "s are"} overdue.{" "}
              <Link href="/admin/data-requests" className="underline">
                Answer now
              </Link>
            </p>
          )}
          {retention && <p>{retention}</p>}
          {spendHigh && (
            <p>
              {usage.totalCostEur >= ceiling
                ? "The monthly spend ceiling is reached: tutor replies are paused for everyone."
                : `${Math.floor((usage.totalCostEur / ceiling) * 100)} % of the monthly spend ceiling is used.`}{" "}
              <Link href="/admin/usage" className="underline">
                Usage and cost
              </Link>
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className={card}>
          <h2 className="font-display text-xl font-bold">Content</h2>
          <p className="text-ink-muted">
            Modules, papers, PDF versions, teaching guides, test chats and publishing.
          </p>
          <Link href="/admin/content" className={more}>
            Manage content
          </Link>
        </section>
        <section className={card}>
          <h2 className="font-display text-xl font-bold">Conversations and reports</h2>
          <p className="text-ink-muted">
            Read transcripts with the state timeline, and per-paper class reports with the
            north-star proxy.
          </p>
          <span className="mt-auto flex flex-wrap gap-4 pt-2">
            <Link href="/admin/conversations" className="font-bold text-primary hover:underline">
              Review conversations
            </Link>
            <Link href="/admin/reports" className="font-bold text-primary hover:underline">
              Class reports
            </Link>
            <Link href="/admin/exports" className="font-bold text-primary hover:underline">
              Exports
            </Link>
          </span>
        </section>
        <section className={card}>
          <h2 className="flex flex-wrap items-center gap-2 font-display text-xl font-bold">
            Data requests
            {requests.length > 0 && (
              <Badge tone={overdue ? "danger" : "info"}>{requests.length} open</Badge>
            )}
          </h2>
          <p className="text-ink-muted">
            {requests.length === 0
              ? "No open requests."
              : `Next due ${new Date(requests[0]!.dueAt).toLocaleDateString("en-GB")}.`}
          </p>
          <Link href="/admin/data-requests" className={more}>
            Open data requests
          </Link>
        </section>
        <section className={card}>
          <h2 className="font-display text-xl font-bold">Usage and cost</h2>
          <p>
            <span className="font-bold">{formatEur(usage.totalCostEur)}</span> of{" "}
            {formatEur(env.MONTHLY_SPEND_CEILING_EUR)} this month · {usage.activeStudents} active
            student{usage.activeStudents === 1 ? "" : "s"}
          </p>
          <span className="mt-auto flex flex-wrap gap-4 pt-2">
            <Link href="/admin/usage" className="font-bold text-primary hover:underline">
              Usage dashboard
            </Link>
            <Link href="/admin/health" className="font-bold text-primary hover:underline">
              Health
            </Link>
          </span>
        </section>
      </div>

      <section className={card}>
        <h2 className="font-display text-xl font-bold">Inference</h2>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="font-bold">Tutor replies</dt>
          <dd>{d.tutor}</dd>
          <dt className="font-bold">Assessment &amp; summaries</dt>
          <dd>{d.state}</dd>
          <dt className="font-bold">Eval judge</dt>
          <dd>{d.judge}</dd>
          <dt className="font-bold">Source</dt>
          <dd>
            {eff.saved
              ? `settings page (saved ${new Date(eff.updatedAt!).toLocaleString("en-GB")})`
              : "environment"}
          </dd>
        </dl>
        <Link href="/admin/settings/ai" className={more}>
          Change AI provider settings
        </Link>
      </section>
    </div>
  );
}
