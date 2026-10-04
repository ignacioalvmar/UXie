import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BaseEnvSchema, llmSettingsFromEnv, parseEnv } from "@uxie/core";
import type { GuideSummary } from "@uxie/db";
import { createGateway, defaultMockResponder, type MockResponder } from "@uxie/llm";
import { loadPromptDir, TutorEngine } from "@uxie/tutor";
import {
  InMemoryConversationRepo,
  InMemoryPaperRepo,
  InMemoryProfileRepo,
  InMemoryUsageRepo,
  loadFixturePaper,
} from "@uxie/tutor/testing";
import { handleTurn, type ChatDeps, type ChatStore, type TurnInput } from "./turn";
import type { TutorMeta } from "./types";

/**
 * PRD §15 "Web API": the chat route's rules against the real TutorEngine on in-memory ports with
 * the mock LLM: ownership, limits (429), spend ceiling (503), lock (409), idempotent retries.
 */

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const prompts = loadPromptDir(`${root}prompts`);
const fixture = loadFixturePaper(`${root}fixtures/papers/visible-cues`, { parseYaml: parse });
const STUDENT = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const VERSION = "00000000-0000-4000-8000-0000000000c3";
const NOW = new Date("2026-10-15T10:00:00Z");

let ids = 0;
const newId = () => `00000000-0000-4000-9000-${String(++ids).padStart(12, "0")}`;

const guideSummary: GuideSummary = {
  starterQuestions: fixture.guide.starter_questions,
  objectives: fixture.guide.objectives.map((o) => ({
    id: o.id,
    kind: o.kind,
    statement: o.statement,
    refs: o.refs,
    keyConcepts: o.key_concepts,
  })),
};

interface World {
  deps: ChatDeps;
  conversations: InMemoryConversationRepo;
  usage: InMemoryUsageRepo;
  conversationId: string;
  locks: Set<string>;
  pending: Promise<unknown>[];
  counts: { spendEur: number; turnsToday: number; lastMinute: number };
  paperOpen: { value: boolean };
  respond: (r: MockResponder) => void;
}

function world(): World {
  let responder: MockResponder = defaultMockResponder;
  const env = parseEnv(BaseEnvSchema, { LLM_PROVIDER: "mock" });
  const llm = createGateway(llmSettingsFromEnv(env), { mockResponder: (call) => responder(call) });
  const papers = new InMemoryPaperRepo();
  papers.add({
    versionId: VERSION,
    title: fixture.pagesFile.title,
    pages: fixture.pagesFile.pages,
    guide: fixture.guide,
  });
  const conversations = new InMemoryConversationRepo(newId);
  const usage = new InMemoryUsageRepo();
  const conv = conversations.create({
    studentId: STUDENT,
    paperVersionId: VERSION,
    guide: fixture.guide,
  });
  const engine = new TutorEngine({
    llm,
    papers,
    conversations,
    profiles: new InMemoryProfileRepo(),
    usage,
    prompts,
    newId,
    clock: () => NOW,
    config: {
      stuckThreshold: 3,
      historyTurns: 16,
      tutorLanguage: "mirror",
      contextStrategy: "auto",
      contextWindow: 1_000_000,
      retrievalMaxPages: 8,
      assessmentTimeoutMs: 8000,
      maxOutputTokens: 2000,
    },
  });

  const locks = new Set<string>();
  const counts = { spendEur: 0, turnsToday: 0, lastMinute: 0 };
  const paperOpen = { value: true };
  const store: ChatStore = {
    async ownConversation(studentId, id) {
      const c = conversations.conversations.get(id);
      return c && c.studentId === studentId
        ? { id: c.id, paperId: "paper-1", paperVersionId: c.paperVersionId, status: c.status }
        : null;
    },
    paperOpenForChat: async () => paperOpen.value,
    hasClientMessage: async (id, cmid) =>
      conversations.messages.some((m) => m.conversationId === id && m.clientMessageId === cmid),
    turnsToday: async () => counts.turnsToday,
    turnsSince: async () => ({
      turns: counts.lastMinute,
      oldest: new Date(NOW.getTime() - 20_000),
    }),
    spendSince: async () => counts.spendEur,
    acquireLock: async (id) => (locks.has(id) ? false : (locks.add(id), true)),
    releaseLock: async (id) => void locks.delete(id),
    guide: async () => guideSummary,
    logEvent: async () => {},
  };
  const pending: Promise<unknown>[] = [];
  return {
    deps: {
      store,
      engine: async () => engine,
      limits: { dailyLimit: 120, perMinuteLimit: 8, ceilingEur: 100 },
      after: (p) => void pending.push(p),
      now: () => NOW,
    },
    conversations,
    usage,
    conversationId: conv.id,
    locks,
    pending,
    counts,
    paperOpen,
    respond: (r) => {
      responder = r;
    },
  };
}

interface Chunk {
  type: string;
  delta?: string;
  errorText?: string;
  messageMetadata?: TutorMeta;
}

async function chunks(res: Response): Promise<Chunk[]> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)) as Chunk);
}

const say = (w: World, text: string, clientMessageId = newId()): TurnInput => ({
  studentId: STUDENT,
  conversationId: w.conversationId,
  clientMessageId,
  text,
  event: { type: "message" },
});

let w: World;
beforeEach(() => {
  w = world();
});

