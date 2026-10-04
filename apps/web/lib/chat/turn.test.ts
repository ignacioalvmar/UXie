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
import { handleReset, handleTurn, type ChatDeps, type ChatStore, type TurnInput } from "./turn";
import type { TutorMeta } from "./types";
import { handleTestChat, type TestChatStore } from "../admin/testChatTurn";

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
  profiles: InMemoryProfileRepo;
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
  const profiles = new InMemoryProfileRepo();
  const conv = conversations.create({
    studentId: STUDENT,
    paperVersionId: VERSION,
    guide: fixture.guide,
  });
  const engine = new TutorEngine({
    llm,
    papers,
    conversations,
    profiles,
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
        ? {
            id: c.id,
            paperId: "paper-1",
            paperVersionId: c.paperVersionId,
            mode: c.mode,
            status: c.status,
          }
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
    closeConversation: async (id, status) => conversations.close(id, status),
    async openConversationForPaper(studentId, _paperId, mode) {
      const active = [...conversations.conversations.values()].find(
        (c) => c.studentId === studentId && c.status === "active",
      );
      if (active) return { ok: true, conversationId: active.id, created: false };
      const created = conversations.create({
        studentId,
        paperVersionId: VERSION,
        guide: fixture.guide,
        mode,
      });
      return { ok: true, conversationId: created.id, created: true };
    },
  };
  const pending: Promise<unknown>[] = [];
  return {
    deps: {
      store,
      engine: async () => engine,
      limits: { dailyLimit: 120, perMinuteLimit: 8, ceilingEur: 100 },
      modes: ["understand", "apply"],
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
    profiles,
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

const stuck = (w: World, clientMessageId = newId()): TurnInput => ({
  studentId: STUDENT,
  conversationId: w.conversationId,
  clientMessageId,
  event: { type: "stuck" },
});

const switchTo = (w: World, mode: "understand" | "apply" | "critique", clientMessageId = newId()) =>
  ({
    studentId: STUDENT,
    conversationId: w.conversationId,
    clientMessageId,
    event: { type: "mode_switch", mode },
  }) satisfies TurnInput;

/** Runs one turn to completion (including the after-work) and returns its stream parts. */
async function turn(w: World, input: TurnInput) {
  const parts = await chunks(await handleTurn(w.deps, input));
  await Promise.all(w.pending);
  return parts;
}

const finishMeta = (parts: Chunk[]) => parts.find((p) => p.type === "finish")?.messageMetadata;

/** Records the system prompt of every tutor reply (the dynamic part carries mode and project). */
function recordTutorPrompts(w: World, assessment?: (studentText: string) => object | null) {
  const systems: string[] = [];
  w.respond((call) => {
    if (call.purpose === "tutor") systems.push(call.system);
    if (call.purpose === "assessment" && assessment) {
      const value = assessment(call.messages.at(-1)?.content ?? "");
      if (value) return JSON.stringify(value);
    }
    return defaultMockResponder(call);
  });
  return systems;
}

describe("M7 tutor features (mock LLM, real engine)", () => {
  it("PRD §3.3 FR-3.5 Explain it to me ×3 → hint, hint, explain; the next turn is check (help levels on messages)", async () => {
    for (let i = 0; i < 3; i++) await turn(w, stuck(w));
    const after = await turn(w, say(w, "So a signifier is the visible cue."));
    expect(finishMeta(after)?.status).toBe("complete");

    const mine = w.conversations.messages.filter((m) => m.conversationId === w.conversationId);
    expect(mine.filter((m) => m.role === "event").map((m) => m.event)).toEqual([
      "stuck",
      "stuck",
      "stuck",
    ]);
    expect(mine.filter((m) => m.role === "tutor").map((m) => m.helpLevel)).toEqual([
      "hint:0",
      "hint:1",
      "explain",
      "check",
    ]);
    // `check` resets the counters (PRD §8.2).
    const state = w.conversations.conversations.get(w.conversationId)!.state;
    expect(state).toMatchObject({ attempts: 0, stuck_requests: 0 });
  });

  it("J3 FR-1.5 Apply mode without a project asks for one; a saved project is in later prompts", async () => {
    const systems = recordTutorPrompts(w);
    const switched = await turn(w, switchTo(w, "apply"));
    expect(finishMeta(switched)?.mode).toBe("apply");
    expect(systems[0]).toContain("Student project: UNKNOWN");
    expect(w.conversations.conversations.get(w.conversationId)!.mode).toBe("apply");

    // "Save to my profile" (PATCH /api/me) stores it; the engine reads it on every Apply turn.
    w.profiles.projects.set(STUDENT, "A plant-watering app for students in shared flats.");
    await turn(w, say(w, "My project: A plant-watering app for students in shared flats."));
    await turn(w, say(w, "I would add a watering-can icon to the plant card."));
    expect(systems[1]).toContain(
      "Student project: A plant-watering app for students in shared flats.",
    );
    expect(systems[2]).toContain("Student project: A plant-watering app");
    expect(systems[2]).not.toContain("UNKNOWN");
  });

  it("M7 mastery check met → Progress shows U1 Demonstrated with evidence; the tutor moves on to U2", async () => {
    const evidence = "Said the door handle affords pulling while the PULL sign signifies it.";
    const systems = recordTutorPrompts(w, (text) =>
      text.includes("handle")
        ? {
            intent: "answer",
            answer_quality: "correct",
            objective_updates: [{ objective_id: "U1", status: "demonstrated", evidence }],
            misconception: null,
            misconception_resolved: null,
            language: "en",
          }
        : null,
    );
    await turn(w, say(w, "An affordance is what you can do?"));
    const met = await turn(
      w,
      say(w, "The handle affords pulling; the PULL sign is the signifier that tells you."),
    );
    const meta = finishMeta(met)!;
    const u1 = meta.progress!.find((p) => p.id === "U1")!;
    expect(u1).toMatchObject({ status: "demonstrated", evidence, active: false });
    expect(meta.progress!.find((p) => p.active)?.id).toBe("U2");
    expect(meta.demonstrated).toEqual([u1.statement]);

    // The reply to this turn and the next both work on U2.
    expect(systems[1]).toContain("Current objective: U2");
    await turn(w, say(w, "Feedback shows what happened?"));
    expect(systems[2]).toContain("Current objective: U2");
    expect(systems[2]).toMatch(/U1 \(understanding\): .*\[demonstrated\]/);
  });

  it("FR-4.7 mode switch: unavailable mode → 400, same mode → 409, a retried switch replays", async () => {
    const p1 = await handleTurn(w.deps, switchTo(w, "critique"));
    expect(p1.status).toBe(400);
    const same = await handleTurn(w.deps, switchTo(w, "understand"));
    expect(same.status).toBe(409);
    expect(await same.json()).toMatchObject({ code: "same_mode" });

    const input = switchTo(w, "apply");
    await turn(w, input);
    const again = await turn(w, input);
    expect(again.find((p) => p.type === "start")?.messageMetadata?.replayed).toBe(true);
    expect(w.conversations.messages.filter((m) => m.event === "mode_switch")).toHaveLength(1);
    expect(w.locks.size).toBe(0);
  });
});

describe("FR-3.5 Start over", () => {
  it("closes the conversation as `reset` and opens a fresh one in the same mode", async () => {
    await turn(w, switchTo(w, "apply"));
    await turn(w, say(w, "A first answer."));
    const res = await handleReset(w.deps, { studentId: STUDENT, conversationId: w.conversationId });
    expect(res.status).toBe(200);
    const { newConversationId } = (await res.json()) as { newConversationId: string };
    expect(newConversationId).not.toBe(w.conversationId);

    const old = w.conversations.conversations.get(w.conversationId)!;
    expect(old.status).toBe("reset");
    expect(w.conversations.messages.some((m) => m.conversationId === w.conversationId)).toBe(true);
    const fresh = w.conversations.conversations.get(newConversationId)!;
    expect(fresh).toMatchObject({ status: "active", mode: "apply" });
    expect(Object.values(fresh.state.objectives).every((s) => s === "not_started")).toBe(true);
    expect(w.locks.size).toBe(0);

    // The old conversation takes no new turns; the new one opens with the start event.
    expect((await handleTurn(w.deps, say(w, "Hello again"))).status).toBe(409);
    const opened = await turn(w, {
      studentId: STUDENT,
      conversationId: newConversationId,
      clientMessageId: newId(),
      event: { type: "start" },
    });
    expect(finishMeta(opened)?.status).toBe("complete");
  });

  it("refuses while a reply is generating (409), for others' conversations (404) and twice (409)", async () => {
    w.locks.add(w.conversationId);
    const busy = await handleReset(w.deps, {
      studentId: STUDENT,
      conversationId: w.conversationId,
    });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: "busy" });
    expect(w.conversations.conversations.get(w.conversationId)!.status).toBe("active");
    w.locks.clear();

    const other = await handleReset(w.deps, { studentId: OTHER, conversationId: w.conversationId });
    expect(other.status).toBe(404);

    expect(
      (await handleReset(w.deps, { studentId: STUDENT, conversationId: w.conversationId })).status,
    ).toBe(200);
    const twice = await handleReset(w.deps, {
      studentId: STUDENT,
      conversationId: w.conversationId,
    });
    expect(twice.status).toBe(409);
  });

  it("a retired paper cannot be started over (410) and the conversation stays active", async () => {
    w.paperOpen.value = false;
    const res = await handleReset(w.deps, { studentId: STUDENT, conversationId: w.conversationId });
    expect(res.status).toBe(410);
    expect(w.conversations.conversations.get(w.conversationId)!.status).toBe("active");
  });
});

describe("FR-6.5 Test as student (debug panel)", () => {
  const INSTRUCTOR = "00000000-0000-4000-8000-0000000000d4";
  const testStore = (guideValid = true): TestChatStore => ({
    ...w.deps.store,
    async ownConversation(studentId, id) {
      const c = w.conversations.conversations.get(id);
      return c && c.studentId === studentId
        ? {
            id: c.id,
            paperId: "paper-1",
            paperVersionId: c.paperVersionId,
            mode: c.mode,
            status: c.status,
          }
        : null;
    },
    async openTestConversation(instructorId, versionId, mode) {
      if (!guideValid)
        return { ok: false, status: 409, code: "guide_invalid", message: "Fix the guide first." };
      for (const c of w.conversations.conversations.values())
        if (c.studentId === instructorId && c.status === "active")
          w.conversations.close(c.id, "reset");
      const c = w.conversations.create({
        studentId: instructorId,
        paperVersionId: versionId,
        guide: fixture.guide,
        mode,
      });
      return { ok: true, conversationId: c.id, created: true };
    },
  });

  it("a new test chat greets; finish metadata carries assessment, help level, state diff, prompt version and tokens", async () => {
    const store = testStore();
    const deps = { ...w.deps, debug: true };
    const opened = await chunks(
      await handleTestChat(store, deps, {
        instructorId: INSTRUCTOR,
        versionId: VERSION,
        clientMessageId: newId(),
      }),
    );
    await Promise.all(w.pending);
    const conversationId = opened.find((p) => p.type === "start")!.messageMetadata!.conversationId!;
    expect(conversationId).not.toBe(w.conversationId);

    const reply = await chunks(
      await handleTestChat(store, deps, {
        instructorId: INSTRUCTOR,
        versionId: VERSION,
        conversationId,
        clientMessageId: newId(),
        text: "Signifiers are cues that show where to act.",
      }),
    );
    await Promise.all(w.pending);
    const debug = reply.find((p) => p.type === "finish")!.messageMetadata!.debug!;
    expect(debug.help).toMatch(/^(ask|hint:[0-9]|explain|check)$/);
    expect(debug.assessment).toMatchObject({ intent: "answer" });
    expect(debug.promptVersion).toMatch(/^base@[0-9a-f]{12}[+]understand@/);
    expect(debug.tokens).toMatchObject({
      input: expect.any(Number),
      cachedInput: expect.any(Number),
    });
    expect(debug.stateChanges.map((c) => c.path)).toContain("attempts");
    expect(debug.provider).toBe("mock");
  });

  it("student routes never carry the debug panel", async () => {
    const parts = await chunks(await handleTurn(w.deps, say(w, "An answer.")));
    await Promise.all(w.pending);
    expect(parts.find((p) => p.type === "finish")!.messageMetadata).not.toHaveProperty("debug");
  });

  it("refuses an invalid guide (409), others' test chats (404) and another version's (404)", async () => {
    const bad = await handleTestChat(
      testStore(false),
      { ...w.deps, debug: true },
      {
        instructorId: INSTRUCTOR,
        versionId: VERSION,
        clientMessageId: newId(),
      },
    );
    expect(bad.status).toBe(409);
    expect(await bad.json()).toMatchObject({ code: "guide_invalid" });

    const theirs = await handleTestChat(testStore(), w.deps, {
      instructorId: INSTRUCTOR,
      versionId: VERSION,
      conversationId: w.conversationId,
      clientMessageId: newId(),
      text: "hi",
    });
    expect(theirs.status).toBe(404);
    const otherVersion = await handleTestChat(testStore(), w.deps, {
      instructorId: STUDENT,
      versionId: "00000000-0000-4000-8000-0000000000ff",
      conversationId: w.conversationId,
      clientMessageId: newId(),
      text: "hi",
    });
    expect(otherVersion.status).toBe(404);
  });
});
