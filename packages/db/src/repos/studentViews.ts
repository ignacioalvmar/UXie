import {
  ExtractionWarningSchema,
  LearnerStateSchema,
  TeachingGuideSchema,
  type Citation,
  type ExtractionWarning,
  type LearnerState,
  type Mode,
  type ObjectiveKind,
} from "@uxie/core";
import { DbError, must, type Db } from "../client";

/**
 * Read models for the student pages (library, workspace, /conversations; PRD §11). Runs on the
 * secret-key client, so every method applies the visibility rules of §9.2 itself: published
 * modules, published or retired papers, versions that are published or carry one of the
 * student's own conversations, and only the student's own non-test conversations. Teaching
 * guides are reduced to what students may see (starter questions, objective statements, refs,
 * key concepts for search); hints, ladders, mastery checks and the tutor summary never leave.
 */

export type PaperStatus = "draft" | "published" | "retired";
export type ConversationStatus = "active" | "reset" | "closed";

export interface ModuleRow {
  id: string;
  slug: string;
  title: string;
  position: number;
}

export interface PaperRow {
  id: string;
  moduleId: string;
  slug: string;
  title: string;
  authors: string[];
  year: number | null;
  position: number;
  status: PaperStatus;
  currentVersionId: string | null;
}

export interface GuideObjective {
  id: string;
  kind: ObjectiveKind;
  statement: string;
  refs: { page: number; label?: string }[];
  keyConcepts: string[];
}

/** The student-safe part of a teaching guide. */
export interface GuideSummary {
  starterQuestions: string[];
  objectives: GuideObjective[];
}

export interface ConversationRow {
  id: string;
  paperId: string;
  paperVersionId: string;
  moduleTitleAtStart: string;
  mode: Mode;
  state: LearnerState;
  status: ConversationStatus;
  createdAt: Date;
  lastMessageAt: Date | null;
  /** Set while a turn holds the generation lock (PRD §4.4). */
  generatingSince: Date | null;
}

export interface VersionMeta {
  id: string;
  paperId: string;
  versionNo: number;
  pageCount: number;
  status: string;
  warnings: ExtractionWarning[];
  pdfPath: string;
}

export interface ChatMessageRow {
  id: string;
  role: "student" | "tutor" | "event";
  content: string;
  status: "complete" | "streaming" | "failed";
  event: string | null;
  mode: Mode | null;
  helpLevel: string | null;
  clientMessageId: string | null;
  replyTo: string | null;
  citations: Citation[];
  errorCode: string | null;
  createdAt: Date;
}

const EMPTY_GUIDE: GuideSummary = { starterQuestions: [], objectives: [] };

function summarizeGuide(raw: unknown): GuideSummary {
  const parsed = TeachingGuideSchema.safeParse(raw);
  if (!parsed.success) return EMPTY_GUIDE;
  return {
    starterQuestions: parsed.data.starter_questions,
    objectives: parsed.data.objectives.map((o) => ({
      id: o.id,
      kind: o.kind,
      statement: o.statement,
      refs: o.refs,
      keyConcepts: o.key_concepts,
    })),
  };
}

function parseWarnings(raw: unknown): ExtractionWarning[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((w) => {
    const parsed = ExtractionWarningSchema.safeParse(w);
    return parsed.success ? [parsed.data] : [];
  });
}

interface RawPaper {
  id: string;
  module_id: string;
  slug: string;
  title: string;
  authors: string[];
  year: number | null;
  position: number;
  status: PaperStatus;
  current_version_id: string | null;
}

const PAPER_COLUMNS =
  "id, module_id, slug, title, authors, year, position, status, current_version_id";

const toPaper = (r: RawPaper): PaperRow => ({
  id: r.id,
  moduleId: r.module_id,
  slug: r.slug,
  title: r.title,
  authors: r.authors ?? [],
  year: r.year,
  position: r.position,
  status: r.status,
  currentVersionId: r.current_version_id,
});

interface RawConversation {
  id: string;
  paper_id: string;
  paper_version_id: string;
  module_title_at_start: string;
  mode: Mode;
  state: unknown;
  status: ConversationStatus;
  created_at: string;
  last_message_at: string | null;
  generating_since: string | null;
}

const CONVERSATION_COLUMNS =
  "id, paper_id, paper_version_id, module_title_at_start, mode, state, status, created_at, last_message_at, generating_since";

const toConversation = (r: RawConversation): ConversationRow => ({
  id: r.id,
  paperId: r.paper_id,
  paperVersionId: r.paper_version_id,
  moduleTitleAtStart: r.module_title_at_start,
  mode: r.mode,
  state: LearnerStateSchema.parse(r.state),
  status: r.status,
  createdAt: new Date(r.created_at),
  lastMessageAt: r.last_message_at ? new Date(r.last_message_at) : null,
  generatingSince: r.generating_since ? new Date(r.generating_since) : null,
});

