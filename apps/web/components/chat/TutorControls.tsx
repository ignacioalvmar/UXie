"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Mode, ObjectiveKind } from "@uxie/core";
import type { FeedbackDto, ProgressDto } from "../../lib/chat/types";
import {
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  CloseIcon,
  InfoIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from "../icons";

/**
 * Tutor features around the chat (M7; workspace handoff §4.1, §4.2, §4.5): focus mode selector,
 * progress drawer, Start over confirmation, per-message feedback, the Apply-mode project card and
 * the superseded-version banner.
 */

export const MODE_LABEL: Record<Mode, string> = {
  understand: "Understand",
  apply: "Apply to UX",
  critique: "Critique",
  build: "Build",
};

const KIND_LABEL: Record<ObjectiveKind, string> = {
  understanding: "Understand",
  application: "Apply to UX",
  critique: "Critique",
};

/** The mode that works on objectives of a kind (PRD §3.2). */
export const KIND_MODE: Record<ObjectiveKind, Mode> = {
  understanding: "understand",
  application: "apply",
  critique: "critique",
};

// ── Focus mode ──────────────────────────────────────────────────────────────

export function ModeSelector({
  modes,
  mode,
  disabled,
  compact,
  onChoose,
}: {
  modes: Mode[];
  mode: Mode;
  disabled: boolean;
  compact: boolean;
  onChoose: (m: Mode) => void;
}) {
  if (modes.length < 2) return null;
  return compact ? (
    <ModeMenu modes={modes} mode={mode} disabled={disabled} onChoose={onChoose} />
  ) : (
    <div role="group" aria-label="Focus mode" className="flex flex-wrap gap-2">
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={m === mode}
          disabled={disabled && m !== mode}
          onClick={() => onChoose(m)}
          className={`inline-flex min-h-11 items-center rounded-pill px-4 font-bold disabled:opacity-60 ${
            m === mode
              ? "bg-primary text-on-primary"
              : "border-[1.5px] border-progress-empty bg-surface text-primary-hover hover:border-primary"
          }`}
        >
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

/** Mobile: one pill "Mode: X ▾" opening a menu of radio items (handoff §5). */
function ModeMenu({
  modes,
  mode,
  disabled,
  onChoose,
}: {
  modes: Mode[];
  mode: Mode;
  disabled: boolean;
  onChoose: (m: Mode) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && e.target !== button.current) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] border-progress-empty bg-surface px-4 font-bold text-primary-hover disabled:opacity-60"
      >
        Mode: {MODE_LABEL[mode]}
        <ChevronDownIcon size={18} />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Focus mode"
          onKeyDown={(e) => {
            const items = [
              ...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? []),
            ];
            const i = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const d = e.key === "ArrowDown" ? 1 : -1;
              items[(i + d + items.length) % items.length]?.focus();
            } else if (e.key === "Tab") setOpen(false);
          }}
          className="absolute left-0 top-full z-30 mt-1 flex min-w-[200px] flex-col rounded-field border-[1.5px] border-line-soft bg-surface p-1 shadow-lg"
        >
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={m === mode}
              tabIndex={-1}
              onClick={() => {
                close();
                onChoose(m);
              }}
              className="flex min-h-11 items-center justify-between gap-3 rounded-[10px] px-3 text-left font-bold hover:bg-ground focus:bg-ground"
            >
              {MODE_LABEL[m]}
              {m === mode && <CheckIcon size={18} className="text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Progress ────────────────────────────────────────────────────────────────

const Segments = ({ progress, big = false }: { progress: ProgressDto[]; big?: boolean }) => (
  <span aria-hidden="true" className={`flex ${big ? "gap-1" : "gap-[3px]"}`}>
    {progress.map((p) => (
      <span
        key={p.id}
        className={`${big ? "h-2 w-10" : "h-1.5 w-[22px]"} rounded-[3px] ${
          p.status === "demonstrated"
            ? "bg-success-mark"
            : p.status === "in_progress"
              ? "bg-primary"
              : "bg-progress-track"
        }`}
      />
    ))}
  </span>
);

export function ProgressButton({
  progress,
  hasConversation,
  compact,
  onOpen,
  buttonRef,
}: {
  progress: ProgressDto[];
  hasConversation: boolean;
  compact: boolean;
  onOpen: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const demonstrated = progress.filter((p) => p.status === "demonstrated").length;
  const inProgress = progress.filter((p) => p.status === "in_progress").length;
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-haspopup="dialog"
      onClick={onOpen}
      className="flex min-h-11 flex-col items-end justify-center gap-1 rounded-field bg-ground px-3 py-1.5 text-sm text-ink-muted hover:bg-panel"
    >
      <Segments progress={progress} />
      {compact
        ? `${demonstrated} of ${progress.length} ideas`
        : hasConversation
          ? `Progress: ${demonstrated} of ${progress.length} ideas, ${inProgress} in progress`
          : `Progress: ${progress.length} ideas to explore`}
    </button>
  );
}

function StatusChip({ status }: { status: ProgressDto["status"] }) {
  if (status === "demonstrated")
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-success-bg px-2.5 py-0.5 text-sm font-bold text-success-ink">
        <CheckIcon size={16} /> Demonstrated
      </span>
    );
  if (status === "in_progress")
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-panel px-2.5 py-0.5 text-sm font-bold text-primary-hover">
        <ChatIcon size={16} /> In progress
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-sm font-bold text-ink-subtle">
      <CircleIcon size={16} /> Not started
    </span>
  );
}

