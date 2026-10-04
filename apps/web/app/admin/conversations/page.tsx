import type { Metadata } from "next";
import Link from "next/link";
import { AdminRepo, ReviewRepo } from "@uxie/db";
import { Badge, Card } from "../../../components/admin/ui";
import { dateTime, inputClass } from "../../../lib/admin/format";
import { MODE_LABEL } from "../../../lib/format";
import {
  parseReviewQuery,
  REVIEW_PAGE_SIZE,
  toReviewFilters,
  type ReviewQuery,
} from "../../../lib/review/schemas";
import { serviceDb } from "../../../lib/supabase/server";

export const metadata: Metadata = { title: "Conversations" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const href = (q: ReviewQuery, page: number) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...q, page })) if (v !== undefined) p.set(k, String(v));
  return `/admin/conversations?${p}`;
};

/** FR-7.1 review list: real conversations only (test chats excluded), pseudonyms only. */
export default async function ConversationsPage({ searchParams }: Props) {
  const q = parseReviewQuery(await searchParams);
  const db = serviceDb();
  const admin = new AdminRepo(db);
  const page = q.page ?? 1;
  const [modules, papers, list] = await Promise.all([
    admin.modules(),
    admin.papers(),
    new ReviewRepo(db).listConversations(toReviewFilters(q), {
      limit: REVIEW_PAGE_SIZE,
      offset: (page - 1) * REVIEW_PAGE_SIZE,
    }),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / REVIEW_PAGE_SIZE));
  const select = `${inputClass} pr-8`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Conversations</h1>
        <p className="text-ink-muted">
          Read-only transcripts with the learner-state timeline. Students appear as pseudonyms; test
          chats are not listed. Conversations are never used for grading.
        </p>
      </div>

      <Card title="Filter" id="filter-h">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="font-bold">Module (at start)</span>
            <select name="module" defaultValue={q.module ?? ""} className={select}>
              <option value="">All modules</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-bold">Paper</span>
            <select name="paper" defaultValue={q.paper ?? ""} className={select}>
              <option value="">All papers</option>
              {papers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-bold">Mode</span>
            <select name="mode" defaultValue={q.mode ?? ""} className={select}>
              <option value="">Any mode</option>
              {Object.entries(MODE_LABEL).map(([m, label]) => (
                <option key={m} value={m}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-bold">Pseudonym</span>
            <input
              name="pseudonym"
              defaultValue={q.pseudonym ?? ""}
              placeholder="S-…"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-bold">Started from</span>
            <input type="date" name="from" defaultValue={q.from ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-bold">Started until</span>
            <input type="date" name="to" defaultValue={q.to ?? ""} className={inputClass} />
          </label>
          <label className="flex min-h-11 items-center gap-2 self-end">
            <input
              type="checkbox"
              name="feedback"
              value="1"
              defaultChecked={Boolean(q.feedback)}
              className="size-5"
            />
            <span className="font-bold">Has feedback</span>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-field bg-primary px-4 font-bold text-on-primary hover:bg-primary-hover"
            >
              Apply
            </button>
            <Link
              href="/admin/conversations"
              className="inline-flex min-h-11 items-center rounded-field px-3 font-bold text-primary hover:bg-panel"
            >
              Clear
            </Link>
          </div>
        </form>
      </Card>

      <section aria-labelledby="results-h" className="flex flex-col gap-3">
        <h2 id="results-h" className="font-display text-xl font-bold">
          {list.total} conversation{list.total === 1 ? "" : "s"}
        </h2>
        {list.items.length === 0 ? (
          <p className="text-ink-muted">No conversations match these filters.</p>
        ) : (
          <div className="overflow-x-auto rounded-chip border-[1.5px] border-line-soft bg-surface">
            <table className="w-full min-w-[720px] text-left">
              <thead className="border-b border-line-soft text-sm text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Student
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Paper
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Mode
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Turns
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Feedback
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Last activity
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((c) => (
                  <tr key={c.id} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        href={`/admin/conversations/${c.id}`}
                        className="font-bold text-primary hover:underline"
                      >
                        {c.pseudonymId}
                      </Link>
                      {c.status !== "active" && (
                        <span className="ml-2">
                          <Badge>{c.status === "reset" ? "Started over" : "Closed"}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {c.paperTitle} <span className="text-ink-muted">v{c.versionNo}</span>
                      <div className="text-sm text-ink-muted">{c.moduleTitleAtStart}</div>
                    </td>
                    <td className="px-4 py-2">
                      {MODE_LABEL[c.mode as keyof typeof MODE_LABEL] ?? c.mode}
                    </td>
                    <td className="px-4 py-2">{c.studentTurns}</td>
                    <td className="px-4 py-2">{c.feedbackCount || "–"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {dateTime(c.lastMessageAt ?? c.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center gap-3">
            {page > 1 && (
              <Link href={href(q, page - 1)} className="font-bold text-primary hover:underline">
                Previous
              </Link>
            )}
            <span className="text-ink-muted">
              Page {page} of {pages}
            </span>
            {page < pages && (
              <Link href={href(q, page + 1)} className="font-bold text-primary hover:underline">
                Next
              </Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
