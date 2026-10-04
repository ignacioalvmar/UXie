"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Mode } from "@uxie/core";
import type { TurnDebugDto } from "../../lib/admin/debug";
import { parseApiError, type ChatUIMessage, type TutorMeta } from "../../lib/chat/types";
import { TutorMarkdown } from "../chat/TutorMarkdown";
import { Badge, Button, ErrorNote, type ApiFailure } from "./ui";

/**
 * FR-6.5 "Test as student": a sandbox chat on this version with the current guide (an
 * `is_test` conversation, excluded from reports), plus the debug panel per reply: assessment
 * JSON, help level, state diff, prompt version, tokens, cached tokens, latency.
 */

const MODES: { id: Mode; label: string }[] = [
  { id: "understand", label: "Understand" },
  { id: "apply", label: "Apply to UX" },
  { id: "critique", label: "Critique" },
  { id: "build", label: "Build" },
];

const HELP_LABEL: Record<string, string> = {
  ask: "Question",
  explain: "Explanation",
  check: "Check",
};
const helpText = (h: TutorMeta["help"]) =>
  !h ? "" : h.kind === "hint" ? `Hint ${h.index + 1}` : (HELP_LABEL[h.kind] ?? h.kind);

const textOf = (m: ChatUIMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

function conversationOf(messages: ChatUIMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const id = messages[i]!.metadata?.conversationId;
    if (id) return id;
  }
  return undefined;
}