/** Native modal dialog: focus is trapped, Esc closes, focus returns to the opener. */
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

export function ProgressDrawer({
  open,
  onClose,
  progress,
  mode,
  modes,
  canSwitch,
  onCite,
  onWorkOn,
}: {
  open: boolean;
  onClose: () => void;
  progress: ProgressDto[];
  mode: Mode;
  modes: Mode[];
  canSwitch: boolean;
  onCite: (page: number) => void;
  onWorkOn: (m: Mode) => void;
}) {
  const ref = useModal(open);
  const demonstrated = progress.filter((p) => p.status === "demonstrated").length;
  const inProgress = progress.filter((p) => p.status === "in_progress").length;
  return (
    <dialog
      ref={ref}
      aria-labelledby="progress-h"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // click on the scrim
      }}
      className="uxie-sheet fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-[460px] overflow-hidden bg-surface p-0 text-ink max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:h-[90dvh] max-sm:max-w-none max-sm:rounded-t-sheet"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 bg-panel pb-[18px] pl-6 pr-5 pt-[22px]">
          <div className="flex flex-col gap-2">
            <h2 id="progress-h" className="font-display text-[26px] font-bold">
              Your progress
            </h2>
            <Segments progress={progress} big />
            <p>
              <strong>
                {demonstrated} of {progress.length} ideas demonstrated
              </strong>{" "}
              · {inProgress} in progress
            </p>
          </div>
          <button
            type="button"
            aria-label="Close progress"
            onClick={onClose}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-field hover:bg-surface"
          >
            <CloseIcon size={22} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          <p className="text-[15px] text-ink-muted">
            These are the key ideas of this paper. An idea counts as demonstrated when you explain
            it in your own words in the chat.
          </p>
          <ol className="flex flex-col gap-3">
            {progress.map((p) => {
              const target = KIND_MODE[p.kind];
              const offerSwitch =
                canSwitch &&
                p.status === "not_started" &&
                target !== mode &&
                modes.includes(target);
              return (
                <li
                  key={p.id}
                  className={`flex flex-col gap-2.5 rounded-card border-[1.5px] p-4 ${
                    p.active ? "border-primary" : "border-line-soft"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] font-bold uppercase tracking-wide text-ink-muted">
                      {KIND_LABEL[p.kind]}
                      {p.active ? " · Current" : ""}
                    </span>
                    <StatusChip status={p.status} />
                  </div>
                  <p className="text-[17px] font-bold">{p.statement}</p>
                  {p.status === "demonstrated" && p.evidence && (
                    <div className="rounded-field bg-ground px-3 py-2">
                      <p className="text-sm font-bold text-ink-muted">What you said</p>
                      <p>“{p.evidence}”</p>
                    </div>
                  )}
                  {p.refs.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
                      In the paper:
                      {p.refs.map((r) => (
                        <button
                          key={`${r.page}-${r.label ?? ""}`}
                          type="button"
                          aria-label={`Open page ${r.page} in the paper`}
                          onClick={() => {
                            onClose();
                            onCite(r.page);
                          }}
                          className="rounded-pill bg-panel px-[9px] py-px text-sm font-bold text-primary-hover"
                        >
                          p. {r.page}
                          {r.label ? ` · ${r.label}` : ""}
                        </button>
                      ))}
                    </p>
                  )}
                  {offerSwitch && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onWorkOn(target);
                      }}
                      className="inline-flex min-h-11 items-center self-start rounded-field border-[1.5px] border-primary px-3 font-bold text-primary"
                    >
                      Work on this in {MODE_LABEL[target]} mode
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </dialog>
  );
}

// ── Start over ──────────────────────────────────────────────────────────────

export function StartOverDialog({
  open,
  mode,
  working,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  mode: Mode;
  working: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useModal(open);
  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby="start-over-h"
      aria-describedby="start-over-d"
      onClose={onCancel}
      className="uxie-sheet m-auto w-[min(440px,calc(100vw-32px))] rounded-hero bg-surface p-6 text-ink"
    >
      <h2 id="start-over-h" className="font-display text-2xl font-bold">
        Start over?
      </h2>
      <p id="start-over-d" className="mt-2">
        A new conversation starts from the beginning in {MODE_LABEL[mode]} mode, with progress on
        this paper starting again. This conversation stays readable in “My conversations”.
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2.5">
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className="inline-flex min-h-11 items-center rounded-field border-[1.5px] border-line px-4 font-bold"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={working}
          onClick={onConfirm}
          className="inline-flex min-h-11 items-center rounded-field bg-primary px-4 font-bold text-on-primary hover:bg-primary-hover disabled:opacity-60"
        >
          {working ? "Starting over…" : "Start over"}
        </button>
      </div>
    </dialog>
  );
}

// ── Feedback ────────────────────────────────────────────────────────────────

async function sendFeedback(messageId: string, rating: 1 | -1, comment?: string) {
  const res = await fetch(`/api/messages/${messageId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rating, ...(comment ? { comment } : {}) }),
  });
  return res.ok;
}

/** 👍 / 👎 under a tutor message, with an optional comment after 👎 (FR-3.6). */
export function FeedbackBar({
  messageId,
  initial,
}: {
  messageId: string;
  initial: FeedbackDto | null;
}) {
  const [rating, setRating] = useState<1 | -1 | null>(initial?.rating ?? null);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  const [note, setNote] = useState("");
  const rate = async (r: 1 | -1) => {
    const before = rating;
    setRating(r);
    setNote("");
    setCommenting(r === -1);
    if (!(await sendFeedback(messageId, r))) {
      setRating(before);
      setCommenting(false);
      setNote("Your feedback could not be saved. Please try again.");
    } else if (r === 1) setNote("Thanks for the feedback.");
  };
  const btn = (active: boolean) =>
    `inline-flex h-9 w-11 items-center justify-center rounded-field ${
      active ? "bg-panel text-primary-hover" : "text-ink-subtle hover:bg-ground"
    }`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Helpful"
          aria-pressed={rating === 1}
          onClick={() => void rate(1)}
          className={btn(rating === 1)}
        >
          <ThumbUpIcon size={18} />
        </button>
        <button
          type="button"
          aria-label="Not helpful"
          aria-pressed={rating === -1}
          onClick={() => void rate(-1)}
          className={btn(rating === -1)}
        >
          <ThumbDownIcon size={18} />
        </button>
        <span role="status" className="text-[13px] text-ink-subtle">
          {note}
        </span>
      </div>
      {commenting && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await sendFeedback(messageId, -1, comment.trim());
            setNote(ok ? "Thanks, your comment was sent." : "Your comment could not be saved.");
            if (ok) setCommenting(false);
          }}
          className="flex flex-col gap-2 rounded-field bg-ground p-3"
        >
          <label htmlFor={`fb-${messageId}`} className="text-sm font-bold">
            What wasn’t helpful? (optional)
          </label>
          <textarea
            id={`fb-${messageId}`}
            rows={2}
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="resize-y rounded-field border-[1.5px] border-line bg-surface px-3 py-2"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!comment.trim()}
              className="inline-flex min-h-11 items-center rounded-field bg-primary px-4 font-bold text-on-primary disabled:bg-line-soft disabled:text-ink-muted"
            >
              Send comment
            </button>
            <button
              type="button"
              onClick={() => {
                setCommenting(false);
                setNote("Thanks for the feedback.");
              }}
              className="inline-flex min-h-11 items-center rounded-field px-3 font-bold text-ink-muted"
            >
              Skip
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Apply mode: project ─────────────────────────────────────────────────────

