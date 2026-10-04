import "server-only";
import { after } from "next/server";
import { formatEur, Mode as ModeSchema, TeachingGuideSchema, type Mode } from "@uxie/core";
import {
  AccountsRepo,
  AlertRepo,
  DbError,
  StudentViewsRepo,
  SupabaseConversationRepo,
  SupabaseLlmCallRepo,
  SupabaseUsageRepo,
  type Db,
} from "@uxie/db";
import { createEngine } from "../engine";
import { serverEnv } from "../env";
import { sendMail } from "../mail";
import { serviceDb } from "../supabase/server";
import type { ChatDeps, ChatStore, OpenResult } from "./turn";

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
      ? {
          id: c.id,
          paperId: c.paperId,
          paperVersionId: c.paperVersionId,
          mode: c.mode,
          status: c.status,
        }
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
  closeConversation(conversationId: string, status: "reset") {
    return this.conversations.close(conversationId, status);
  }

  async openConversationForPaper(studentId: string, paperId: string, mode: Mode) {
    const paper = (await this.views.papersById([paperId])).get(paperId);
    if (!paper)
      return { ok: false as const, status: 404, code: "not_found", message: "Paper not found." };
    return this.openConversation(studentId, paper.slug, mode);
  }

  /**
   * FR-3.2: the first chat action creates the conversation on the paper's current published
   * version, or returns the student's active one there (one per version, unique index).
   */
  async openConversation(studentId: string, paperSlug: string, mode?: Mode): Promise<OpenResult> {
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

/** TUTOR_MODES in display order (Understand, Apply, Critique, Build). */
export function enabledModes(): Mode[] {
  const enabled = serverEnv().TUTOR_MODES;
  return ModeSchema.options.filter((m) => enabled.includes(m));
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
    modes: enabledModes(),
    after: (task) => after(task),
    ...(env.ALERT_EMAIL ? { onSpendAlert: sendSpendAlert } : {}),
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

/**
 * PRD §17.3: email ALERT_EMAIL once per month when spend reaches 80 % of the ceiling. A failed or
 * unconfigured send releases the claim, so a later turn tries again.
 */
async function sendSpendAlert(a: { month: string; spendEur: number; ceilingEur: number }) {
  const env = serverEnv();
  if (!env.ALERT_EMAIL) return;
  const alerts = new AlertRepo(serviceDb());
  if (!(await alerts.claim("spend_80", a.month))) return;
  const outcome = await sendMail({
    to: env.ALERT_EMAIL,
    subject: `UXie: ${Math.floor((a.spendEur / a.ceilingEur) * 100)} % of the monthly spend ceiling used`,
    text: [
      `Model spend for ${a.month} is ${formatEur(a.spendEur)} of the ${formatEur(a.ceilingEur)} ceiling.`,
      "New tutor replies stop for everyone when the ceiling is reached.",
      "",
      `Usage and costs: ${new URL("/admin/usage", env.APP_URL).toString()}`,
      "To raise the ceiling, change MONTHLY_SPEND_CEILING_EUR in Vercel and redeploy.",
    ].join("\n"),
  });
  if (outcome !== "sent") await alerts.release("spend_80", a.month);
}
