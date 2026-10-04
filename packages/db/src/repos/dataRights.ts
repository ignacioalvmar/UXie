import { DbError, must, type Db } from "../client";
import { fetchAll } from "./review";

/**
 * Data rights and lifecycle (PRD §10.8, FR-8.1–8.4; ADR-028). Secret-key client: student
 * methods take the signed-in user's id from the session, admin methods are called after the
 * instructor check.
 */

export type RequestType = "access" | "deletion";
export type RequestStatus = "open" | "in_progress" | "completed" | "rejected";

export interface DataRequest {
  id: string;
  /** Null once the account is deleted (FR-8.3); the pseudonym stays. */
  studentId: string | null;
  pseudonymId: string;
  type: RequestType;
  status: RequestStatus;
  notes: string | null;
  createdAt: string;
  dueAt: string;
  completedAt: string | null;
}

interface RequestRow {
  id: string;
  student_id: string | null;
  pseudonym_id: string;
  type: RequestType;
  status: RequestStatus;
  notes: string | null;
  created_at: string;
  due_at: string;
  completed_at: string | null;
}

const REQUEST_COLUMNS =
  "id, student_id, pseudonym_id, type, status, notes, created_at, due_at, completed_at";

const toRequest = (r: RequestRow): DataRequest => ({
  id: r.id,
  studentId: r.student_id,
  pseudonymId: r.pseudonym_id,
  type: r.type,
  status: r.status,
  notes: r.notes,
  createdAt: r.created_at,
  dueAt: r.due_at,
  completedAt: r.completed_at,
});

export const isOpenRequest = (r: Pick<DataRequest, "status">) =>
  r.status === "open" || r.status === "in_progress";

/** Open requests past their due date are highlighted on the dashboard (FR-8.2). */
export const isOverdue = (r: Pick<DataRequest, "status" | "dueAt">, now = new Date()) =>
  isOpenRequest(r) && new Date(r.dueAt).getTime() < now.getTime();

export type CompleteDeletionResult =
  | "ok"
  | "not_found"
  | "not_a_deletion"
  | "already_closed"
  | "student_missing"
  | "instructor_account";

export interface PurgeCounts {
  conversations: number;
  messages: number;
  feedback: number;
  students: number;
}

/** "Download my data" (FR-8.1). Includes the email: it is the student's own data. */
export interface PersonalDataExport {
  exportedAt: string;
  format: "uxie-personal-data/1";
  profile: Record<string, unknown> & { email: string };
  conversations: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  feedback: Record<string, unknown>[];
  dataRequests: DataRequest[];
}

export class DataRightsRepo {
  constructor(private readonly db: Db) {}

  // ── Student side ─────────────────────────────────────────────────

