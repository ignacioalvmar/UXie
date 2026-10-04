"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CHARACTERS,
  stateForTurn,
  useCharacterState,
  UxieCharacter,
  type CharacterId,
} from "@uxie/character";
import { useRouter } from "next/navigation";
import type { Mode } from "@uxie/core";
import { lastStudentTurn, messageText, requestFor, toTranscript } from "../../lib/chat/transcript";
import type {
  ApiErrorBody,
  ChatUIMessage,
  ConversationDto,
  ProgressDto,
} from "../../lib/chat/types";
import { parseApiError } from "../../lib/chat/types";
import { resetTime } from "../../lib/format";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  BookIcon,
  CheckIcon,
  LifebuoyIcon,
  RetryIcon,
  SendIcon,
  StopIcon,
} from "../icons";
import {
  FeedbackBar,
  MODE_LABEL,
  ModeSelector,
  ProgressButton,
  ProgressDrawer,
  ProjectCard,
  ProjectNote,
  StartOverDialog,
  SupersededBanner,
} from "./TutorControls";
import { TutorMarkdown } from "./TutorMarkdown";

/**
 * The chat pane (FR-3.4, FR-3.7; workspace handoff §4): streamed replies over the AI SDK UI
 * message stream (`useChat`, sending only the latest message, PRD §11), starter chips, errors and
 * limits, Stop, Retry with the same clientMessageId, resume from the server transcript.
 */

const BLOCKING = new Set([
  "rate_limited",
  "daily_limit",
  "chat_paused",
  "paper_unavailable",
  "conversation_closed",
]);
/** Errors after which the student message is NOT saved: take it back into the composer. */
const NOT_SAVED = new Set([
  "rate_limited",
  "daily_limit",
  "chat_paused",
  "busy",
  "paper_unavailable",
  "invalid_input",
  "conversation_closed",
  "already_started",
  "same_mode",
]);

const HELP_SUFFIX: Record<string, string> = {
  hint: " · Hint",
  explain: " · Explanation",
  check: " · Check",
};

export interface ChatPaneProps {
  paperSlug: string;
  character: CharacterId;
  initialConversation: ConversationDto | null;
  starterQuestions: string[];
  objectives: ProgressDto[];
  chatOpen: boolean;
  /** Focus modes offered (TUTOR_MODES). */
  modes: Mode[];
  /** The student's saved project, used by Apply mode (FR-1.5). */
  projectDescription: string | null;
  /** The conversation is on a superseded version of a still-published paper (FR-3.8). */
  superseded: boolean;
  /** Open page N in the reader (and switch to Read on mobile). */
  onCite: (page: number) => void;
  onKeepReading: () => void;
}