describe("FR-3.4 / PRD §4.4 chat turn route", () => {
  it("streams the reply with start metadata, text deltas and final citations + progress", async () => {
    const res = await handleTurn(w.deps, say(w, "Affordances are what you can do with something."));
    expect(res.status).toBe(200);
    const parts = await chunks(res);
    const start = parts.find((p) => p.type === "start")!;
    expect(start.messageMetadata).toMatchObject({
      conversationId: w.conversationId,
      replayed: false,
    });
    expect(start.messageMetadata?.help?.kind).toBeDefined();
    expect(
      parts
        .filter((p) => p.type === "text-delta")
        .map((p) => p.delta)
        .join(""),
    ).toContain("[p. 1]");
    const finish = parts.find((p) => p.type === "finish")!;
    expect(finish.messageMetadata?.citations).toEqual([expect.objectContaining({ pageFrom: 1 })]);
    expect(finish.messageMetadata?.progress?.map((p) => p.id)).toEqual(
      fixture.guide.objectives.map((o) => o.id),
    );
    // Progress never carries guide internals.
    expect(JSON.stringify(finish.messageMetadata)).not.toContain(
      fixture.guide.objectives[0]!.hints[0]!,
    );
    await Promise.all(w.pending);
    expect(w.locks.size).toBe(0);
    expect(w.usage.turns.get(`${STUDENT}:2026-10-15`)).toBe(1);
  });

  it("NFR-14 double submit with the same clientMessageId → one student message, one tutor reply", async () => {
    const input = say(w, "Signifiers are cues.");
    await chunks(await handleTurn(w.deps, input));
    await Promise.all(w.pending);
    const again = await chunks(await handleTurn(w.deps, input));
    await Promise.all(w.pending);
    expect(again.find((p) => p.type === "start")?.messageMetadata?.replayed).toBe(true);
    const mine = w.conversations.messages.filter((m) => m.conversationId === w.conversationId);
    expect(mine.filter((m) => m.role === "student")).toHaveLength(1);
    expect(mine.filter((m) => m.role === "tutor")).toHaveLength(1);
  });

  it("PRD §4.4 concurrent submit while a reply is generating → 409 busy", async () => {
    w.respond((call) =>
      call.purpose === "tutor"
        ? { text: "Slow reply [p. 2]. What next?", delayMs: 150 }
        : defaultMockResponder(call),
    );
    const first = handleTurn(w.deps, say(w, "First answer."));
    await new Promise((r) => setTimeout(r, 20));
    const second = await handleTurn(w.deps, say(w, "Second answer."));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "busy" });
    await chunks(await first);
    await Promise.all(w.pending);
    expect(w.locks.size).toBe(0);
  });

  it("NFR-14 provider failure → tutor message failed, state unchanged; Retry succeeds", async () => {
    const before = structuredClone(w.conversations.conversations.get(w.conversationId)!.state);
    let failing = true;
    w.respond((call) =>
      call.purpose === "tutor" && failing
        ? { text: "", error: Object.assign(new Error("upstream down"), { name: "ProviderDown" }) }
        : defaultMockResponder(call),
    );
    const input = say(w, "My answer is that cues matter.");
    const failed = await chunks(await handleTurn(w.deps, input));
    await Promise.all(w.pending);
    const error = failed.find((p) => p.type === "error");
    expect(JSON.parse(error!.errorText!)).toMatchObject({ code: "reply_failed" });
    const tutor = w.conversations.messages.filter((m) => m.role === "tutor");
    expect(tutor.map((m) => m.status)).toEqual(["failed"]);
    expect(w.conversations.conversations.get(w.conversationId)!.state).toEqual(before);
    expect(w.locks.size).toBe(0);

    failing = false;
    const retried = await chunks(await handleTurn(w.deps, input));
    await Promise.all(w.pending);
    expect(retried.find((p) => p.type === "finish")?.messageMetadata?.status).toBe("complete");
    const mine = w.conversations.messages;
    expect(mine.filter((m) => m.role === "student")).toHaveLength(1);
    expect(mine.filter((m) => m.role === "tutor").map((m) => m.status)).toEqual([
      "failed",
      "complete",
    ]);
  });

  it("FR-9.2 spend ceiling → 503 chat_paused; nothing is saved", async () => {
    w.counts.spendEur = 100;
    const res = await handleTurn(w.deps, say(w, "Hello?"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "chat_paused" });
    expect(w.conversations.messages).toHaveLength(0);
  });

  it("FR-9.2 daily limit → 429 with the reset time", async () => {
    w.counts.turnsToday = 120;
    const res = await handleTurn(w.deps, say(w, "Hello?"));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      code: "daily_limit",
      retryAt: "2026-10-16T00:00:00.000Z",
    });
  });

  it("FR-9.2 per-minute limit → 429 rate_limited with Retry-After", async () => {
    w.counts.lastMinute = 8;
    const res = await handleTurn(w.deps, say(w, "Hello?"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("40");
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
  });

  it("NFR-7 someone else's conversation → 404, a closed one → 409, a retired paper → 410", async () => {
    const other = await handleTurn(w.deps, { ...say(w, "Hi"), studentId: OTHER });
    expect(other.status).toBe(404);

    w.paperOpen.value = false;
    const retired = await handleTurn(w.deps, say(w, "Hi"));
    expect(retired.status).toBe(410);
    expect(await retired.json()).toMatchObject({ code: "paper_unavailable" });

    w.paperOpen.value = true;
    w.conversations.close(w.conversationId);
    const closed = await handleTurn(w.deps, say(w, "Hi"));
    expect(closed.status).toBe(409);
  });

  it("FR-4.1 the start event opens the conversation; a second start is refused and unlocks", async () => {
    const start: TurnInput = {
      studentId: STUDENT,
      conversationId: w.conversationId,
      clientMessageId: newId(),
      event: { type: "start" },
    };
    const opened = await chunks(await handleTurn(w.deps, start));
    await Promise.all(w.pending);
    expect(opened.some((p) => p.type === "finish")).toBe(true);
    const again = await handleTurn(w.deps, { ...start, clientMessageId: newId() });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "already_started" });
    expect(w.locks.size).toBe(0);
  });
});
