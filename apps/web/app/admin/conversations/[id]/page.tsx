import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewRepo } from "@uxie/db";
import {
  RevealIdentity,
  Timeline,
  TranscriptView,
} from "../../../../components/admin/review/Transcript";
import { Badge, Card } from "../../../../components/admin/ui";
import { dateTime } from "../../../../lib/admin/format";
import { MODE_LABEL } from "../../../../lib/format";
import { isUuid } from "../../../../lib/http";
import { serviceDb } from "../../../../lib/supabase/server";

export const metadata: Metadata = { title: "Conversation" };

const STATUS_TONE = {
  not_started: "neutral",
  in_progress: "info",
  demonstrated: "success",
} as const;

/** FR-7.1 read-only transcript with the state timeline. */
export default async function ConversationReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const review = isUuid(id) ? await new ReviewRepo(serviceDb()).conversation(id) : null;
  if (!review) notFound();
  const c = review.conversation;
  const mode = MODE_LABEL[c.mode as keyof typeof MODE_LABEL] ?? c.mode;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/admin/conversations" className="font-bold text-primary hover:underline">
          ← Conversations
        </Link>
        <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">
          {c.pseudonymId} · {c.paperTitle}
        </h1>
        <p className="text-ink-muted">
          Version {c.versionNo} · {c.moduleTitleAtStart} · {mode} · started {dateTime(c.createdAt)}
          {c.status !== "active" && ` · ${c.status === "reset" ? "started over" : "closed"}`}
          {c.isTest && " · test chat"}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Transcript" id="transcript-h">
          <TranscriptView messages={review.messages} versionId={c.paperVersionId} />
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="Identity" id="identity-h">
            <p className="text-sm text-ink-muted">
              Shown as a pseudonym. Reveal the email only when you need to contact the student.
            </p>
            <RevealIdentity conversationId={c.id} />
          </Card>
          <Card title="Objectives now" id="objectives-h">
            <ul className="flex flex-col gap-2">
              {review.objectives.map((o) => {
                const s = (review.current[o.id] ?? "not_started") as keyof typeof STATUS_TONE;
                return (
                  <li key={o.id} className="flex flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="font-bold">{o.id}</span>
                      <Badge tone={STATUS_TONE[s] ?? "neutral"}>{s.replace("_", " ")}</Badge>
                    </span>
                    <span className="text-sm text-ink-muted">{o.statement}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="State timeline" id="timeline-h">
            <Timeline entries={review.timeline} />
          </Card>
        </div>
      </div>
    </div>
  );
}