export function ChatPane(props: ChatPaneProps) {
  const { paperSlug, character, initialConversation, chatOpen, onCite, onKeepReading } = props;
  // Below 1024 px: icon-only Send and the log on the ground colour (handoff §5).
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const name = CHARACTERS[character].name;
  const initial = useMemo(
    () =>
      initialConversation
        ? toTranscript(initialConversation.messages, initialConversation.generating)
        : { messages: [], lastReplyFailed: false, pending: false },
    [initialConversation],
  );
  const conversationId = useRef<string | null>(initialConversation?.id ?? null);
  const [progress, setProgress] = useState<ProgressDto[]>(
    initialConversation?.progress ?? props.objectives,
  );
  const [apiError, setApiError] = useState<ApiErrorBody | null>(
    initial.lastReplyFailed ? { code: "reply_failed", message: "" } : null,
  );
  const [pending, setPending] = useState(initial.pending);
  const [stopped, setStopped] = useState(false);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const closed = initialConversation ? initialConversation.status !== "active" : false;
  const router = useRouter();
  // The mode shown: the server's after each turn; set ahead while a switch is on its way.
  const [mode, setMode] = useState<Mode>(initialConversation?.mode ?? "understand");
  const modeBefore = useRef<Mode>(mode);
  const [project, setProject] = useState(props.projectDescription);
  const [projectDismissed, setProjectDismissed] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const progressButton = useRef<HTMLButtonElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        prepareSendMessagesRequest: ({ messages }) =>
          requestFor(lastStudentTurn(messages)!, conversationId.current, paperSlug),
      }),
    [paperSlug],
  );

  /** The first chat action created the conversation: remember it and put it in the URL (?c=). */
  const adoptConversation = (id: string) => {
    if (conversationId.current === id) return;
    conversationId.current = id;
    const url = new URL(window.location.href);
    url.searchParams.set("c", id);
    window.history.replaceState(window.history.state, "", url);
  };

  const [characterState, flash] = useCharacterState("idle");
  const { messages, setMessages, sendMessage, regenerate, stop, status, clearError } =
    useChat<ChatUIMessage>({
      id: initialConversation?.id ?? `new-${paperSlug}`,
      messages: initial.messages,
      transport,
      generateId: () => crypto.randomUUID(),
      onError: (e) => {
        const err = parseApiError(e.message);
        setApiError(err);
        setMessages((list) => {
          // A reply that broke off is not saved: drop its partial text.
          const last = list.at(-1);
          if (last?.role === "assistant" && last.metadata?.status !== "complete")
            list = list.slice(0, -1);
          if (!NOT_SAVED.has(err.code)) return list;
          // The server refused before saving: take the message back into the composer, or
          // drop the button event (and undo a mode switch that did not happen).
          const user = list.at(-1);
          if (user?.role !== "user") return list;
          if (user.metadata?.event) {
            if (user.metadata.switchTo) setMode(modeBefore.current);
            return list.slice(0, -1);
          }
          setDraft(user.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
          return list.slice(0, -1);
        });
      },
      onFinish: ({ message }) => {
        const meta = message.metadata;
        if (meta?.conversationId) adoptConversation(meta.conversationId);
        if (meta?.progress) setProgress(meta.progress);
        if (meta?.mode) {
          setMode(meta.mode);
          modeBefore.current = meta.mode;
        }
        if (meta?.demonstrated?.length) {
          flash("celebrate");
          setAnnouncement(meta.demonstrated.map((s) => `Idea demonstrated: ${s}`).join(" "));
        }
      },
    });

  const busy = status === "submitted" || status === "streaming";
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const streamingMessage =
    status === "streaming" && messages.at(-1)?.role === "assistant" ? messages.at(-1) : null;
  const help = (streamingMessage ?? lastAssistant)?.metadata?.help?.kind;
  const flags = streamingMessage?.metadata?.flags;
  // The conversation id arrives with the first streamed part; keep it even if the client stops.
  useEffect(() => {
    const id = messages.at(-1)?.metadata?.conversationId;
    if (id) adoptConversation(id);
  }, [messages]);

  const blocking = apiError && BLOCKING.has(apiError.code);
  const retryAt = apiError?.retryAt ? Date.parse(apiError.retryAt) : null;

  // Live countdown for the per-minute limit; the block lifts itself when it ends.
  useEffect(() => {
    if (!retryAt) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (apiError?.code === "rate_limited" && n >= retryAt) {
        setApiError(null);
        clearError();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [retryAt, apiError?.code, clearError]);

  const resting = blocking
    ? "idle"
    : stateForTurn({
        phase:
          status === "submitted"
            ? "assessing"
            : status === "streaming"
              ? "streaming"
              : typing
                ? "typing"
                : "idle",
        help,
        flags,
      });
  const charState = characterState === "celebrate" ? "celebrate" : resting;

  const refresh = useCallback(async () => {
    const id = conversationId.current;
    if (!id) return;
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const conv = (await res.json()) as ConversationDto;
    const t = toTranscript(conv.messages, conv.generating);
    setMessages(t.messages);
    setProgress(conv.progress);
    setPending(t.pending);
    setStopped(false);
    if (t.lastReplyFailed) setApiError({ code: "reply_failed", message: "" });
    return t.pending;
  }, [setMessages]);

  // A reply generating elsewhere (reload mid-stream, Stop): poll until it is saved.
  useEffect(() => {
    if (!pending && !stopped) return;
    const t = setInterval(async () => {
      const still = await refresh();
      if (!still) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [pending, stopped, refresh]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || blocking || pending) return;
    setApiError(null);
    setStopped(false);
    setAnnouncement("");
    clearError();
    setDraft("");
    void sendMessage({ text: trimmed, metadata: {} });
  };

  const retry = () => {
    setApiError(null);
    clearError();
    void regenerate();
  };

  const canAct = !busy && !blocking && !pending && chatOpen && !closed;
  const sendEvent = (text: string, metadata: ChatUIMessage["metadata"]) => {
    setApiError(null);
    setStopped(false);
    setAnnouncement("");
    clearError();
    void sendMessage({ text, metadata });
  };

  /** "Explain it to me" (PRD §3.3): a `stuck` event moves the help ladder up one step. */
  const explain = () => {
    if (canAct) sendEvent("Explain it to me", { event: "stuck" });
  };

  /** Mode selector (FR-3.5, FR-4.7). Without a conversation, choosing a mode creates it (FR-3.2). */
  const chooseMode = (m: Mode) => {
    if (m === mode || !canAct) return;
    modeBefore.current = mode;
    setMode(m);
    if (!conversationId.current)
      sendEvent("Started the conversation", { event: "start", switchTo: m });
    else sendEvent(`Switched to ${MODE_LABEL[m]} mode`, { event: "mode_switch", switchTo: m });
  };

  /** Start over (FR-3.5): close this conversation, open a fresh one and let UXie greet. */
  const startOver = async () => {
    const id = conversationId.current;
    if (!id) return;
    setResetting(true);
    const res = await fetch(`/api/conversations/${id}/reset`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const { newConversationId } = (await res.json()) as { newConversationId: string };
      router.replace(`/papers/${paperSlug}?c=${newConversationId}`);
      return; // The workspace remounts on the new conversation (keyed by id).
    }
    setResetting(false);
    setConfirmReset(false);
    setApiError(res ? parseApiError(await res.text()) : { code: "network_error", message: "" });
  };

  /** Apply-mode project card: optionally save to the profile, then send it as the reply. */
  const sendProject = async (text: string, save: boolean) => {
    if (save) {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectDescription: text }),
      }).catch(() => null);
      if (!res?.ok) return false;
      setProject(text);
    }
    setProjectDismissed(true);
    send(`My project: ${text}`);
    return true;
  };

  // A new, empty conversation (after Start over): UXie opens it (FR-4.1).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!initialConversation || !chatOpen) return;
    const empty = initialConversation.messages.length === 0 && !initialConversation.generating;
    if (!empty || initialConversation.status !== "active") return;
    // Deferred and cancellable: under StrictMode's mount → unmount → mount only the surviving
    // mount sends (a send from the discarded mount is lost with its chat instance).
    const t = setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      sendEvent("Started the conversation", { event: "start" });
    }, 0);
    return () => clearTimeout(t);
  }, []); // Once on mount, by design.

  // Scrolling: follow new content unless the student scrolled up.
  const log = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(false);
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    if (atBottom) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
  }, [messages, status, apiError, atBottom]);
  // Late layout (fonts, Markdown) grows the log after the effect ran: keep following it.
  const follow = useRef(atBottom);
  follow.current = atBottom;
  useEffect(() => {
    const el = log.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (follow.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [messages.length > 0]);
  const onScroll = () => {
    const el = log.current!;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setAtBottom(bottom);
    if (bottom) setUnseen(false);
  };

  const hasConversation = messages.length > 0 || conversationId.current !== null;
  const visible = messages.filter((m) => m.metadata?.event !== "start");
  const settled = streamingMessage ? visible.filter((m) => m.id !== streamingMessage.id) : visible;
  const lastUser = [...visible].reverse().find((m) => m.role === "user");
  const lastUserSaved =
    !!lastUser &&
    (visible.at(-1)?.role === "assistant" ||
      (apiError !== null && !NOT_SAVED.has(apiError.code)) ||
      !!streamingMessage);
  const latestTutorId = [...settled].reverse().find((m) => m.role === "assistant")?.id;
  const composerDisabled = busy || !!blocking || pending || !chatOpen || closed;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[1.5px] border-line-soft px-5 py-3">
        <h2 className="sr-only">Conversation with {name}</h2>
        <ModeSelector
          modes={props.modes}
          mode={mode}
          disabled={!canAct}
          compact={compact}
          onChoose={chooseMode}
        />
        <ProgressButton
          progress={progress}
          hasConversation={hasConversation}
          compact={compact}
          onOpen={() => setProgressOpen(true)}
          buttonRef={progressButton}
        />
      </div>
      {props.superseded && !closed && <SupersededBanner paperSlug={paperSlug} />}
      {mode === "apply" && project && (
        <ProjectNote>
          {name} applies the paper to your project from your profile.{" "}
          <a href="/account" className="font-bold text-primary underline">
            Edit it on your Account page
          </a>
        </ProjectNote>
      )}
      <ProgressDrawer
        open={progressOpen}
        onClose={() => setProgressOpen(false)}
        progress={progress}
        mode={mode}
        modes={props.modes}
        canSwitch={canAct}
        onCite={onCite}
        onWorkOn={chooseMode}
      />
      <StartOverDialog
        open={confirmReset}
        mode={mode}
        working={resetting}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void startOver()}
      />

      <div
        ref={log}
        onScroll={onScroll}
        className={`relative min-h-0 flex-1 overflow-y-auto ${compact ? "bg-ground" : ""}`}
      >
        {!hasConversation ? (
          <EmptyState
            character={character}
            starters={props.starterQuestions}
            disabled={!chatOpen || busy}
            onPick={send}
          />
        ) : (
          <div
            className={`mx-auto flex max-w-[760px] flex-col gap-[18px] px-5 py-6 text-[17px] leading-[1.5]`}
          >
            <div
              role="log"
              aria-live="polite"
              aria-label="Messages"
              className="flex flex-col gap-[18px]"
            >
              {settled.map((m) =>
                m.role === "user" ? (
                  <StudentMessage
                    key={m.id}
                    m={m}
                    saved={m.id === lastUser?.id && lastUserSaved && !busy}
                  />
                ) : (
                  <TutorMessage
                    key={m.id}
                    m={m}
                    name={name}
                    character={character}
                    latest={m.id === latestTutorId && !streamingMessage && !busy}
                    charState={charState}
                    onCite={onCite}
                  />
                ),
              )}
            </div>
            {busy && (
              <div aria-hidden="true">
                {streamingMessage ? (
                  <TutorMessage
                    m={streamingMessage}
                    name={name}
                    character={character}
                    latest
                    charState={charState}
                    onCite={onCite}
                    streaming
                  />
                ) : (
                  <Typing character={character} name={name} charState={charState} />
                )}
              </div>
            )}
            {busy && (
              <p className="pl-[68px] text-sm text-ink-subtle">{name} is writing a reply…</p>
            )}
            {pending && !busy && (
              <p role="status" className="pl-[68px] text-sm text-ink-subtle">
                {name} is still writing a reply. It will appear here.
              </p>
            )}
            {stopped && !busy && (
              <p role="status" className="pl-[68px] text-sm text-ink-subtle">
                You stopped the reply on screen. {name} still finishes and saves it; it appears here
                in a moment.
              </p>
            )}
            {mode === "apply" && !project && !projectDismissed && !busy && !closed && chatOpen && (
              <ProjectCard
                name={name}
                disabled={!canAct}
                onSend={sendProject}
                onDismiss={() => setProjectDismissed(true)}
              />
            )}
            {apiError && (
              <ErrorPanel
                error={apiError}
                name={name}
                character={character}
                now={now}
                onRetry={retry}
              />
            )}
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>

      {unseen && !atBottom && (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              log.current!.scrollTop = log.current!.scrollHeight;
              setUnseen(false);
            }}
            className="absolute -top-14 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-pill bg-ink px-4 font-bold text-on-primary shadow-md"
          >
            New message
            <ArrowDownIcon size={18} />
          </button>
        </div>
      )}

      {closed || !chatOpen ? (
        <div className="border-t-[1.5px] border-line-soft px-5 py-4 text-ink-muted">
          {closed
            ? "This conversation is closed. You can read it, and start a new one from the paper's current version."
            : "This paper is no longer open for new conversations. You can keep reading."}
        </div>
      ) : (
        <Composer
          name={name}
          empty={!hasConversation}
          value={draft}
          onChange={(v) => {
            setDraft(v);
            setTyping(v.length > 0);
          }}
          onBlur={() => setTyping(false)}
          onSend={() => send(draft)}
          onStop={() => {
            void stop();
            setStopped(true);
          }}
          busy={busy}
          disabled={composerDisabled}
          disabledPlaceholder={placeholderFor(apiError, name, busy || pending, now)}
          showKeepReading={!!blocking || apiError?.code === "reply_failed"}
          onKeepReading={onKeepReading}
          compact={compact}
          actions={
            hasConversation && conversationId.current
              ? {
                  onExplain: explain,
                  explainDisabled: !canAct,
                  onStartOver: () => setConfirmReset(true),
                }
              : null
          }
        />
      )}
    </div>
  );
}