export function TestChat({
  versionId,
  canChat,
  blockedReason,
  initialMessages,
  initialConversationId,
  initialMode,
  onCite,
}: {
  versionId: string;
  canChat: boolean;
  blockedReason: string;
  initialMessages: ChatUIMessage[];
  initialConversationId: string | null;
  initialMode: Mode;
  onCite: (page: number) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<ApiFailure | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const resumeId = useRef<string | null>(initialConversationId);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: `/api/admin/versions/${versionId}/test-chat`,
        prepareSendMessagesRequest: ({ messages }) => {
          const last = [...messages].reverse().find((m) => m.role === "user")!;
          const conversationId = conversationOf(messages) ?? resumeId.current ?? undefined;
          const meta = last.metadata ?? {};
          // Without a conversation the server opens one in the chosen mode.
          const base = conversationId
            ? { clientMessageId: last.id, conversationId }
            : { clientMessageId: last.id, mode: modeRef.current };
          if (meta.event === "start")
            return { body: { clientMessageId: last.id, mode: modeRef.current } };
          if (meta.event === "stuck") return { body: { ...base, event: "stuck" } };
          if (meta.event === "mode_switch")
            return { body: { ...base, event: "mode_switch", mode: meta.switchTo } };
          return { body: { ...base, text: textOf(last) } };
        },
      }),
    [versionId],
  );

  const { messages, sendMessage, setMessages, status, stop, regenerate } = useChat<ChatUIMessage>({
    id: `test-${versionId}`,
    messages: initialMessages,
    transport,
    generateId: () => crypto.randomUUID(),
    onError: (e) => setError(parseApiError(e.message)),
  });

  const busy = status === "submitted" || status === "streaming";
  const conversationId = conversationOf(messages) ?? resumeId.current;

  // The conversation's mode follows the latest finished reply (mode switches, FR-4.7).
  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant" && m.metadata?.mode);
    if (last?.metadata?.mode) setMode(last.metadata.mode);
  }, [messages]);

  const replies = messages.filter((m) => m.role === "assistant");
  const debugFor =
    replies.find((m) => m.id === selected) ??
    [...replies].reverse().find((m) => m.metadata?.debug) ??
    null;

  const send = (text: string, meta: TutorMeta = {}) => {
    setError(null);
    void sendMessage({ text, metadata: meta });
  };

  const newChat = () => {
    resumeId.current = null;
    setMessages([]);
    setSelected(null);
    send("New test chat", { event: "start" });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    // Without a conversation, the first message opens one and is answered directly.
    send(text);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (!conversationId) return setMode(next);
    send(`Switched to ${MODES.find((m) => m.id === next)!.label} mode`, {
      event: "mode_switch",
      switchTo: next,
    });
  };

  if (!canChat) return <p className="rounded-field bg-panel p-4">{blockedReason}</p>;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <section aria-label="Test chat" className="flex min-h-[60vh] flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Focus mode" className="flex flex-wrap gap-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mode === m.id}
                disabled={busy}
                onClick={() => switchMode(m.id)}
                className={`min-h-11 rounded-pill px-3 font-bold ${mode === m.id ? "bg-primary text-on-primary" : "bg-panel text-ink hover:bg-line-soft"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={newChat} disabled={busy}>
              New test chat
            </Button>
          </div>
        </div>
        <p className="text-sm text-ink-muted">
          Test conversations are marked as tests and left out of reports and exports. Saving the
          guide closes them, so the next chat starts from the saved guide.
        </p>

        <ol
          role="log"
          aria-label="Test conversation"
          className="flex flex-1 flex-col gap-3 overflow-auto rounded-field border border-line-soft bg-ground p-3"
        >
          {messages.length === 0 && (
            <li className="text-ink-muted">
              Start with “New test chat” (UXie opens) or type a first message as a student would.
            </li>
          )}
          {messages.map((m) => {
            const meta = m.metadata ?? {};
            if (m.role === "user" && meta.event)
              return (
                <li key={m.id} className="self-center">
                  <Badge>{meta.event === "start" ? "New test chat" : textOf(m)}</Badge>
                </li>
              );
            if (m.role === "user")
              return (
                <li
                  key={m.id}
                  className="max-w-[85%] self-end rounded-bubble bg-primary px-4 py-2 text-on-primary"
                >
                  {textOf(m)}
                </li>
              );
            const done = meta.status === "complete";
            return (
              <li key={m.id} className="flex max-w-[95%] flex-col gap-1 self-start">
                <span className="text-sm font-bold text-ink-muted">
                  UXie{meta.help ? ` · ${helpText(meta.help)}` : ""}
                </span>
                <div className="rounded-bubble bg-surface px-4 py-2">
                  <TutorMarkdown text={meta.text ?? textOf(m)} onCite={onCite} final={done} />
                </div>
                {meta.debug && (
                  <button
                    type="button"
                    onClick={() => setSelected(m.id)}
                    aria-pressed={debugFor?.id === m.id}
                    className="self-start rounded-field px-2 py-1 text-sm font-bold text-primary hover:bg-panel"
                  >
                    {debugFor?.id === m.id ? "Debug shown →" : "Show debug"}
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        <ErrorNote error={error} />
        {error && messages.at(-1)?.role === "user" && (
          <div>
            <Button onClick={() => (setError(null), void regenerate())}>Try again</Button>
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="test-input" className="sr-only">
            Message as a student
          </label>
          <textarea
            id="test-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={3}
            maxLength={4000}
            placeholder="Answer as a student would…"
            className="w-full rounded-field border-[1.5px] border-line bg-surface p-3"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={!draft.trim() || busy}>
              Send
            </Button>
            <Button
              disabled={busy || !conversationId}
              onClick={() => send("Explain it to me", { event: "stuck" })}
            >
              Explain it to me
            </Button>
            {busy && (
              <Button variant="ghost" onClick={() => void stop()}>
                Stop
              </Button>
            )}
          </div>
        </form>
      </section>

      <DebugPanel debug={debugFor?.metadata?.debug ?? null} />
    </div>
  );
}

function DebugPanel({ debug }: { debug: TurnDebugDto | null }) {
  return (
    <aside
      aria-labelledby="debug-h"
      className="flex flex-col gap-3 rounded-field border border-line-soft bg-surface p-4 text-sm xl:max-h-[80vh] xl:overflow-auto"
    >
      <h3 id="debug-h" className="font-display text-lg font-bold">
        Debug
      </h3>
      {!debug ? (
        <p className="text-ink-muted">
          Shown for replies generated in this session (not for replayed or earlier replies).
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="font-bold">Help level</dt>
            <dd>
              <code>{debug.help}</code>
            </dd>
            <dt className="font-bold">Model</dt>
            <dd>
              {debug.provider}:{debug.model}
            </dd>
            <dt className="font-bold">Prompt</dt>
            <dd className="break-all">
              <code>{debug.promptVersion}</code>
            </dd>
            <dt className="font-bold">Context</dt>
            <dd>
              {debug.contextStrategy}
              {Array.isArray(debug.pagesIncluded)
                ? ` (pages ${debug.pagesIncluded.join(", ")})`
                : " (all pages)"}
            </dd>
            <dt className="font-bold">Tokens</dt>
            <dd>
              {debug.tokens
                ? `${debug.tokens.input.toLocaleString("en-GB")} in (${debug.tokens.cachedInput.toLocaleString("en-GB")} cached, ${debug.tokens.cacheWrite.toLocaleString("en-GB")} cache write) · ${debug.tokens.output.toLocaleString("en-GB")} out`
                : "–"}
            </dd>
            <dt className="font-bold">Assessment</dt>
            <dd>
              {debug.assessmentTokens
                ? `${debug.assessmentTokens.model}: ${debug.assessmentTokens.input.toLocaleString("en-GB")} in · ${debug.assessmentTokens.output} out`
                : "–"}
            </dd>
            <dt className="font-bold">Latency</dt>
            <dd>
              {debug.latencyMs ?? "–"} ms (first token {debug.ttftMs ?? "–"} ms)
            </dd>
            <dt className="font-bold">Cost</dt>
            <dd>{debug.costEur === null ? "–" : `€${debug.costEur.toFixed(5)}`}</dd>
          </dl>

          {debug.assessmentFailure && (
            <p className="rounded-field bg-danger-bg p-2 text-danger-ink">
              Assessment failed: {debug.assessmentFailure} (fallback used)
            </p>
          )}

          <div>
            <h4 className="font-bold">State changes</h4>
            {debug.stateChanges.length === 0 ? (
              <p className="text-ink-muted">No change.</p>
            ) : (
              <table className="w-full text-left">
                <thead className="text-ink-muted">
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                  </tr>
                </thead>
                <tbody>
                  {debug.stateChanges.map((c) => (
                    <tr key={c.path} className="border-t border-line-soft align-top">
                      <th scope="row" className="pr-2 font-mono font-normal break-all">
                        {c.path}
                      </th>
                      <td className="pr-2 font-mono break-all">{show(c.before)}</td>
                      <td className="font-mono break-all">{show(c.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <details open>
            <summary className="cursor-pointer font-bold">Assessment JSON</summary>
            <pre className="mt-1 overflow-auto rounded-field bg-ground p-2 text-xs whitespace-pre-wrap">
              {JSON.stringify(debug.assessment, null, 2)}
            </pre>
          </details>
        </>
      )}
    </aside>
  );
}

const show = (v: unknown) =>
  v === null || v === undefined ? "–" : typeof v === "string" ? v : JSON.stringify(v);
