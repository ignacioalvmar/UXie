import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from "ai";
import type { LearnerState, TurnEvent } from "@uxie/core";
import type { GuideSummary } from "@uxie/db";
import { TutorError, type TurnResult, type TurnStream } from "@uxie/tutor";
import { checkLimits, MINUTE_MS, monthStart, utcDay } from "../limits";
import type { ApiErrorBody, ChatUIMessage, ProgressDto, TutorMeta } from "./types";

/**
 * The web adapter around one tutor turn (PRD §4.4 steps 2–8): ownership, availability, limits,
 * generation lock, engine turn, UI message stream, lock release and after-work. Storage and the
 * engine are injected so the rules are tested without a database (PRD §15 "Web API").
 */

export interface ChatConversation {
  id: string;
  paperId: string;
  paperVersionId: string;
  status: "active" | "reset" | "closed";
}

export interface ChatStore {
  ownConversation(studentId: string, conversationId: string): Promise<ChatConversation | null>;
  /** Paper published, in a published module: new turns allowed (retired → false, FR-2.3). */
  paperOpenForChat(paperId: string): Promise<boolean>;
  hasClientMessage(conversationId: string, clientMessageId: string): Promise<boolean>;
  turnsToday(studentId: string, day: string): Promise<number>;
  turnsSince(studentId: string, since: Date): Promise<{ turns: number; oldest: Date | null }>;
  spendSince(since: Date): Promise<number>;
  acquireLock(conversationId: string): Promise<boolean>;
  releaseLock(conversationId: string): Promise<void>;
  guide(versionId: string): Promise<GuideSummary>;
  logEvent(type: string, studentId: string, props: Record<string, unknown>): Promise<void>;
}

export interface TurnEngine {
  runTurn(input: {
    conversationId: string;
    studentId: string;
    clientMessageId: string;
    text?: string;
    event: TurnEvent;
  }): Promise<TurnStream>;
  maybeSummarizeHistory(conversationId: string): Promise<unknown>;
}

export interface ChatDeps {
  store: ChatStore;
  engine: () => Promise<TurnEngine>;
  limits: { dailyLimit: number; perMinuteLimit: number; ceilingEur: number };
  /** Next.js `after()`: keeps the function alive until the reply is saved (client may leave). */
  after: (task: Promise<unknown>) => void;
  now?: () => Date;
  onError?: (e: unknown, context: Record<string, unknown>) => void;
}

export interface TurnInput {
  studentId: string;
  conversationId: string;
  clientMessageId: string;
  text?: string;
  event: TurnEvent;
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  extra: Partial<ApiErrorBody> = {},
  headers: Record<string, string> = {},
): Response {
  const body: ApiErrorBody = { code, message, ...extra };
  return Response.json(body, { status, headers });
}

const TUTOR_ERROR_STATUS: Record<string, [number, string]> = {
  forbidden: [404, "not_found"],
  conversation_closed: [409, "conversation_closed"],
  already_started: [409, "already_started"],
  invalid_input: [400, "invalid_input"],
};

const errorText = (code: string, message: string) => JSON.stringify({ code, message });

export function progressDto(state: LearnerState, guide: GuideSummary): ProgressDto[] {
  return guide.objectives.map((o) => ({
    id: o.id,
    kind: o.kind,
    statement: o.statement,
    status: state.objectives[o.id] ?? "not_started",
    evidence: state.evidence[o.id] ?? null,
    active: state.active_objective === o.id,
    refs: o.refs,
  }));
}

function newlyDemonstrated(before: LearnerState | null, after: LearnerState, guide: GuideSummary) {
  if (!before) return [];
  return guide.objectives
    .filter(
      (o) =>
        after.objectives[o.id] === "demonstrated" && before.objectives[o.id] !== "demonstrated",
    )
    .map((o) => o.statement);
}