function placeholderFor(error: ApiErrorBody | null, name: string, busy: boolean, now: number) {
  if (busy) return `Wait for ${name} to finish…`;
  if (!error?.retryAt && error?.code !== "chat_paused") return undefined;
  if (error.code === "rate_limited")
    return `You can send again in ${Math.max(0, Math.ceil((Date.parse(error.retryAt!) - now) / 1000))} seconds`;
  if (error.code === "daily_limit") return `Chat opens again at ${resetTime(error.retryAt!).clock}`;
  if (error.code === "chat_paused") return "Chat is paused for now";
  return undefined;
}

function EmptyState({
  character,
  starters,
  disabled,
  onPick,
}: {
  character: CharacterId;
  starters: string[];
  disabled: boolean;
  onPick: (q: string) => void;
}) {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-5 py-6">
      <div className="flex items-end gap-3">
        <UxieCharacter character={character} size={92} decorative />
        <p className="uxie-bubble mb-4 px-4 py-3 text-lg leading-[1.45]">
          Hi! I’ll ask the questions, you do the thinking. Pick one below to start, or ask me
          anything about this paper.
        </p>
      </div>
      {starters.length > 0 && (
        <section aria-labelledby="starters-h" className="flex flex-col gap-3">
          <h2 id="starters-h" className="font-display text-xl font-bold">
            Start with a question
          </h2>
          <ul className="flex flex-col gap-2.5">
            {starters.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(q)}
                  className="flex min-h-[60px] w-full items-center justify-between gap-3 rounded-chip border-[1.5px] border-progress-empty bg-surface px-4 py-3 text-left text-[17px] hover:border-primary hover:bg-ground disabled:opacity-60"
                >
                  {q}
                  <ArrowRightIcon size={20} className="shrink-0 text-primary" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="flex items-start gap-2 text-[15px] text-ink-muted">
        <BookIcon size={18} className="mt-0.5 shrink-0" />
        Just want to read first? Go ahead. Nothing is saved as a conversation until you send a
        message or pick a question.
      </p>
    </div>
  );
}

function StudentMessage({ m, saved }: { m: ChatUIMessage; saved: boolean }) {
  const text = messageText(m);
  if (m.metadata?.event)
    return (
      <p className="self-center rounded-pill bg-ground px-3 py-1 text-sm font-bold text-ink-muted">
        {text}
      </p>
    );
  return (
    <div className="flex flex-col items-end gap-1">
      <p className="sr-only">You said:</p>
      <div className="uxie-bubble--student max-w-[82%] whitespace-pre-wrap px-4 py-3">{text}</div>
      {saved && (
        <span className="inline-flex items-center gap-1 text-[13px] text-ink-subtle">
          <CheckIcon size={14} />
          Saved
        </span>
      )}
    </div>
  );
}

function TutorMessage({
  m,
  name,
  character,
  latest,
  charState,
  onCite,
  streaming = false,
}: {
  m: ChatUIMessage;
  name: string;
  character: CharacterId;
  latest: boolean;
  charState: ReturnType<typeof stateForTurn>;
  onCite: (page: number) => void;
  streaming?: boolean;
}) {
  const help = m.metadata?.help?.kind;
  return (
    <div className="flex items-end gap-3">
      <div className="w-14 shrink-0">
        {latest && <UxieCharacter character={character} state={charState} size={56} decorative />}
      </div>
      <div className="flex min-w-0 max-w-[88%] flex-col gap-1">
        <p className="text-sm font-bold text-ink-muted">
          {name}
          {help ? (HELP_SUFFIX[help] ?? "") : ""}
          <span className="sr-only"> said:</span>
        </p>
        <div className="uxie-bubble px-4 py-3">
          <TutorMarkdown text={messageText(m)} onCite={onCite} final={!streaming} />
          {streaming && <Dots />}
        </div>
        {!streaming && m.metadata?.status === "complete" && m.metadata.tutorMessageId && (
          <FeedbackBar
            messageId={m.metadata.tutorMessageId}
            initial={m.metadata.feedback ?? null}
          />
        )}
      </div>
    </div>
  );
}

const Dots = () => (
  <span className="mt-1 inline-flex gap-1" aria-hidden="true">
    {[0, 1, 2].map((i) => (
      <span key={i} className="uxie-typing-dot size-2 rounded-full bg-primary" />
    ))}
  </span>
);

function Typing({
  character,
  name,
  charState,
}: {
  character: CharacterId;
  name: string;
  charState: ReturnType<typeof stateForTurn>;
}) {
  return (
    <div className="flex items-end gap-3">
      <div className="w-14 shrink-0">
        <UxieCharacter character={character} state={charState} size={56} decorative />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold text-ink-muted">{name}</p>
        <div className="uxie-bubble px-4 py-3.5">
          <Dots />
        </div>
      </div>
    </div>
  );
}

function ErrorPanel({
  error,
  name,
  character,
  now,
  onRetry,
}: {
  error: ApiErrorBody;
  name: string;
  character: CharacterId;
  now: number;
  onRetry: () => void;
}) {
  const panel = (
    role: "alert" | "status",
    tone: string,
    title: string,
    body: ReactNode,
    action?: ReactNode,
  ) => (
    <div className="flex items-end gap-3">
      <div className="w-14 shrink-0">
        <UxieCharacter character={character} size={56} decorative paused className="uxie-resting" />
      </div>
      <div
        role={role}
        className={`flex max-w-[88%] flex-col gap-2 rounded-alert border-[1.5px] px-4 py-3 ${tone}`}
      >
        <p className="font-bold">{title}</p>
        <p>{body}</p>
        {action}
      </div>
    </div>
  );
  switch (error.code) {
    case "rate_limited": {
      const secs = Math.max(0, Math.ceil((Date.parse(error.retryAt ?? "") - now) / 1000)) || 0;
      return panel(
        "status",
        "border-transparent bg-panel",
        "A short pause",
        <>
          You’re sending messages quickly. {name} can answer again in{" "}
          <strong>{secs} seconds</strong>. A good moment to check the page in the paper.
        </>,
      );
    }
    case "daily_limit": {
      const t = resetTime(error.retryAt ?? new Date(now).toISOString(), new Date(now));
      return panel(
        "status",
        "border-transparent bg-panel",
        "That’s it for today",
        <>
          You’ve reached today’s message limit. Chat opens again at <strong>{t.clock}</strong> (in{" "}
          {t.inText}). Your conversation is saved, and the paper stays open for reading.
        </>,
      );
    }
    case "chat_paused":
      return panel(
        "status",
        "border-line bg-surface",
        "UXie is paused",
        "Chat is unavailable for the whole course right now, and your instructor knows. You can keep reading, and your conversation is saved for later.",
      );
    case "busy":
      return panel(
        "status",
        "border-transparent bg-panel",
        `${name} is still answering`,
        "Your previous message is still being answered. Wait a moment, then send again.",
      );
    case "paper_unavailable":
    case "conversation_closed":
      return panel(
        "status",
        "border-line bg-surface",
        "Chat is closed here",
        error.message || "You can keep reading the paper.",
      );
    case "unauthenticated":
      return panel(
        "alert",
        "border-danger-line bg-danger-bg",
        "You’re signed out",
        <>
          Please{" "}
          <a className="font-bold text-primary underline" href="/auth/sign-in">
            sign in again
          </a>
          ; your messages so far are saved.
        </>,
      );
    default:
      return panel(
        "alert",
        "border-danger-line bg-danger-bg",
        `${name} couldn’t reply`,
        "Something went wrong on our side, not with your answer. Your message is saved.",
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 items-center self-start rounded-field bg-primary px-4 font-bold text-on-primary hover:bg-primary-hover"
        >
          Try again
        </button>,
      );
  }
}

function Composer({
  name,
  empty,
  value,
  onChange,
  onBlur,
  onSend,
  onStop,
  busy,
  disabled,
  disabledPlaceholder,
  showKeepReading,
  onKeepReading,
  compact,
  actions,
}: {
  /** "Explain it to me" and "Start over"; absent before the conversation exists. */
  actions: { onExplain: () => void; explainDisabled: boolean; onStartOver: () => void } | null;
  name: string;
  empty: boolean;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  disabledPlaceholder?: string;
  showKeepReading: boolean;
  onKeepReading: () => void;
  compact: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    const line = 17 * 1.5;
    el.style.height = `${Math.min(el.scrollHeight, line * 6 + 26)}px`;
  }, []);
  // The placeholder changes while a reply is written; it can wrap differently.
  useLayoutEffect(fit, [fit, value, disabled, disabledPlaceholder]);
  // The first measurement can run before the web fonts and pane width settle.
  useEffect(() => {
    void document.fonts?.ready.then(fit);
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [fit]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
      className="flex flex-col gap-2.5 border-t-[1.5px] border-line-soft bg-surface px-5 pb-4 pt-3.5"
    >
      <label htmlFor="composer" className="text-[15px] font-bold">
        {empty ? "Or ask your own question" : `Reply to ${name}`}
      </label>
      <div className="flex items-end gap-2.5">
        <textarea
          ref={area}
          id="composer"
          rows={1}
          value={value}
          maxLength={4000}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={
            disabled && disabledPlaceholder
              ? disabledPlaceholder
              : empty
                ? "For example: what does “signifier” mean here?"
                : "Type your answer. It’s fine to think out loud."
          }
          className={`flex-1 resize-none rounded-field border-[1.5px] px-3.5 py-3 text-[17px] leading-[1.5] placeholder:text-placeholder ${
            disabled ? "border-progress-empty bg-ground" : "border-line bg-surface"
          } ${compact ? "min-h-[50px]" : "min-h-14"}`}
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-14 shrink-0 items-center gap-2 rounded-field border-[1.5px] border-primary bg-surface px-4 font-bold text-primary"
          >
            <StopIcon size={18} />
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || !value.trim()}
            aria-label={compact ? "Send" : undefined}
            className="inline-flex h-14 shrink-0 items-center gap-2 rounded-field bg-primary px-5 font-bold text-on-primary hover:bg-primary-hover disabled:bg-line-soft disabled:text-ink-muted"
          >
            {compact ? (
              <SendIcon size={20} />
            ) : (
              <>
                Send <ArrowRightIcon size={18} />
              </>
            )}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {actions && (
            <>
              <button
                type="button"
                onClick={actions.onExplain}
                disabled={actions.explainDisabled}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-field border-[1.5px] border-primary px-3 font-bold text-primary hover:bg-ground disabled:border-line-soft disabled:text-ink-muted ${compact ? "flex-1" : ""}`}
              >
                <LifebuoyIcon size={18} />
                Explain it to me
              </button>
              <button
                type="button"
                onClick={actions.onStartOver}
                disabled={busy}
                className="inline-flex min-h-11 items-center gap-2 rounded-field px-3 font-bold text-ink-muted hover:bg-ground disabled:opacity-60"
              >
                <RetryIcon size={18} />
                Start over
              </button>
            </>
          )}
          {showKeepReading && (
            <button
              type="button"
              onClick={onKeepReading}
              className="inline-flex min-h-11 items-center gap-2 rounded-field border-[1.5px] border-line px-3 font-bold text-ink"
            >
              <BookIcon size={18} />
              Keep reading the paper
            </button>
          )}
        </div>
        {!compact && (
          <span className="text-sm text-ink-subtle">Enter sends · Shift+Enter adds a line</span>
        )}
      </div>
    </form>
  );
}