export class StudentViewsRepo {
  constructor(private readonly db: Db) {}

  /** Published modules in order (FR-2.1). */
  async publishedModules(): Promise<ModuleRow[]> {
    const rows = must(
      await this.db
        .from("modules")
        .select("id, slug, title, position")
        .eq("status", "published")
        .order("position"),
      "modules",
    ) as ModuleRow[];
    return rows;
  }

  /** Published papers of the given modules, in order (retired papers are left out, FR-2.3). */
  async publishedPapers(moduleIds: string[]): Promise<PaperRow[]> {
    if (!moduleIds.length) return [];
    const rows = must(
      await this.db
        .from("papers")
        .select(PAPER_COLUMNS)
        .in("module_id", moduleIds)
        .eq("status", "published")
        .not("current_version_id", "is", null)
        .order("position"),
      "papers",
    ) as RawPaper[];
    return rows.map(toPaper);
  }

  /** A paper students may see (published or retired, in a published module), or null. */
  async visiblePaperBySlug(slug: string): Promise<{ paper: PaperRow; module: ModuleRow } | null> {
    const res = await this.db.from("papers").select(PAPER_COLUMNS).eq("slug", slug).maybeSingle();
    if (res.error) throw new DbError(`paper ${slug}: ${res.error.message}`, res.error.code);
    if (!res.data) return null;
    const paper = toPaper(res.data as RawPaper);
    if (paper.status === "draft") return null;
    const mod = await this.db
      .from("modules")
      .select("id, slug, title, position, status")
      .eq("id", paper.moduleId)
      .maybeSingle();
    if (mod.error) throw new DbError(`module: ${mod.error.message}`, mod.error.code);
    const m = mod.data as (ModuleRow & { status: string }) | null;
    if (!m || m.status !== "published") return null;
    return { paper, module: { id: m.id, slug: m.slug, title: m.title, position: m.position } };
  }

  /** Student-safe guide summaries per version id. */
  async guideSummaries(versionIds: string[]): Promise<Map<string, GuideSummary>> {
    const ids = [...new Set(versionIds)];
    const out = new Map<string, GuideSummary>();
    if (!ids.length) return out;
    const rows = must(
      await this.db.from("teaching_guides").select("version_id, guide").in("version_id", ids),
      "guides",
    ) as { version_id: string; guide: unknown }[];
    for (const r of rows) out.set(r.version_id, summarizeGuide(r.guide));
    return out;
  }

  async guideSummary(versionId: string): Promise<GuideSummary> {
    return (await this.guideSummaries([versionId])).get(versionId) ?? EMPTY_GUIDE;
  }

  async versionMeta(versionId: string): Promise<VersionMeta | null> {
    const res = await this.db
      .from("paper_versions")
      .select("id, paper_id, version_no, page_count, status, extraction_warnings, pdf_path")
      .eq("id", versionId)
      .maybeSingle();
    if (res.error) throw new DbError(`version: ${res.error.message}`, res.error.code);
    const r = res.data as {
      id: string;
      paper_id: string;
      version_no: number;
      page_count: number | null;
      status: string;
      extraction_warnings: unknown;
      pdf_path: string;
    } | null;
    if (!r) return null;
    return {
      id: r.id,
      paperId: r.paper_id,
      versionNo: r.version_no,
      pageCount: r.page_count ?? 0,
      status: r.status,
      warnings: parseWarnings(r.extraction_warnings),
      pdfPath: r.pdf_path,
    };
  }

  /** The same rule as `can_read_version()` for students (PRD §9.3). */
  async studentCanReadVersion(studentId: string, versionId: string): Promise<boolean> {
    const meta = await this.versionMeta(versionId);
    if (!meta) return false;
    if (meta.status === "published") return true;
    const res = await this.db
      .from("conversations")
      .select("id", { head: true, count: "exact" })
      .eq("student_id", studentId)
      .eq("paper_version_id", versionId);
    if (res.error) throw new DbError(`version access: ${res.error.message}`, res.error.code);
    return (res.count ?? 0) > 0;
  }

  /** All of the student's own conversations (test conversations excluded), newest first. */
  async conversationsOf(studentId: string): Promise<ConversationRow[]> {
    const rows = must(
      await this.db
        .from("conversations")
        .select(CONVERSATION_COLUMNS)
        .eq("student_id", studentId)
        .eq("is_test", false)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      "conversations",
    ) as RawConversation[];
    return rows.map(toConversation);
  }