/** Runs one turn and answers with an AI SDK UI message stream, or a JSON error before streaming. */
export async function handleTurn(deps: ChatDeps, input: TurnInput): Promise<Response> {
  const { store } = deps;
  const now = deps.now?.() ?? new Date();

  const conv = await store.ownConversation(input.studentId, input.conversationId);
  if (!conv) return jsonError(404, "not_found", "Conversation not found.");
  if (conv.status !== "active")
    return jsonError(
      409,
      "conversation_closed",
      "This conversation is closed. You can still read it.",
    );
  if (!(await store.paperOpenForChat(conv.paperId)))
    return jsonError(410, "paper_unavailable", "This paper is no longer available for chat.");

  const isRetry = await store.hasClientMessage(conv.id, input.clientMessageId);
  const [spendEur, turnsToday, window] = await Promise.all([
    store.spendSince(monthStart(now)),
    store.turnsToday(input.studentId, utcDay(now)),
    store.turnsSince(input.studentId, new Date(now.getTime() - MINUTE_MS)),
  ]);
  const block = checkLimits({
    now,
    spendEur,
    ceilingEur: deps.limits.ceilingEur,
    turnsToday,
    dailyLimit: deps.limits.dailyLimit,
    turnsLastMinute: window.turns,
    oldestInWindow: window.oldest,
    perMinuteLimit: deps.limits.perMinuteLimit,
    isRetry,
  });
  if (block) {
    const retryAfter = block.retryAt
      ? Math.max(1, Math.ceil((Date.parse(block.retryAt) - now.getTime()) / 1000))
      : undefined;
    return jsonError(
      block.status,
      block.code,
      block.message,
      block.retryAt ? { retryAt: block.retryAt } : {},
      retryAfter ? { "Retry-After": String(retryAfter) } : {},
    );
  }

  if (!(await store.acquireLock(conv.id)))
    return jsonError(409, "busy", "UXie is still answering your previous message.");

  let turn: TurnStream;
  let engine: TurnEngine;
  try {
    engine = await deps.engine();
    turn = await engine.runTurn({
      conversationId: conv.id,
      studentId: input.studentId,
      clientMessageId: input.clientMessageId,
      text: input.text,
      event: input.event,
    });
  } catch (e) {
    await store.releaseLock(conv.id).catch(() => {});
    if (e instanceof TutorError && TUTOR_ERROR_STATUS[e.code]) {
      const [status, code] = TUTOR_ERROR_STATUS[e.code]!;
      return jsonError(status, code, e.message);
    }
    deps.onError?.(e, { conversationId: conv.id, phase: "start" });
    return jsonError(502, "reply_failed", "UXie couldn't reply. Your message is saved.");
  }

  if (!isRetry)
    void store
      .logEvent(
        input.event.type === "message" ? "message_sent" : `event_${input.event.type}`,
        input.studentId,
        {
          conversation_id: conv.id,
        },
      )
      .catch(() => {});

  const guide = store.guide(conv.paperVersionId);
  let pump: Promise<void> = Promise.resolve();
  const stream = createUIMessageStream<ChatUIMessage>({
    execute: ({ writer }) => {
      pump = pumpTurn(deps, { conv, input, turn, engine, guide, writer });
      deps.after(pump);
      return pump;
    },
    onError: () => errorText("reply_failed", "UXie couldn't reply. Your message is saved."),
  });
  return createUIMessageStreamResponse({ stream });
}

async function pumpTurn(
  deps: ChatDeps,
  ctx: {
    conv: ChatConversation;
    input: TurnInput;
    turn: TurnStream;
    engine: TurnEngine;
    guide: Promise<GuideSummary>;
    writer: UIMessageStreamWriter<ChatUIMessage>;
  },
): Promise<void> {
  const { conv, input, turn, writer } = ctx;
  // The client may disconnect (Stop, closed tab); the reply is still generated and saved (FR-3.4).
  const write = (part: Parameters<typeof writer.write>[0]) => {
    try {
      writer.write(part);
    } catch {
      // Stream already closed by the client.
    }
  };
  const textId = `${turn.meta.tutorMessageId}-text`;
  const startMeta: TutorMeta = {
    conversationId: conv.id,
    tutorMessageId: turn.meta.tutorMessageId,
    studentMessageId: turn.meta.studentMessageId,
    help: turn.meta.help,
    flags: turn.meta.flags,
    replayed: turn.meta.replayed,
  };
  let result: TurnResult | null = null;
  try {
    write({ type: "start", messageId: turn.meta.tutorMessageId, messageMetadata: startMeta });
    write({ type: "text-start", id: textId });
    try {
      for await (const delta of turn.textStream) write({ type: "text-delta", id: textId, delta });
    } catch {
      // A mid-stream provider error also rejects `done`, handled below.
    }
    write({ type: "text-end", id: textId });
    result = await turn.done;
    const guide = await ctx.guide;
    write({
      type: "finish",
      messageMetadata: {
        status: "complete",
        text: result.text,
        citations: result.citations,
        progress: progressDto(result.state, guide),
        demonstrated: newlyDemonstrated(result.debug?.previousState ?? null, result.state, guide),
      },
    });
  } catch (e) {
    const code = e instanceof TutorError ? e.code : "internal_error";
    deps.onError?.(e, { conversationId: conv.id, phase: "stream", errorCode: code });
    write({
      type: "error",
      errorText: errorText(
        code === "provider_refusal" ? "reply_refused" : "reply_failed",
        "UXie couldn't reply. Your message is saved.",
      ),
    });
  } finally {
    await deps.store.releaseLock(conv.id).catch((e) => deps.onError?.(e, { phase: "unlock" }));
  }

  // PRD §4.4 step 8: fold old turns into the summary, record analytics (ids only, NFR-19).
  if (result && !result.debug) return; // replayed reply: nothing new to fold or record
  await deps.store
    .logEvent(result ? "reply_completed" : "reply_failed", input.studentId, {
      conversation_id: conv.id,
      ...(result ? { help_level: result.help.kind } : {}),
    })
    .catch(() => {});
  if (result) await ctx.engine.maybeSummarizeHistory(conv.id).catch(() => {});
}
