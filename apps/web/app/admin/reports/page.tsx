import type { Metadata } from "next";
import Link from "next/link";
import { AdminRepo } from "@uxie/db";
import { StatusBadge } from "../../../components/admin/ui";
import { serviceDb } from "../../../lib/supabase/server";

export const metadata: Metadata = { title: "Reports" };

/** FR-7.2: pick a paper for its class report. */
export default async function ReportsPage() {
  const admin = new AdminRepo(serviceDb());
  const [modules, papers] = await Promise.all([admin.modules(), admin.papers()]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Class reports</h1>
        <p className="text-ink-muted">
          Per paper: activity, objective progress, the north-star proxy, misconceptions,
          helpfulness, citation and assessment quality, and cost. Test chats are excluded.
        </p>
      </div>
      {modules.map((m) => {
        const inModule = papers.filter((p) => p.moduleId === m.id);
        if (!inModule.length) return null;
        return (
          <section key={m.id} aria-labelledby={`m-${m.id}`} className="flex flex-col gap-2">
            <h2 id={`m-${m.id}`} className="font-display text-xl font-bold">
              {m.title}
            </h2>
            <ul className="flex flex-col divide-y divide-line-soft rounded-chip border-[1.5px] border-line-soft bg-surface">
              {inModule.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <Link
                    href={`/admin/reports/${p.id}`}
                    className="font-bold text-primary hover:underline"
                  >
                    {p.title}
                  </Link>
                  <StatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
