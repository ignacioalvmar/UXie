import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServiceClient,
  StudentViewsRepo,
  SupabaseConversationRepo,
  SupabasePaperRepo,
  SupabaseUsageRepo,
  type Db,
} from "../src";
import { SEED_MODULE_ID, SEED_PAPER_ID, SEED_USERS, SEED_VERSION_ID } from "../scripts/seedData";

/** M6: generation lock, per-minute counter and the student read models (PRD §4.4, §9.2, FR-9.2). */

let db: Db;
const [, A, B] = SEED_USERS;
const created: string[] = [];

beforeAll(() => {
  db = createServiceClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SECRET_KEY!);
});

afterAll(async () => {
  for (const id of created) await db.from("conversations").delete().eq("id", id);
});

async function newConversation(studentId: string) {
  const { guide } = await new SupabasePaperRepo(db).getVersionForTutor(SEED_VERSION_ID);
  const conv = await new SupabaseConversationRepo(db).create({
    studentId,
    paperId: SEED_PAPER_ID,
    paperVersionId: SEED_VERSION_ID,
    moduleId: SEED_MODULE_ID,
    moduleTitle: "Foundations of interaction",
    guide,
  });
  created.push(conv.id);
  return conv;
}

describe("PRD §4.4 generation lock", () => {
  it("one holder at a time; release frees it; a stale lock (> 2 min) is taken over", async () => {
    const repo = new SupabaseConversationRepo(db);
    const conv = await newConversation(B!.id);
    expect(await repo.acquireLock(conv.id)).toBe(true);
    expect(await repo.acquireLock(conv.id)).toBe(false);
    await repo.releaseLock(conv.id);
    expect(await repo.acquireLock(conv.id)).toBe(true);

    await db
      .from("conversations")
      .update({ generating_since: new Date(Date.now() - 3 * 60_000).toISOString() })
      .eq("id", conv.id);
    expect(await repo.acquireLock(conv.id)).toBe(true);
    await repo.releaseLock(conv.id);
  });

  it("concurrent acquires: exactly one wins", async () => {
    const repo = new SupabaseConversationRepo(db);
    const conv = (await repo.findActive(B!.id, SEED_VERSION_ID))!;
    const results = await Promise.all(Array.from({ length: 5 }, () => repo.acquireLock(conv.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    await repo.releaseLock(conv.id);
  });

  it("the lock functions are not callable by signed-in users", async () => {
    const anon = createClient(
      process.env.TEST_SUPABASE_URL!,
      process.env.TEST_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false },
      },
    );
    await anon.auth.signInWithPassword({ email: B!.email, password: "uxie-dev-password" });
    const conv = (await new SupabaseConversationRepo(db).findActive(B!.id, SEED_VERSION_ID))!;
    const lock = await anon.rpc("acquire_generation_lock", { p_conversation: conv.id });
    expect(lock.error).not.toBeNull();
    const turns = await anon.rpc("turns_since", {
      p_student: B!.id,
      p_since: new Date(0).toISOString(),
    });
    expect(turns.error).not.toBeNull();
  });
});

describe("FR-9.2 per-minute counter", () => {
  it("counts student messages and events since a moment, oldest first", async () => {
    const repo = new SupabaseConversationRepo(db);
    const usage = new SupabaseUsageRepo(db);
    const conv = (await repo.findActive(B!.id, SEED_VERSION_ID))!;
    const since = new Date(Date.now() - 1000);
    await repo.insertStudentMessage({
      conversationId: conv.id,
      clientMessageId: crypto.randomUUID(),
      role: "student",
      event: null,
      content: "first",
      mode: "understand",
    });
    const cmid = crypto.randomUUID();
    await repo.insertStudentMessage({
      conversationId: conv.id,
      clientMessageId: cmid,
      role: "event",
      event: "stuck",
      content: "Explain it to me",
      mode: "understand",
    });
    const window = await usage.turnsSince(B!.id, since);
    expect(window.turns).toBe(2);
    expect(window.oldest!.getTime()).toBeGreaterThanOrEqual(since.getTime());
    expect(await repo.hasClientMessage(conv.id, cmid)).toBe(true);
    expect(await repo.hasClientMessage(conv.id, crypto.randomUUID())).toBe(false);
    expect((await usage.turnsSince(A!.id, since)).turns).toBe(0);
  });
});

describe("Student read models (§9.2 rules applied in code)", () => {
  it("library rows: published modules and papers; guides reduced to student-safe parts", async () => {
    const views = new StudentViewsRepo(db);
    const modules = await views.publishedModules();
    expect(modules.map((m) => m.id)).toContain(SEED_MODULE_ID);
    const papers = await views.publishedPapers([SEED_MODULE_ID]);
    expect(papers.map((p) => p.id)).toContain(SEED_PAPER_ID);
    const guide = await views.guideSummary(SEED_VERSION_ID);
    expect(guide.starterQuestions.length).toBeGreaterThanOrEqual(2);
    const json = JSON.stringify(guide);
    expect(json).not.toContain("mastery_check");
    expect(json).not.toContain("question_ladder");
    expect(json).not.toContain("hints");
  });

  it("conversations are scoped to their owner", async () => {
    const views = new StudentViewsRepo(db);
    const conv = (await views.activeConversation(B!.id, SEED_VERSION_ID))!;
    expect(await views.ownConversation(B!.id, conv.id)).not.toBeNull();
    expect(await views.ownConversation(A!.id, conv.id)).toBeNull();
    expect((await views.conversationsOf(A!.id)).map((c) => c.id)).not.toContain(conv.id);
  });

  it("draft papers are invisible; a draft version is readable only with an own conversation", async () => {
    const views = new StudentViewsRepo(db);
    await db.from("papers").update({ status: "draft" }).eq("id", SEED_PAPER_ID);
    try {
      expect(await views.visiblePaperBySlug("visible-cues")).toBeNull();
    } finally {
      await db.from("papers").update({ status: "published" }).eq("id", SEED_PAPER_ID);
    }
    expect(await views.visiblePaperBySlug("visible-cues")).not.toBeNull();

    await db.from("paper_versions").update({ status: "superseded" }).eq("id", SEED_VERSION_ID);
    try {
      expect(await views.studentCanReadVersion(B!.id, SEED_VERSION_ID)).toBe(true); // has a conversation
      expect(await views.studentCanReadVersion(A!.id, SEED_VERSION_ID)).toBe(false);
    } finally {
      await db.from("paper_versions").update({ status: "published" }).eq("id", SEED_VERSION_ID);
    }
  });
});
