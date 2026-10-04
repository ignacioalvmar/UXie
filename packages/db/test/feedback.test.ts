import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServiceClient,
  FeedbackRepo,
  SupabaseConversationRepo,
  SupabasePaperRepo,
  type Db,
} from "../src";
import { SEED_MODULE_ID, SEED_PAPER_ID, SEED_USERS, SEED_VERSION_ID } from "../scripts/seedData";

/** M7: feedback on tutor messages (FR-3.6) and Start over closing a conversation (FR-3.5). */

let db: Db;
const [, A, B] = SEED_USERS;
const created: string[] = [];

beforeAll(() => {
  db = createServiceClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SECRET_KEY!);
});

afterAll(async () => {
  for (const id of created) await db.from("conversations").delete().eq("id", id);
});

/** A conversation of `studentId` with one student message and one completed tutor reply. */
async function conversationWithReply(studentId: string) {
  const repo = new SupabaseConversationRepo(db);
  const existing = await repo.findActive(studentId, SEED_VERSION_ID);
  if (existing) await repo.close(existing.id, "closed");
  const { guide } = await new SupabasePaperRepo(db).getVersionForTutor(SEED_VERSION_ID);
  const conv = await repo.create({
    studentId,
    paperId: SEED_PAPER_ID,
    paperVersionId: SEED_VERSION_ID,
    moduleId: SEED_MODULE_ID,
    moduleTitle: "Foundations of interaction",
    guide,
  });
  created.push(conv.id);
  const student = await repo.insertStudentMessage({
    conversationId: conv.id,
    clientMessageId: crypto.randomUUID(),
    role: "student",
    event: null,
    content: "An affordance is what you can do.",
    mode: "understand",
  });
  const tutor = await repo.insertTutorMessage({
    conversationId: conv.id,
    replyTo: student.id,
    mode: "understand",
    helpLevel: "ask",
  });
  await repo.completeTutorMessage(tutor.id, {
    content: "Good start [p. 1]. What tells you how?",
    citations: [],
    provider: "mock",
    model: "mock",
    promptVersion: "test",
    generation: {},
  });
  return { conv, studentMessageId: student.id, tutorMessageId: tutor.id };
}

describe("FR-3.6 feedback on tutor messages", () => {
  it("one rating per message and student; rating again replaces it; listed per conversation", async () => {
    const repo = new FeedbackRepo(db);
    const { conv, tutorMessageId } = await conversationWithReply(A!.id);
    expect(await repo.save(A!.id, tutorMessageId, 1, null)).toBe(true);
    expect(await repo.save(A!.id, tutorMessageId, -1, "Too long")).toBe(true);
    const rows = await db
      .from("feedback")
      .select("rating, comment")
      .eq("message_id", tutorMessageId);
    expect(rows.data).toEqual([{ rating: -1, comment: "Too long" }]);
    expect((await repo.forConversation(A!.id, conv.id)).get(tutorMessageId)).toEqual({
      rating: -1,
      comment: "Too long",
    });
  });

  it("refuses other students' messages and student messages (→ 404 in the route)", async () => {
    const repo = new FeedbackRepo(db);
    const { studentMessageId, tutorMessageId } = await conversationWithReply(B!.id);
    expect(await repo.save(A!.id, tutorMessageId, 1, null)).toBe(false);
    expect(await repo.save(B!.id, studentMessageId, 1, null)).toBe(false);
    const rows = await db.from("feedback").select("id").eq("message_id", tutorMessageId);
    expect(rows.data).toEqual([]);
  });
});

describe("FR-3.5 Start over", () => {
  it("a reset conversation frees the version for a new active conversation", async () => {
    const repo = new SupabaseConversationRepo(db);
    const { conv } = await conversationWithReply(A!.id);
    await repo.close(conv.id, "reset");
    expect(await repo.findActive(A!.id, SEED_VERSION_ID)).toBeNull();
    const { conv: next } = await conversationWithReply(A!.id);
    expect((await repo.findActive(A!.id, SEED_VERSION_ID))?.id).toBe(next.id);
    expect((await repo.get(conv.id)).status).toBe("reset");
  });
});
