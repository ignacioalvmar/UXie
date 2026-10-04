import Link from "next/link";
import type { ObjectiveStatus } from "@uxie/core";
import type { PaperStatusKind } from "../../lib/library";
import { BookIcon, ChatIcon, CheckIcon, CircleIcon, HistoryIcon } from "../icons";

/** Library building blocks (docs/design/library/HANDOFF.md §2–§3). Server-renderable. */

export function StatusChip({
  status,
  demonstrated,
  total,
}: {
  status: PaperStatusKind | ObjectiveStatus;
  demonstrated?: number;
  total?: number;
}) {
  const base = "inline-flex items-center gap-1.5 rounded-pill text-sm font-bold";
  switch (status) {
    case "in_conversation":
      return (
        <span className={`${base} bg-panel px-3 py-1.5 text-primary-hover`}>
          <ChatIcon size={16} />
          In conversation · {demonstrated} of {total} ideas
        </span>
      );
    case "in_progress":
      return (
        <span className={`${base} bg-panel px-3 py-1.5 text-primary-hover`}>
          <ChatIcon size={16} />
          In progress
        </span>
      );
    case "all_demonstrated":
    case "demonstrated":
      return (
        <span className={`${base} bg-success-bg px-3 py-1.5 text-success-ink`}>
          <CheckIcon size={16} />
          {status === "demonstrated" ? "Demonstrated" : "All ideas demonstrated"}
        </span>
      );
    case "earlier_version":
      return (
        <span className={`${base} border border-line px-3 py-1.5 text-ink-muted`}>
          <HistoryIcon size={16} />
          Earlier version discussed
        </span>
      );
    default:
      return (
        <span className={`${base} px-1 py-1.5 font-normal text-ink-subtle`}>
          <CircleIcon size={16} />
          Not started
        </span>
      );
  }
}

/** One segment per item; always paired with a text count, so hidden from assistive tech. */
export function Segments({
  items,
  width = 32,
  height = 8,
  onPanel = false,
  stretch = false,
}: {
  items: ("done" | "progress" | "empty")[];
  width?: number;
  height?: number;
  onPanel?: boolean;
  stretch?: boolean;
}) {
  return (
    <span aria-hidden="true" className="flex gap-1">
      {items.map((s, i) => (
        <span
          key={i}
          style={{ width: stretch ? undefined : width, height, borderRadius: height / 2 }}
          className={`${stretch ? "flex-1" : ""} ${
            s === "done"
              ? "bg-success-mark"
              : s === "progress"
                ? "bg-primary"
                : onPanel
                  ? "bg-progress-empty"
                  : "bg-progress-track"
          }`}
        />
      ))}
    </span>
  );
}

export const segmentOf = (s: ObjectiveStatus | PaperStatusKind): "done" | "progress" | "empty" =>
  s === "demonstrated" || s === "all_demonstrated"
    ? "done"
    : s === "in_progress" || s === "in_conversation" || s === "earlier_version"
      ? "progress"
      : "empty";

export function NumberBadge({ number, size = 44 }: { number: string; size?: number }) {
  return (
    <span
      style={{ minWidth: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-field bg-panel px-1.5 font-display text-[17px] font-bold text-primary-hover"
    >
      <span className="sr-only">Paper </span>
      {number}
    </span>
  );
}

const button =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-field px-4 font-bold";
export const primaryButton = `${button} bg-primary text-on-primary hover:bg-primary-hover`;
export const outlineButton = `${button} border-[1.5px] border-primary bg-surface text-primary hover:bg-ground`;

export function PaperAction({
  status,
  slug,
  conversationId,
}: {
  status: PaperStatusKind;
  slug: string;
  conversationId: string | null;
}) {
  if (status === "in_conversation" && conversationId)
    return (
      <Link href={`/papers/${slug}?c=${conversationId}`} className={primaryButton}>
        Continue
      </Link>
    );
  if (status === "all_demonstrated" && conversationId)
    return (
      <Link href={`/papers/${slug}?c=${conversationId}`} className={outlineButton}>
        Revisit
      </Link>
    );
  return (
    <Link href={`/papers/${slug}`} className={outlineButton}>
      <BookIcon size={18} />
      Open paper
    </Link>
  );
}