  /** One conversation if it belongs to the student, else null (ownership check, NFR-7). */
  async ownConversation(
    studentId: string,
    conversationId: string,
  ): Promise<ConversationRow | null> {
    const res = await this.db
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("id", conversationId)
      .eq("student_id", studentId)
      .eq("is_test", false)
      .maybeSingle();
    if (res.error) throw new DbError(`conversation: ${res.error.message}`, res.error.code);
    return res.data ? toConversation(res.data as RawConversation) : null;
  }

  async activeConversation(studentId: string, versionId: string): Promise<ConversationRow | null> {
    const res = await this.db
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("student_id", studentId)
      .eq("paper_version_id", versionId)
      .eq("status", "active")
      .eq("is_test", false)
      .maybeSingle();
    if (res.error) throw new DbError(`conversation: ${res.error.message}`, res.error.code);
    return res.data ? toConversation(res.data as RawConversation) : null;
  }

  /** Papers by id, whatever their status (for conversation lists; retired papers included). */
  async papersById(ids: string[]): Promise<Map<string, PaperRow>> {
    const out = new Map<string, PaperRow>();
    const unique = [...new Set(ids)];
    if (!unique.length) return out;
    const rows = must(
      await this.db.from("papers").select(PAPER_COLUMNS).in("id", unique),
      "papers by id",
    ) as RawPaper[];
    for (const r of rows) out.set(r.id, toPaper(r));
    return out;
  }

  async versionNumbers(ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const unique = [...new Set(ids)];
    if (!unique.length) return out;
    const rows = must(
      await this.db.from("paper_versions").select("id, version_no").in("id", unique),
      "version numbers",
    ) as { id: string; version_no: number }[];
    for (const r of rows) out.set(r.id, r.version_no);
    return out;
  }

  /** The latest complete tutor message per conversation (for "Pip asked: …"). */
  async lastTutorMessages(conversationIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    await Promise.all(
      conversationIds.map(async (id) => {
        const res = await this.db
          .from("messages")
          .select("content")
          .eq("conversation_id", id)
          .eq("role", "tutor")
          .eq("status", "complete")
          .order("created_at", { ascending: false })
          .limit(1);
        if (res.error) throw new DbError(`last tutor message: ${res.error.message}`);
        const row = (res.data as { content: string }[])[0];
        if (row) out.set(id, row.content);
      }),
    );
    return out;
  }

  /** The whole transcript, chronological. Callers check ownership first. */
  async messages(conversationId: string): Promise<ChatMessageRow[]> {
    const rows = must(
      await this.db
        .from("messages")
        .select(
          "id, role, content, status, event, mode, help_level, client_message_id, reply_to, citations, error_code, created_at",
        )
        .eq("conversation_id", conversationId)
        .order("created_at"),
      "messages",
    ) as {
      id: string;
      role: ChatMessageRow["role"];
      content: string;
      status: ChatMessageRow["status"];
      event: string | null;
      mode: Mode | null;
      help_level: string | null;
      client_message_id: string | null;
      reply_to: string | null;
      citations: Citation[] | null;
      error_code: string | null;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      status: r.status,
      event: r.event,
      mode: r.mode,
      helpLevel: r.help_level,
      clientMessageId: r.client_message_id,
      replyTo: r.reply_to,
      citations: r.citations ?? [],
      errorCode: r.error_code,
      createdAt: new Date(r.created_at),
    }));
  }

  /** Extracted text of every page (accessible text and in-document search, FR-3.3). */
  async pages(versionId: string): Promise<{ n: number; text: string }[]> {
    const rows = must(
      await this.db
        .from("paper_pages")
        .select("page_no, text")
        .eq("version_id", versionId)
        .order("page_no"),
      "pages",
    ) as { page_no: number; text: string }[];
    return rows.map((r) => ({ n: r.page_no, text: r.text }));
  }

  async page(versionId: string, n: number): Promise<string | null> {
    const res = await this.db
      .from("paper_pages")
      .select("text")
      .eq("version_id", versionId)
      .eq("page_no", n)
      .maybeSingle();
    if (res.error) throw new DbError(`page: ${res.error.message}`, res.error.code);
    return (res.data as { text: string } | null)?.text ?? null;
  }

  /** 10-minute signed download URL for a version's PDF (PRD §9.3). Callers authorize first. */
  async signedPdfUrl(pdfPath: string, expiresInSeconds = 600): Promise<string | null> {
    const { data, error } = await this.db.storage
      .from("papers")
      .createSignedUrl(pdfPath, expiresInSeconds);
    if (error || !data) return null;
    return data.signedUrl;
  }
}
