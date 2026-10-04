import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BaseEnvSchema, llmSettingsFromEnv, parseEnv } from "@uxie/core";
import {
  AccountsRepo,
  AlertRepo,
  createServiceClient,
  loadEffectiveSettings,
  saveSettings,
  SupabaseConversationRepo,
  SupabaseLlmCallRepo,
  SupabasePaperRepo,
  SupabaseUsageRepo,
  type Db,
} from "../src";
import { SEED_MODULE_ID, SEED_PAPER_ID, SEED_USERS, SEED_VERSION_ID } from "../scripts/seedData";

/** Repositories against the local stack (ports semantics as in packages/tutor/testing). */

let db: Db;
const [INSTRUCTOR, A] = SEED_USERS;
const created: string[] = [];
const KEY = Buffer.alloc(32, 7).toString("base64");

beforeAll(() => {
  db = createServiceClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SECRET_KEY!);
});

afterAll(async () => {
  for (const id of created) await db.from("conversations").delete().eq("id", id);
  await db.from("llm_credentials").delete().neq("provider", "");
  await db.from("llm_settings").delete().eq("id", true);
});

describe("SupabasePaperRepo", () => {
  it("loads a version for the tutor and searches pages with FTS", async () => {
    const papers = new SupabasePaperRepo(db);
    const paper = await papers.getVersionForTutor(SEED_VERSION_ID);
    expect(paper.pageCount).toBe(7);
    expect(paper.pages[0]!.n).toBe(1);
    expect(paper.guide.objectives.length).toBeGreaterThanOrEqual(3);
    const hits = await papers.searchPages(SEED_VERSION_ID, "toast feedback", 3);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("SupabaseConversationRepo", () => {
  it("NFR-14 idempotent student messages, replies, state and summary patch", async () => {
    const papers = new SupabasePaperRepo(db);
    const repo = new SupabaseConversationRepo(db);
    const { guide } = await papers.getVersionForTutor(SEED_VERSION_ID);
    const conv = await repo.create({
      studentId: A.id,
      paperId: SEED_PAPER_ID,
      paperVersionId: SEED_VERSION_ID,
      moduleId: SEED_MODULE_ID,
      moduleTitle: "Foundations",
      guide,
      isTest: true,
    });
    created.push(conv.id);
    const client = crypto.randomUUID();
    const first = await repo.insertStudentMessage({
      conversationId: conv.id,
      clientMessageId: client,
      role: "student",
      event: null,
      content: "What is an affordance?",
      mode: "understand",
    });
    const again = await repo.insertStudentMessage({
      conversationId: conv.id,
      clientMessageId: client,
      role: "student",
      event: null,
      content: "What is an affordance?",
      mode: "understand",
    });
    expect(again).toEqual({ id: first.id, existed: true });

    const { id: tutorId } = await repo.insertTutorMessage({
      conversationId: conv.id,
      replyTo: first.id,
      mode: "understand",
      helpLevel: "ask",
    });
    await repo.completeTutorMessage(tutorId, {
      content: "Good question [p. 2]. What do you think?",
      citations: [{ pageFrom: 2, pageTo: 2, raw: "[p. 2]", index: 14 }],
      provider: "mock",
      model: "m",
      promptVersion: "base@x",
      generation: { max_tokens: 10 },
    });
    const reply = await repo.findReply(first.id);
    expect(reply?.status).toBe("complete");
    expect(reply?.citations).toHaveLength(1);

    const recent = await repo.recentMessages(conv.id, 10);
    expect(recent.map((m) => m.role)).toEqual(["student", "tutor"]);
    expect(await repo.messagesAfter(conv.id, first.id)).toHaveLength(1);

    const state = { ...conv.state, attempts: 2 };
    await repo.saveState(conv.id, state, "apply");
    await repo.saveSummary(conv.id, "Summary so far.", first.id);
    const after = await repo.get(conv.id);
    expect(after.mode).toBe("apply");
    expect(after.state.attempts).toBe(2);
    expect(after.state.history_summary).toBe("Summary so far.");
    expect(after.state.summarized_through_message_id).toBe(first.id);
  });
});

describe("usage, llm calls, accounts", () => {
  it("increments daily usage atomically and sums spend in SQL", async () => {
    const usage = new SupabaseUsageRepo(db);
    const day = "2026-10-15";
    await db.from("usage_daily").delete().eq("student_id", A.id).eq("day", day);
    const counts = await Promise.all([1, 2, 3].map(() => usage.incrementTurn(A.id, day)));
    expect(counts.sort()).toEqual([1, 2, 3]);
    expect(await usage.turnsOn(A.id, day)).toBe(3);

    const calls = new SupabaseLlmCallRepo(db);
    const since = new Date();
    await calls.record({
      conversationId: null,
      purpose: "tutor",
      provider: "mock",
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      costEur: 0.0123,
      latencyMs: 1,
      ttftMs: null,
      ok: true,
      errorCode: null,
      meta: {},
    });
    expect(await calls.spendSince(since)).toBeCloseTo(0.0123, 4);
  });

  it("PRD §17.3 alerts are claimed once per kind and period; release allows a retry", async () => {
    const alerts = new AlertRepo(db);
    await alerts.release("test_alert", "2026-10");
    const claims = await Promise.all([1, 2, 3].map(() => alerts.claim("test_alert", "2026-10")));
    expect(claims.filter(Boolean)).toHaveLength(1);
    await alerts.release("test_alert", "2026-10");
    expect(await alerts.claim("test_alert", "2026-10")).toBe(true);
    await alerts.release("test_alert", "2026-10");
  });

  it("FR-1.6 sets a role by email", async () => {
    const accounts = new AccountsRepo(db);
    const res = await accounts.setRole(A.email, "instructor");
    expect(res.previous).toBe("student");
    await accounts.setRole(A.email, "student");
    expect((await accounts.getProfile(A.id)).role).toBe("student");
    expect(await accounts.allowedDomainsInDb()).toEqual(["studmail.thi.de", "thi.de"]);
  });
});

describe("FR-9.6/9.7 settings store", () => {
  it("stores only ciphertext and resolves effective settings", async () => {
    const env = llmSettingsFromEnv(parseEnv(BaseEnvSchema, { LLM_PROVIDER: "mock" }));
    const secret = "sk-ant-test-0123456789abcd";
    const { keysChanged } = await saveSettings(db, {
      current: env,
      update: {
        roles: {
          tutor: { provider: "anthropic", model: "claude-sonnet-5-5" },
          state: { provider: "anthropic", model: "claude-haiku-4-5" },
          judge: { provider: "anthropic", model: "claude-sonnet-5-5" },
        },
        credentials: { anthropic: { apiKey: secret } },
      },
      actorId: INSTRUCTOR.id,
      encryptionKey: KEY,
    });
    expect(keysChanged).toEqual(["anthropic"]);

    const raw = await db.from("llm_credentials").select("*").eq("provider", "anthropic").single();
    expect(JSON.stringify(raw.data)).not.toContain(secret);
    expect(raw.data?.key_hint).toBe("…abcd");
    const config = await db.from("llm_settings").select("config").single();
    expect(JSON.stringify(config.data)).not.toContain(secret);

    const eff = await loadEffectiveSettings(db, env, KEY);
    expect(eff.saved).toBe(true);
    expect(eff.settings.roles.tutor.provider).toBe("anthropic");
    expect(eff.settings.credentials.anthropic?.apiKey).toBe(secret);
    expect(eff.credentials.anthropic.source).toBe("stored");

    const rotated = await loadEffectiveSettings(db, env, Buffer.alloc(32, 9).toString("base64"));
    expect(rotated.credentials.anthropic.problem).toMatch(/different SETTINGS_ENCRYPTION_KEY/);
    expect(rotated.settings.credentials.anthropic?.apiKey).toBeUndefined();
  });

  it("is unreadable for the anon key even with a valid session-less client", async () => {
    const anon = createClient(
      process.env.TEST_SUPABASE_URL!,
      process.env.TEST_SUPABASE_PUBLISHABLE_KEY!,
    );
    const res = await anon.from("llm_credentials").select("*");
    expect(res.data ?? []).toHaveLength(0);
  });
});
