"use client";

import { useState } from "react";
import type { TimelineEntry, TranscriptMessage } from "@uxie/db";
import { TutorMarkdown } from "../../chat/TutorMarkdown";
import { api, Badge, Button, dateTime, ErrorNote, type ApiFailure } from "../ui";

/**
 * FR-7.1 read-only transcript and state timeline. Citation chips open the version's PDF at the
 * page (signed URL via the admin route). Student identity is a pseudonym until "Reveal identity",
 * which the server logs.
 */

const STATUS_LABEL: Record<string, string> = {
  not_started: "not started",
  in_progress: "in progress",
  demonstrated: "demonstrated",
};

const helpLabel = (h: string | null) => {
  if (!h) return null;
  if (h.startsWith("hint:")) return `Hint ${Number(h.slice(5)) + 1}`;
  return { ask: "Question", explain: "Explanation", check: "Check" }[h] ?? h;
};

const EVENT_LABEL: Record<string, string> = {
  start: "Conversation started",
  stuck: "Explain it to me",
  mode_switch: "Mode switched",
  reset: "Started over",
};

export function RevealIdentity({ conversationId }: { conversationId: string }) {
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  if (email)
    return (
      <p role="status" className="font-bold">
        {email} <span className="font-normal text-ink-muted">(this reveal was logged)</span>
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <Button
        busy={busy}
        onClick={async () => {
          if (!window.confirm("Reveal this student's email? The reveal is logged.")) return;
          setBusy(true);
          const res = await api<{ email: string }>(
            `/api/admin/conversations/${conversationId}/reveal`,
            { method: "POST" },
          );
          setBusy(false);
          if (res.ok) setEmail(res.data.email);
          else setError(res.error);
        }}
      >
        Reveal identity
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) return <p className="text-ink-muted">No replies yet.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {entries.map((e, i) => (
        <li key={e.messageId} className="flex flex-wrap items-baseline gap-2 text-sm">
          <a href={`#m-${e.messageId}`} className="font-bold text-primary hover:underline">
            {e.event
              ? (EVENT_LABEL[e.event] ?? e.event)
              : `Reply ${entries.slice(0, i + 1).filter((x) => !x.event).length}`}
          </a>
          {e.helpLevel && <Badge tone="info">{helpLabel(e.helpLevel)}</Badge>}
          {e.assessmentFailed && <Badge tone="warning">Assessment failed</Badge>}
          {e.transitions.map((t) => (
            <Badge key={t.objective} tone={t.to === "demonstrated" ? "success" : "neutral"}>
              {t.objective}: {STATUS_LABEL[t.from] ?? t.from} → {STATUS_LABEL[t.to] ?? t.to}
            </Badge>
          ))}
          {e.activeObjective && !e.event && (
            <span className="text-ink-muted">working on {e.activeObjective}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function TranscriptView({
  messages,
  versionId,
}: {
  messages: TranscriptMessage[];
  versionId: string;
}) {
  const openPage = (page: number) =>
    window.open(`/api/admin/versions/${versionId}/pdf#page=${page}`, "_blank", "noopener");
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => (
        <li
          key={m.id}
          id={`m-${m.id}`}
          className={
            m.role === "event"
              ? "self-center text-sm text-ink-muted"
              : m.role === "student"
                ? "max-w-[85%] self-end rounded-chip bg-panel px-4 py-3"
                : "max-w-[85%] self-start rounded-chip border-[1.5px] border-line-soft bg-surface px-4 py-3"
          }
        >
          {m.role === "event" ? (
            <span>
              {EVENT_LABEL[m.event ?? ""] ?? m.event} · {dateTime(m.createdAt)}
            </span>
          ) : (
            <>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <span className="font-bold text-ink">
                  {m.role === "student" ? "Student" : "UXie"}
                </span>
                <span>{dateTime(m.createdAt)}</span>
                {m.role === "tutor" && helpLabel(m.helpLevel) && (
                  <Badge tone="info">{helpLabel(m.helpLevel)}</Badge>
                )}
                {m.status === "failed" && (
                  <Badge tone="danger">Failed{m.errorCode ? ` (${m.errorCode})` : ""}</Badge>
                )}
                {m.feedback && (
                  <Badge tone={m.feedback.rating === 1 ? "success" : "warning"}>
                    {m.feedback.rating === 1 ? "👍 Helpful" : "👎 Not helpful"}
                  </Badge>
                )}
              </div>
              {m.role === "tutor" ? (
                <TutorMarkdown text={m.content} onCite={openPage} />
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
              {m.feedback?.comment && (
                <p className="mt-2 border-l-4 border-line pl-3 text-sm">
                  <span className="font-bold">Comment: </span>
                  {m.feedback.comment}
                </p>
              )}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
