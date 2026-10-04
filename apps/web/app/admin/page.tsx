import type { Metadata } from "next";
import Link from "next/link";
import { describeLlmSettings } from "@uxie/core";
import { effectiveSettings } from "../../lib/llmSettings";

export const metadata: Metadata = { title: "Instructor" };

/** Admin landing (M5). Content management, review, reports and costs arrive in M8–M9. */
export default async function AdminHome() {
  const eff = await effectiveSettings();
  const d = describeLlmSettings(eff.settings);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Instructor</h1>
      <section className="rounded-chip border-[1.5px] border-line-soft bg-surface p-5">
        <h2 className="font-display text-xl font-bold">Inference</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
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
        <Link
          href="/admin/settings/ai"
          className="mt-4 inline-block font-bold text-primary hover:underline"
        >
          Change AI provider settings
        </Link>
      </section>
    </div>
  );
}
