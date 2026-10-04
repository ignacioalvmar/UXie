import "server-only";
import { after } from "next/server";
import { Mode as ModeSchema, validateGuide, type Mode } from "@uxie/core";
import {
  AdminRepo,
  StudentViewsRepo,
  SupabaseConversationRepo,
  SupabaseLlmCallRepo,
  SupabaseUsageRepo,
  type Db,
} from "@uxie/db";
import { createEngine } from "../engine";
import { serverEnv } from "../env";
import { serviceDb } from "../supabase/server";
import type { ChatConversation, ChatDeps, ChatStore, OpenResult } from "../chat/turn";

/**
 * "Test as student" (FR-6.5): a sandbox conversation (`is_test = true`) owned by the instructor,
 * allowed on unpublished versions, excluded from reports and exports. It runs through the same
 * turn adapter as student chats, with the debug panel on.
 */
export class TestChatStore implements ChatStore {
  private readonly admin: AdminRepo;
  private readonly views: StudentViewsRepo;
  private readonly conversations: SupabaseConversationRepo;
  private readonly usage: SupabaseUsageRepo;
  private readonly llmCalls: SupabaseLlmCallRepo;

  constructor(db: Db) {
    this.admin = new AdminRepo(db);
    this.views = new StudentViewsRepo(db);
    this.conversations = new SupabaseConversationRepo(db);
    this.usage = new SupabaseUsageRepo(db);
    this.llmCalls = new SupabaseLlmCallRepo(db);
  }

  async ownConversation(
    instructorId: string,
    conversationId: string,
  ): Promise<ChatConversation | null> {
    const c = await this.admin.ownTestConversation(instructorId, conversationId);
    return c
      ? {
          id: c.id,
          paperId: c.paper_id,
          paperVersionId: c.paper_version_id,
          mode: ModeSchema.parse(c.mode),
          status: c.status,
        }
      : null;
  }

  /** Instructors may test any version, published or not. */
  async paperOpenForChat(): Promise<boolean> {
    return true;
  }

  async openConversationForPaper(): Promise<OpenResult> {
    return { ok: false, status: 400, code: "invalid_input", message: "Use “New test chat”." };
  }

  /**
   * A new test conversation on the version with its current guide; the instructor's earlier
   * test chats there are closed. Refused while the guide does not validate.
   */
  async openTestConversation(
    instructorId: string,
    versionId: string,
    mode: Mode,
  ): Promise<OpenResult> {
    const version = await this.admin.version(versionId);
    if (!version)
      return { ok: false, status: 404, code: "not_found", message: "Version not found." };
    const [paper, guide] = await Promise.all([
      this.admin.paper(version.paperId),
      this.admin.guide(versionId),
    ]);
    const checked = validateGuide(guide?.guide, version.pageCount ?? undefined);
    if (!paper || !checked.ok || !version.pageCount)
      return {
        ok: false,
        status: 409,
        code: "guide_invalid",
        message: "Fix the teaching guide first: test chats need a guide that validates.",
      };
    const module = (await this.admin.modules()).find((m) => m.id === paper.moduleId);
    await this.admin.closeTestConversations(versionId, instructorId);
    const conv = await this.conversations.create({
      studentId: instructorId,
      paperId: paper.id,
      paperVersionId: versionId,
      moduleId: paper.moduleId,
      moduleTitle: module?.title ?? "",
      guide: checked.guide,
      mode,
      isTest: true,
    });
    return { ok: true, conversationId: conv.id, created: true };
  }

  hasClientMessage(conversationId: string, clientMessageId: string) {
    return this.conversations.hasClientMessage(conversationId, clientMessageId);
  }
  turnsToday(studentId: string, day: string) {
    return this.usage.turnsOn(studentId, day);
  }
  turnsSince() {
    return Promise.resolve({ turns: 0, oldest: null });
  }
  spendSince(since: Date) {
    return this.llmCalls.spendSince(since);
  }
  acquireLock(conversationId: string) {
    return this.conversations.acquireLock(conversationId);
  }
  releaseLock(conversationId: string) {
    return this.conversations.releaseLock(conversationId);
  }
  guide(versionId: string) {
    return this.views.guideSummary(versionId);
  }
  /** Test chats stay out of student analytics (NFR-19 events are for real use). */
  logEvent() {
    return Promise.resolve();
  }
  closeConversation(conversationId: string, status: "reset") {
    return this.conversations.close(conversationId, status);
  }

  /** The instructor's open test chat on a version, for resuming the panel. */
  async activeTestConversation(instructorId: string, versionId: string) {
    return this.conversations.findActive(instructorId, versionId, { isTest: true });
  }
}

export function testChatStore() {
  return new TestChatStore(serviceDb());
}

/** Test chats: every focus mode (P1 modes can be tried before TUTOR_MODES offers them), no turn
 * limits, but the monthly spend ceiling still applies (FR-9.2). */
export function testChatDeps(store: ChatStore): ChatDeps {
  return {
    store,
    engine: createEngine,
    limits: {
      dailyLimit: Number.MAX_SAFE_INTEGER,
      perMinuteLimit: Number.MAX_SAFE_INTEGER,
      ceilingEur: serverEnv().MONTHLY_SPEND_CEILING_EUR,
    },
    modes: ModeSchema.options,
    debug: true,
    after: (task) => after(task),
    onError: (e, context) => {
      console.error(
        JSON.stringify({
          msg: "test_chat_error",
          ...context,
          error: e instanceof Error ? e.name : "unknown",
        }),
      );
    },
  };
}