  /** FR-8.1: everything stored about the student; logged as a completed `access` request. */
  async exportPersonalData(
    userId: string,
    email: string,
    now = new Date(),
  ): Promise<PersonalDataExport> {
    const profile = must(
      await this.db
        .from("profiles")
        .select(
          "pseudonym_id, role, display_name, project_description, uxie_character, privacy_notice_version, privacy_ack_at, research_consent, research_consent_version, research_consent_at, created_at",
        )
        .eq("id", userId)
        .maybeSingle(),
      `profile ${userId}`,
    ) as Record<string, unknown> & { pseudonym_id: string };
    const conversations = (await fetchAll(
      (from, to) =>
        this.db
          .from("conversations")
          .select(
            "id, paper_id, paper_version_id, module_title_at_start, mode, status, channel, state, created_at, updated_at, last_message_at, papers(slug, title)",
          )
          .eq("student_id", userId)
          .eq("is_test", false)
          .order("created_at")
          .range(from, to),
      "conversations",
    )) as (Record<string, unknown> & { id: string })[];
    const ids = conversations.map((c) => c.id);
    const messages: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      messages.push(
        ...(await fetchAll(
          (from, to) =>
            this.db
              .from("messages")
              .select(
                "id, conversation_id, role, event, mode, content, status, citations, help_level, created_at",
              )
              .in("conversation_id", ids.slice(i, i + 100))
              .order("created_at")
              .order("id")
              .range(from, to),
          "messages",
        )),
      );
    }
    const feedback = await fetchAll(
      (from, to) =>
        this.db
          .from("feedback")
          .select("message_id, rating, comment, created_at")
          .eq("student_id", userId)
          .order("created_at")
          .range(from, to),
      "feedback",
    );
    // Log first, so the download itself appears in the list it contains.
    const { error } = await this.db.from("data_requests").insert({
      student_id: userId,
      pseudonym_id: profile.pseudonym_id,
      type: "access",
      status: "completed",
      completed_at: now.toISOString(),
      due_at: now.toISOString(),
    });
    if (error) throw new DbError(`log access request: ${error.message}`);
    return {
      exportedAt: now.toISOString(),
      format: "uxie-personal-data/1",
      profile: { ...profile, email },
      conversations,
      messages,
      feedback,
      dataRequests: await this.requestsOf(userId),
    };
  }

  async requestsOf(userId: string): Promise<DataRequest[]> {
    const rows = must(
      await this.db
        .from("data_requests")
        .select(REQUEST_COLUMNS)
        .eq("student_id", userId)
        .order("created_at", { ascending: false }),
      "data requests",
    ) as RequestRow[];
    return rows.map(toRequest);
  }

  /** FR-8.2: one open deletion request per student; asking again returns the open one. */
  async requestDeletion(userId: string): Promise<{ request: DataRequest; created: boolean }> {
    const open = (await this.requestsOf(userId)).find(
      (r) => r.type === "deletion" && isOpenRequest(r),
    );
    if (open) return { request: open, created: false };
    const profile = must(
      await this.db.from("profiles").select("pseudonym_id").eq("id", userId).maybeSingle(),
      `profile ${userId}`,
    ) as { pseudonym_id: string };
    const row = must(
      await this.db
        .from("data_requests")
        .insert({ student_id: userId, pseudonym_id: profile.pseudonym_id, type: "deletion" })
        .select(REQUEST_COLUMNS)
        .single(),
      "create deletion request",
    ) as RequestRow;
    return { request: toRequest(row), created: true };
  }

  /** The student may withdraw an open deletion request before it is processed. */
  async cancelDeletion(userId: string): Promise<boolean> {
    const res = await this.db
      .from("data_requests")
      .update({
        status: "rejected",
        notes: "Withdrawn by the student.",
        completed_at: new Date().toISOString(),
      })
      .eq("student_id", userId)
      .eq("type", "deletion")
      .eq("status", "open")
      .select("id");
    if (res.error) throw new DbError(`withdraw deletion: ${res.error.message}`);
    return (res.data ?? []).length > 0;
  }

  // ── Instructor side ──────────────────────────────────────────────

  async listRequests(opts: { openOnly?: boolean } = {}): Promise<DataRequest[]> {
    let q = this.db.from("data_requests").select(REQUEST_COLUMNS);
    if (opts.openOnly) q = q.in("status", ["open", "in_progress"]);
    const rows = must(
      await q.order("due_at").order("created_at").limit(500),
      "data requests",
    ) as RequestRow[];
    return rows.map(toRequest);
  }

  async request(id: string): Promise<DataRequest | null> {
    const res = await this.db
      .from("data_requests")
      .select(REQUEST_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (res.error) throw new DbError(`data request ${id}: ${res.error.message}`);
    return res.data ? toRequest(res.data as RequestRow) : null;
  }

  /** Mark in progress, or reject with a reason (e.g. a legal retention obligation). */
  async setStatus(
    id: string,
    status: "in_progress" | "rejected",
    notes?: string | null,
  ): Promise<DataRequest> {
    const row = must(
      await this.db
        .from("data_requests")
        .update({
          status,
          ...(notes !== undefined ? { notes } : {}),
          ...(status === "rejected" ? { completed_at: new Date().toISOString() } : {}),
        })
        .eq("id", id)
        .in("status", ["open", "in_progress"])
        .select(REQUEST_COLUMNS)
        .maybeSingle(),
      `open data request ${id}`,
    ) as RequestRow;
    return toRequest(row);
  }

  /** FR-8.3, atomically in SQL (`complete_deletion`). */
  async completeDeletion(id: string): Promise<CompleteDeletionResult> {
    return must(
      await this.db.rpc("complete_deletion", { p_request: id }),
      "complete deletion",
    ) as CompleteDeletionResult;
  }

  async ledgerHas(pseudonymId: string): Promise<boolean> {
    const res = await this.db
      .from("deletion_ledger")
      .select("pseudonym_id")
      .eq("pseudonym_id", pseudonymId)
      .maybeSingle();
    if (res.error) throw new DbError(`deletion ledger: ${res.error.message}`);
    return res.data !== null;
  }

  /** FR-8.4 retention purge (CLI); `dryRun` only counts. */
  async purge(before: Date, dryRun: boolean): Promise<PurgeCounts> {
    const rows = must(
      await this.db.rpc("purge_conversations", {
        p_before: before.toISOString(),
        p_dry_run: dryRun,
      }),
      "purge",
    ) as PurgeCounts[];
    return rows[0] ?? { conversations: 0, messages: 0, feedback: 0, students: 0 };
  }
}