/**
 * Apply mode without a saved project (J3, FR-1.5): the student describes it and chooses
 * explicitly whether to save it to the profile; either way it is sent as their reply.
 */
export function ProjectCard({
  name,
  disabled,
  onSend,
  onDismiss,
}: {
  name: string;
  disabled: boolean;
  onSend: (text: string, save: boolean) => Promise<boolean>;
  onDismiss: () => void;
}) {
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (save: boolean) => {
    setWorking(true);
    setError("");
    const ok = await onSend(text.trim(), save);
    setWorking(false);
    if (!ok) setError("Your project could not be saved to your profile. Please try again.");
  };
  return (
    <section
      aria-labelledby="project-h"
      className="flex flex-col gap-2.5 rounded-card border-[1.5px] border-line-soft bg-surface p-4"
    >
      <h3 id="project-h" className="font-display text-lg font-bold">
        Your project
      </h3>
      <p className="text-[15px] text-ink-muted">
        In Apply to UX mode, {name} applies the paper to your own project. Describe it in 2–3
        sentences, or pick one of the scenarios {name} suggests in the chat.
      </p>
      <label htmlFor="project-text" className="text-[15px] font-bold">
        What are you building, and for whom?
      </label>
      <textarea
        id="project-text"
        rows={3}
        maxLength={1500}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="resize-y rounded-field border-[1.5px] border-line px-3 py-2"
      />
      {error && (
        <p role="alert" className="text-sm text-danger-ink">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || working || !text.trim()}
          onClick={() => void submit(true)}
          className="inline-flex min-h-11 items-center rounded-field bg-primary px-4 font-bold text-on-primary hover:bg-primary-hover disabled:bg-line-soft disabled:text-ink-muted"
        >
          Save to my profile and send
        </button>
        <button
          type="button"
          disabled={disabled || working || !text.trim()}
          onClick={() => void submit(false)}
          className="inline-flex min-h-11 items-center rounded-field border-[1.5px] border-primary px-4 font-bold text-primary disabled:border-line-soft disabled:text-ink-muted"
        >
          Send without saving
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex min-h-11 items-center rounded-field px-3 font-bold text-ink-muted"
        >
          Not now
        </button>
      </div>
      <p className="text-sm text-ink-subtle">
        A saved project is used in Apply to UX mode for every paper. You can change it on your{" "}
        <Link href="/account" className="font-bold text-primary underline">
          Account
        </Link>{" "}
        page.
      </p>
    </section>
  );
}

export function ProjectNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 border-b-[1.5px] border-line-soft bg-ground px-5 py-2 text-sm text-ink-muted">
      <InfoIcon size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

// ── Superseded version ──────────────────────────────────────────────────────

/** FR-3.8: the conversation is on an older version of the paper. */
export function SupersededBanner({ paperSlug }: { paperSlug: string }) {
  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-[1.5px] border-line-soft bg-panel px-5 py-2.5"
    >
      <InfoIcon size={18} className="shrink-0 text-primary-hover" />
      <p className="font-bold">A newer version of this paper is available.</p>
      <Link href={`/papers/${paperSlug}`} className="font-bold text-primary underline">
        Start a new conversation on the current version
      </Link>
    </div>
  );
}
