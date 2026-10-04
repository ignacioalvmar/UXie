import "server-only";
import { after } from "next/server";
import { TeachingGuideSchema, type Mode } from "@uxie/core";
import {
  AccountsRepo,
  DbError,
  StudentViewsRepo,
  SupabaseConversationRepo,
  SupabaseLlmCallRepo,
  SupabaseUsageRepo,
  type Db,
} from "@uxie/db";
import { createEngine } from "../engine";
import { serverEnv } from "../env";
import { serviceDb } from "../supabase/server";
import type { ChatDeps, ChatStore } from "./turn";

/** Supabase-backed ChatStore (secret-key client; every method is scoped by an explicit check). */
export class SupabaseChatStore implements ChatStore {
  private readonly views: StudentViewsRepo;
  private readonly conversations: SupabaseConversationRepo;
  private readonly usage: SupabaseUsageRepo;
  private readonly llmCalls: SupabaseLlmCallRepo;
  private readonly accounts: AccountsRepo;

  constructor(private readonly db: Db) {
    this.views = new StudentViewsRepo(db);
    this.conversations = new SupabaseConversationRepo(db);
    this.usage = new SupabaseUsageRepo(db);
    this.llmCalls = new SupabaseLlmCallRepo(db);
    this.accounts = new AccountsRepo(db);
  }

  async ownConversation(studentId: string, conversationId: string) {
    const c = await this.views.ownConversation(studentId, conversationId);
    return c
      ? { id: c.id, paperId: c.paperId, paperVersionId: c.paperVersionId, status: c.status }
      : null;
  }

  async paperOpenForChat(paperId: string) {
    const paper = (await this.views.papersById([paperId])).get(paperId);
    if (!paper || paper.status !== "published") return false;
    return (await this.views.visiblePaperBySlug(paper.slug)) !== null;
  }

  hasClientMessage(conversationId: string, clientMessageId: string) {
    return this.conversations.hasClientMessage(conversationId, clientMessageId);
  }
  turnsToday(studentId: string, day: string) {
    return this.usage.turnsOn(studentId, day);
  }
  turnsSince(studentId: string, since: Date) {
    return this.usage.turnsSince(studentId, since);
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
  logEvent(type: string, studentId: string, props: Record<string, unknown>) {
    return this.accounts.logEvent(type, studentId, props);
  }

  /**
   * FR-3.2: the first chat action creates the conversation on the paper's current published
   * version, or returns the student's active one there (one per version, unique index).
   */
  async openConversation(
    studentId: string,
    paperSlug: string,
    mode?: Mode,
  ): Promise<
    | { ok: true; conversationId: string; created: boolean }
    | { ok: false; status: number; code: string; message: string }
  > {
    const found = await this.views.visiblePaperBySlug(paperSlug);
    if (!found) return { ok: false, status: 404, code: "not_found", message: "Paper not found." };
    const { paper, module } = found;
    const versionId = paper.currentVersionId;
    const version = versionId ? await this.views.versionMeta(versionId) : null;
    if (paper.status !== "published" || !version || version.status !== "published")
      return {
        ok: false,
        status: 410,
        code: "paper_unavailable",
        message: "This paper is no longer available for new conversations.",
      };

    const existing = await this.conversations.findActive(studentId, version.id);
    if (existing) return { ok: true, conversationId: existing.id, created: false };

    const raw = await this.db
      .from("teaching_guides")
      .select("guide")
      .eq("version_id", version.id)
      .maybeSingle();
    const guide = TeachingGuideSchema.safeParse((raw.data as { guide: unknown } | null)?.guide);
    if (!guide.success)
      return {
        ok: false,
        status: 410,
        code: "paper_unavailable",
        message: "This paper is not ready for conversations yet.",
      };
    try {
      const conv = await this.conversations.create({
        studentId,
        paperId: paper.id,
        paperVersionId: version.id,
        moduleId: module.id,
        moduleTitle: module.title,
        guide: guide.data,
        mode,
      });
      void this.accounts
        .logEvent("conversation_started", studentId, {
          conversation_id: conv.id,
          paper_id: paper.id,
        })
        .catch(() => {});
      return { ok: true, conversationId: conv.id, created: true };
    } catch (e) {
      // Two tabs raced: the unique index kept one active conversation; use it.
      if (e instanceof DbError && e.code === "23505") {
        const winner = await this.conversations.findActive(studentId, version.id);
        if (winner) return { ok: true, conversationId: winner.id, created: false };
      }
      throw e;
    }
  }
}

export function chatStore() {
  return new SupabaseChatStore(serviceDb());
}

/** Production wiring of the chat turn (limits from env, FR-9.2; D7 defaults €100 / 120 turns). */
export function chatDeps(store: ChatStore = chatStore()): ChatDeps {
  const env = serverEnv();
  return {
    store,
    engine: createEngine,
    limits: {
      dailyLimit: env.DAILY_TURN_LIMIT,
      perMinuteLimit: env.PER_MINUTE_TURN_LIMIT,
      ceilingEur: env.MONTHLY_SPEND_CEILING_EUR,
    },
    after: (task) => after(task),
    onError: (e, context) => {
      // Codes and ids only; never message content (NFR-4).
      console.error(
        JSON.stringify({
          msg: "chat_error",
          ...context,
          error: e instanceof Error ? e.name : "unknown",
        }),
      );
    },
  };
}
