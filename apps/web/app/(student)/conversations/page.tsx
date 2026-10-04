import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, HistoryIcon } from "../../../components/icons";
import { requireUser } from "../../../lib/auth";
import { MODE_LABEL, relativeTime } from "../../../lib/format";
import { loadConversationList, type ConversationListItem } from "../../../lib/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My conversations" };

const chip = "rounded-pill px-2.5 py-1 text-[13px] font-bold";

function Labels({ c }: { c: ConversationListItem }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={`${chip} border border-line-soft bg-ground text-ink-muted`}>
        {MODE_LABEL[c.mode]}
      </span>
      {c.status === "reset" && (
        <span className={`${chip} border border-line text-ink-muted`}>Started over</span>
      )}
      {c.status === "closed" && (
        <span className={`${chip} border border-line text-ink-muted`}>Closed</span>
      )}
      {c.isSupersededVersion && !c.isRetired && (
        <span
          className={`${chip} inline-flex items-center gap-1 border border-line text-ink-muted`}
        >
          <HistoryIcon size={14} />
          Superseded version{c.versionNo ? ` (v${c.versionNo})` : ""}
        </span>
      )}
      {c.isRetired && (
        <span className={`${chip} border border-line text-ink-muted`}>Retired paper</span>
      )}
    </div>
  );
}

/** FR-3.9: the student's conversations grouped by paper, with mode, activity and status labels. */
export default async function ConversationsPage() {
  const { user } = await requireUser();
  const groups = await loadConversationList(user.id);
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="font-display text-[32px] font-bold tracking-[-0.02em] lg:text-5xl">
        My conversations
      </h1>
      {!groups.length && (
        <p className="text-ink-muted">
          You haven’t started a conversation yet.{" "}
          <Link href="/" className="font-bold text-primary underline">
            Open a paper from the library
          </Link>{" "}
          and pick a starter question when you’re ready.
        </p>
      )}
      {groups.map((g) => (
        <section
          key={g.paperSlug}
          aria-labelledby={`g-${g.paperSlug}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`g-${g.paperSlug}`} className="font-display text-2xl font-bold">
            {g.paperTitle}
          </h2>
          <ul className="flex flex-col gap-2.5">
            {g.items.map((c) => {
              const canContinue = c.status === "active" && !c.isSupersededVersion && !c.isRetired;
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border-[1.5px] border-line-soft bg-surface p-[18px]"
                >
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="text-sm text-ink-subtle" suppressHydrationWarning>
                      {c.moduleTitle} · {relativeTime(c.lastActivity)} · {c.objectivesDemonstrated}{" "}
                      of {c.objectivesTotal} ideas demonstrated
                    </p>
                    <Labels c={c} />
                  </div>
                  <Link
                    href={`/papers/${c.paperSlug}?c=${c.id}`}
                    className="inline-flex min-h-11 items-center gap-1.5 font-bold text-primary hover:text-primary-hover"
                  >
                    {canContinue ? "Continue" : "Open"}
                    <span className="sr-only"> conversation on {c.paperTitle}</span>
                    <ArrowRightIcon size={18} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
