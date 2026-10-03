import {
  initialState,
  LearnerStateSchema,
  type Citation,
  type LearnerState,
  type Mode,
  type TeachingGuide,
} from "@uxie/core";
import { must, NotFoundError, type Db } from "../client";

/**
 * ConversationRepo port on Supabase (packages/tutor/ports.ts), matched structurally because
 * packages/db may not import packages/tutor (PRD §4.3). apps/web wires and type-checks it.
 */

type Role = "student" | "tutor" | "event";
type Status = "complete" | "streaming" | "failed";
type StudentEvent = "start" | "stuck" | "mode_switch";

export interface DbConversation {
  id: string;
  studentId: string;
  paperVersionId: string;
  mode: Mode;
  state: LearnerState;
  status: "active" | "reset" | "closed";
  isTest: boolean;
}

export interface DbMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  status: Status;
  event: StudentEvent | null;
  mode: Mode | null;
  helpLevel: string | null;
  clientMessageId: string | null;
  replyTo: string | null;
  citations: Citation[];
  createdAt: Date;
}

interface ConversationRow {
  id: string;
  student_id: string;
  paper_version_id: string;
  mode: Mode;
  state: unknown;
  status: DbConversation["status"];
  is_test: boolean;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  status: Status;
  event: string | null;
  mode: Mode | null;
  help_level: string | null;
  client_message_id: string | null;
  reply_to: string | null;
  citations: Citation[];
  created_at: string;
}

const MESSAGE_COLUMNS =
  "id, conversation_id, role, content, status, event, mode, help_level, client_message_id, reply_to, citations, created_at";

const toConversation = (r: ConversationRow): DbConversation => ({
  id: r.id,
  studentId: r.student_id,
  paperVersionId: r.paper_version_id,
  mode: r.mode,
  state: LearnerStateSchema.parse(r.state),
  status: r.status,
  isTest: r.is_test,
});

const toMessage = (r: MessageRow): DbMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  status: r.status,
  event: (r.event as StudentEvent | null) ?? null,
  mode: r.mode,
  helpLevel: r.help_level,
  clientMessageId: r.client_message_id,
  replyTo: r.reply_to,
  citations: r.citations ?? [],
  createdAt: new Date(r.created_at),
});

export class SupabaseConversationRepo {
  constructor(private readonly db: Db) {}

  /** Not part of the port: used by the web adapter (M6) and tests. */
  async create(input: {
    studentId: string;
    paperId: string;
    paperVersionId: string;
    moduleId: string;
    moduleTitle: string;
    guide: TeachingGuide;
    mode?: Mode;
    isTest?: boolean;
    channel?: "web" | "cli" | "discord" | "eval";
  }): Promise<DbConversation> {
    const mode = input.mode ?? "understand";
    const row = must(
      await this.db
        .from("conversations")
        .insert({
          student_id: input.studentId,
          paper_id: input.paperId,
          paper_version_id: input.paperVersionId,
          module_id_at_start: input.moduleId,
          module_title_at_start: input.moduleTitle,
          mode,
          state: initialState(input.guide, mode),
          is_test: input.isTest ?? false,
          channel: input.channel ?? "web",
        })
        .select("id, student_id, paper_version_id, mode, state, status, is_test")
        .single(),
      "create conversation",
    ) as ConversationRow;
    return toConversation(row);
  }

  async get(conversationId: string): Promise<DbConversation> {
    const row = must(
      await this.db
        .from("conversations")
        .select("id, student_id, paper_version_id, mode, state, status, is_test")
        .eq("id", conversationId)
        .maybeSingle(),
      `conversation ${conversationId}`,
    ) as ConversationRow;
    return toConversation(row);
  }

  async recentMessages(conversationId: string, limit: number): Promise<DbMessage[]> {
    const rows = must(
      await this.db
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(limit),
      "recent messages",
    ) as MessageRow[];
    return rows.reverse().map(toMessage);
  }

  async messagesAfter(conversationId: string, afterMessageId: string | null): Promise<DbMessage[]> {
    let query = this.db
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .order("created_at");
    if (afterMessageId) {
      const anchor = must(
        await this.db.from("messages").select("created_at").eq("id", afterMessageId).maybeSingle(),
        `message ${afterMessageId}`,
      ) as { created_at: string };
      query = query.gt("created_at", anchor.created_at);
    }
    return (must(await query, "messages after") as MessageRow[]).map(toMessage);
  }

