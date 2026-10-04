import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatEur, formatShare, NORTH_STAR_MIN_TURNS, type Share } from "@uxie/core";
import { ReviewRepo } from "@uxie/db";
import { Card } from "../../../../components/admin/ui";
import { isUuid } from "../../../../lib/http";
import { serviceDb } from "../../../../lib/supabase/server";

export const metadata: Metadata = { title: "Class report" };

const STATUS = [
  { key: "demonstrated", label: "Demonstrated", bar: "bg-success" },
  { key: "in_progress", label: "In progress", bar: "bg-primary" },
  { key: "not_started", label: "Not started", bar: "bg-progress-track" },
] as const;

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-chip border-[1.5px] border-line-soft bg-surface p-4">
      <dt className="text-sm font-bold text-ink-muted">{label}</dt>
      <dd className="font-display text-2xl font-bold">{value}</dd>
      {hint && <dd className="text-sm text-ink-muted">{hint}</dd>}
    </div>
  );
}

const pct = (s: Share) => (s.pct === null ? "–" : `${s.pct.toFixed(1)}%`);
const of = (s: Share) => (s.total ? `${s.n} of ${s.total}` : "no data yet");

/** FR-7.2 class report on screen; the Markdown download comes from the API route. */
export default async function ClassReportPage({
  params,
}: {
  params: Promise<{ paperId: string }>;
}) {
  const { paperId } = await params;
  const r = isUuid(paperId) ? await new ReviewRepo(serviceDb()).classReport(paperId) : null;
  if (!r) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link href="/admin/reports" className="font-bold text-primary hover:underline">
            ← Reports
          </Link>
          <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">{r.paper.title}</h1>
          <p className="text-ink-muted">Class report · test chats excluded</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/admin/reports/${paperId}?format=md`}
            className="inline-flex min-h-11 items-center rounded-field border-[1.5px] border-primary bg-surface px-4 font-bold text-primary"
          >
            Download Markdown
          </a>
          <Link
            href={`/admin/conversations?paper=${paperId}`}
            className="inline-flex min-h-11 items-center rounded-field px-3 font-bold text-primary hover:bg-panel"
          >
            Read conversations
          </Link>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Students active" value={String(r.studentsActive)} />
        <Metric label="Conversations" value={String(r.conversations)} />
        <Metric label="Median turns" value={r.medianTurns === null ? "–" : String(r.medianTurns)} />
        <Metric
          label="North-star proxy (students)"
          value={pct(r.northStar.students)}
          hint={`${of(r.northStar.students)} · ≥${NORTH_STAR_MIN_TURNS} turns: ${formatShare(r.northStar.studentsTenTurns)}`}
        />
        <Metric label="Helpfulness 👍" value={pct(r.helpfulness)} hint={of(r.helpfulness)} />
        <Metric
          label="Replies with an invalid citation"
          value={pct(r.invalidCitationRate)}
          hint={of(r.invalidCitationRate)}
        />
        <Metric
          label="Assessment failures"
          value={pct(r.assessmentFailureRate)}
          hint={of(r.assessmentFailureRate)}
        />
        <Metric
          label="Cost per conversation"
          value={formatEur(r.costPerConversationEur)}
          hint={`${formatEur(r.costEur)} in total`}
        />
      </dl>
      <p className="text-sm text-ink-muted">
        The north-star proxy counts conversations where at least one understanding and one
        application objective reached “demonstrated”. Validate it by reading at least 10 such
        conversations.
      </p>

      <Card title="Objectives" id="objectives-h">
        {r.objectives.length === 0 ? (
          <p className="text-ink-muted">No conversations yet.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {r.objectives.map((o) => (
              <li key={o.id} className="flex flex-col gap-1">
                <span>
                  <span className="font-bold">{o.id}</span> · {o.statement}{" "}
                  <span className="text-sm text-ink-muted">({o.kind})</span>
                </span>
                <div
                  className="flex h-3 overflow-hidden rounded-pill bg-panel"
                  role="img"
                  aria-label={STATUS.map((s) => `${s.label} ${pct(o.status[s.key])}`).join(", ")}
                >
                  {STATUS.map((s) => (
                    <span
                      key={s.key}
                      className={s.bar}
                      style={{ width: `${o.status[s.key].pct ?? 0}%` }}
                    />
                  ))}
                </div>
                <span className="text-sm text-ink-muted">
                  {STATUS.map((s) => `${s.label} ${formatShare(o.status[s.key])}`).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Top misconceptions" id="misconceptions-h">
        {r.misconceptions.length === 0 ? (
          <p className="text-ink-muted">None recorded.</p>
        ) : (
          <ol className="flex list-decimal flex-col gap-2 pl-6">
            {r.misconceptions.map((m) => (
              <li key={`${m.objective}-${m.text}`}>
                <span className="font-bold">{m.objective}</span>: {m.text}{" "}
                <span className="text-sm text-ink-muted">
                  ({m.conversations} conversation{m.conversations === 1 ? "" : "s"}, {m.resolved}{" "}
                  resolved)
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Students" id="students-h">
        {r.students.length === 0 ? (
          <p className="text-ink-muted">No students yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead className="border-b border-line-soft text-sm text-ink-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4">
                    Pseudonym
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Conversations
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Turns
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Demonstrated
                  </th>
                  <th scope="col" className="py-2">
                    North star
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.students.map((s) => (
                  <tr key={s.pseudonymId} className="border-b border-line-soft last:border-0">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/admin/conversations?paper=${paperId}&pseudonym=${s.pseudonymId}`}
                        className="font-bold text-primary hover:underline"
                      >
                        {s.pseudonymId}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{s.conversations}</td>
                    <td className="py-2 pr-4">{s.turns}</td>
                    <td className="py-2 pr-4">{s.demonstrated.join(", ") || "–"}</td>
                    <td className="py-2">{s.northStar ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
