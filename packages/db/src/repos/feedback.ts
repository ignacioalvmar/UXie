import { DbError, must, type Db } from "../client";

/** 👍 = 1, 👎 = -1 (`feedback.rating`). */
export type FeedbackRating = 1 | -1;

export interface FeedbackRow {
  rating: FeedbackRating;
  comment: string | null;
}

/**
 * Feedback on tutor messages (FR-3.6). One row per (message, student); rating again replaces it.
 * Secret-key client: every method checks that the message is a completed tutor message in the
 * student's own, non-test conversation.
 */
export class FeedbackRepo {
  constructor(private readonly db: Db) {}

  /** False when the message is not a complete tutor message of the student's (→ 404). */
  async save(
    studentId: string,
    messageId: string,
    rating: FeedbackRating,
    comment: string | null,
  ): Promise<boolean> {
    const res = await this.db
      .from("messages")
      .select("id, conversations!inner(student_id, is_test)")
      .eq("id", messageId)
      .eq("role", "tutor")
      .eq("status", "complete")
      .eq("conversations.student_id", studentId)
      .eq("conversations.is_test", false)
      .maybeSingle();
    if (res.error) throw new DbError(`feedback target: ${res.error.message}`, res.error.code);
    if (!res.data) return false;
    must(
      await this.db
        .from("feedback")
        .upsert(
          { message_id: messageId, student_id: studentId, rating, comment },
          { onConflict: "message_id,student_id" },
        )
        .select("id")
        .single(),
      "save feedback",
    );
    return true;
  }

  /** The student's feedback on the messages of one conversation, by message id. */
  async forConversation(studentId: string, conversationId: string) {
    const rows = must(
      await this.db
        .from("feedback")
        .select("message_id, rating, comment, messages!inner(conversation_id)")
        .eq("student_id", studentId)
        .eq("messages.conversation_id", conversationId),
      "conversation feedback",
    ) as { message_id: string; rating: FeedbackRating; comment: string | null }[];
    return new Map<string, FeedbackRow>(
      rows.map((r) => [r.message_id, { rating: r.rating, comment: r.comment }]),
    );
  }
}