  /** Idempotent on (conversation_id, client_message_id) (NFR-14). */
  async insertStudentMessage(m: {
    conversationId: string;
    clientMessageId: string;
    role: "student" | "event";
    event: StudentEvent | null;
    content: string;
    mode: Mode;
  }): Promise<{ id: string; existed: boolean }> {
    const inserted = await this.db
      .from("messages")
      .upsert(
        {
          conversation_id: m.conversationId,
          client_message_id: m.clientMessageId,
          role: m.role,
          event: m.event,
          content: m.content,
          mode: m.mode,
        },
        { onConflict: "conversation_id,client_message_id", ignoreDuplicates: true },
      )
      .select("id");
    const rows = must(inserted, "insert student message") as { id: string }[];
    if (rows[0]) {
      await this.touch(m.conversationId);
      return { id: rows[0].id, existed: false };
    }
    const existing = must(
      await this.db
        .from("messages")
        .select("id")
        .eq("conversation_id", m.conversationId)
        .eq("client_message_id", m.clientMessageId)
        .maybeSingle(),
      "existing student message",
    ) as { id: string };
    return { id: existing.id, existed: true };
  }

  async findReply(studentMessageId: string): Promise<DbMessage | null> {
    const rows = must(
      await this.db
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("reply_to", studentMessageId)
        .order("created_at", { ascending: false })
        .limit(1),
      "find reply",
    ) as MessageRow[];
    return rows[0] ? toMessage(rows[0]) : null;
  }

  async insertTutorMessage(m: {
    conversationId: string;
    replyTo: string;
    mode: Mode;
    helpLevel: string;
  }): Promise<{ id: string }> {
    return must(
      await this.db
        .from("messages")
        .insert({
          conversation_id: m.conversationId,
          reply_to: m.replyTo,
          role: "tutor",
          content: "",
          status: "streaming",
          mode: m.mode,
          help_level: m.helpLevel,
        })
        .select("id")
        .single(),
      "insert tutor message",
    ) as { id: string };
  }

  async completeTutorMessage(
    id: string,
    patch: {
      content: string;
      citations: Citation[];
      provider: string;
      model: string;
      promptVersion: string;
      generation: object;
    },
  ): Promise<void> {
    const row = must(
      await this.db
        .from("messages")
        .update({
          content: patch.content,
          citations: patch.citations,
          status: "complete",
          provider: patch.provider,
          model: patch.model,
          prompt_version: patch.promptVersion,
          generation: patch.generation,
        })
        .eq("id", id)
        .select("conversation_id")
        .maybeSingle(),
      `message ${id}`,
    ) as { conversation_id: string };
    await this.touch(row.conversation_id);
  }

  async failTutorMessage(id: string, errorCode: string): Promise<void> {
    must(
      await this.db
        .from("messages")
        .update({ status: "failed", error_code: errorCode })
        .eq("id", id)
        .select("id")
        .maybeSingle(),
      `message ${id}`,
    );
  }

  async saveState(conversationId: string, state: LearnerState, mode: Mode): Promise<void> {
    const res = await this.db
      .from("conversations")
      .update({ state, mode, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .select("id");
    if (!(must(res, `conversation ${conversationId}`) as unknown[]).length)
      throw new NotFoundError(`Conversation ${conversationId}`);
  }

  async saveSummary(conversationId: string, summary: string, throughMessageId: string) {
    must(
      {
        ...(await this.db.rpc("save_conversation_summary", {
          p_conversation: conversationId,
          p_summary: summary,
          p_through: throughMessageId,
        })),
        data: true,
      },
      "save summary",
    );
  }

  /** Not part of the port: Start over (FR-3.5) and closing. */
  async close(conversationId: string, status: "reset" | "closed" = "reset"): Promise<void> {
    must(
      await this.db
        .from("conversations")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .select("id")
        .maybeSingle(),
      `conversation ${conversationId}`,
    );
  }

  private async touch(conversationId: string) {
    await this.db
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversationId);
  }
}
