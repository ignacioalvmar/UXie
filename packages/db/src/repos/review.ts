import {
  buildClassReport,
  buildUsageReport,
  monthOf,
  monthRange,
  ObjectiveKind,
  type ClassReport,
  type ExportFilters,
  type ExportFormat,
  type ExportRow,
  type ReportConversation,
  type ReportObjective,
  type UsageReport,
} from "@uxie/core";
import { z } from "zod";
import { DbError, must, type Db } from "../client";

/**
 * Conversation review, class reports, exports and usage (PRD §10.7, FR-7.1–7.4; ADR-028). Runs
 * on the secret-key client: callers (admin API, pages, CLI) check `is_instructor` first. Test
 * conversations are excluded by the SQL functions in 0007_review.sql.
 */

export interface ReviewFilters {
  moduleId?: string;
  paperId?: string;
  versionId?: string;
  pseudonym?: string;
  mode?: string;
  from?: string;
  to?: string;
  hasFeedback?: boolean;
}

export interface ReviewListItem {
  id: string;
  pseudonymId: string;
  paperId: string;
  paperSlug: string;
  paperTitle: string;
  versionNo: number;
  moduleTitleAtStart: string;
  mode: string;
  status: "active" | "reset" | "closed";
  createdAt: string;
  lastMessageAt: string | null;
  studentTurns: number;
  feedbackCount: number;
}

/** Learner snapshot stored with each tutor reply (`messages.generation.learner`). */
export interface LearnerSnapshot {
  mode: string;
  active_objective: string | null;
  objectives: Record<string, string>;
  attempts: number;
  stuck_requests: number;
  assessment_failed: boolean;
}

export interface TranscriptMessage {
  id: string;
  role: "student" | "tutor" | "event";
  event: string | null;
  mode: string | null;
  helpLevel: string | null;
  content: string;
  status: "complete" | "streaming" | "failed";
  errorCode: string | null;
  citations: { pageFrom: number; pageTo: number }[];
  model: string | null;
  promptVersion: string | null;
  createdAt: string;
  feedback: { rating: 1 | -1; comment: string | null } | null;
  learner: LearnerSnapshot | null;
}

export interface TimelineEntry {
  messageId: string;
  at: string;
  mode: string | null;
  helpLevel: string | null;
  /** Objective status changes since the previous reply, e.g. U1 in_progress → demonstrated. */
  transitions: { objective: string; from: string; to: string }[];
  activeObjective: string | null;
  assessmentFailed: boolean;
  event: string | null;
}

export interface ConversationReview {
  conversation: {
    id: string;
    studentId: string;
    pseudonymId: string;
    paperId: string;
    paperVersionId: string;
    paperSlug: string;
    paperTitle: string;
    versionNo: number;
    moduleTitleAtStart: string;
    mode: string;
    status: string;
    channel: string;
    isTest: boolean;
    createdAt: string;
    lastMessageAt: string | null;
  };
  objectives: ReportObjective[];
  /** Current learner state statuses (the conversation row). */
  current: Record<string, string>;
  messages: TranscriptMessage[];
  timeline: TimelineEntry[];
}

export interface ExportLogEntry {
  id: string;
  /** Null for CLI exports. */
  instructorPseudonym: string | null;
  channel: "web" | "cli";
  format: ExportFormat;
  filters: ExportFilters;
  researchOnly: boolean;
  rowCount: number;
  createdAt: string;
}

const PAGE = 1000;

/** All rows of a query, in pages of 1,000 (PostgREST's default cap). */
export async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new DbError(`${what}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

const ReportObjectiveSchema = z.object({
  id: z.string(),
  kind: ObjectiveKind,
  statement: z.string(),
});

function parseObjectives(raw: unknown): ReportObjective[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o) => {
    const p = ReportObjectiveSchema.safeParse(o);
    return p.success ? [p.data] : [];
  });
}

const LearnerSnapshotSchema = z.object({
  mode: z.string(),
  active_objective: z.string().nullable(),
  objectives: z.record(z.string(), z.string()),
  attempts: z.number(),
  stuck_requests: z.number(),
  assessment_failed: z.boolean(),
});

/** Objective transitions between consecutive replies (FR-7.1 state timeline). */
export function buildTimeline(
  messages: TranscriptMessage[],
  initial: Record<string, string> = {},
): TimelineEntry[] {
  let prev = initial;
  const out: TimelineEntry[] = [];
  for (const m of messages) {
    if (m.role === "event" && m.event) {
      out.push({
        messageId: m.id,
        at: m.createdAt,
        mode: m.mode,
        helpLevel: null,
        transitions: [],
        activeObjective: null,
        assessmentFailed: false,
        event: m.event,
      });
      continue;
    }
    if (m.role !== "tutor" || m.status !== "complete") continue;
    const now = m.learner?.objectives ?? prev;
    const ids = [...new Set([...Object.keys(prev), ...Object.keys(now)])].sort();
    const transitions = ids
      .map((objective) => ({
        objective,
        from: prev[objective] ?? "not_started",
        to: now[objective] ?? "not_started",
      }))
      .filter((t) => t.from !== t.to);
    out.push({
      messageId: m.id,
      at: m.createdAt,
      mode: m.mode,
      helpLevel: m.helpLevel,
      transitions,
      activeObjective: m.learner?.active_objective ?? null,
      assessmentFailed: m.learner?.assessment_failed ?? false,
      event: null,
    });
    prev = now;
  }
  return out;
}

const filterArgs = (f: ExportFilters) => ({
  p_module: f.moduleId ?? null,
  p_paper: f.paperId ?? null,
  p_version: f.versionId ?? null,
  p_from: f.from ?? null,
  p_to: f.to ?? null,
});

export class ReviewRepo {
  constructor(private readonly db: Db) {}

  // ── FR-7.1 ───────────────────────────────────────────────────────

  async listConversations(
    f: ReviewFilters,
    page = { limit: 50, offset: 0 },
  ): Promise<{ items: ReviewListItem[]; total: number }> {
    const rows = must(
      await this.db.rpc("review_conversations", {
        p_module: f.moduleId ?? null,
        p_paper: f.paperId ?? null,
        p_version: f.versionId ?? null,
        p_pseudonym: f.pseudonym?.trim() || null,
        p_mode: f.mode ?? null,
        p_from: f.from ?? null,
        p_to: f.to ?? null,
        p_has_feedback: f.hasFeedback ?? false,
        p_limit: page.limit,
        p_offset: page.offset,
      }),
      "review conversations",
    ) as {
      id: string;
      pseudonym_id: string;
      paper_id: string;
      paper_slug: string;
      paper_title: string;
      version_no: number;
      module_title_at_start: string;
      mode: string;
      status: ReviewListItem["status"];
      created_at: string;
      last_message_at: string | null;
      student_turns: number;
      feedback_count: number;
      total_count: number;
    }[];
    return {
      total: Number(rows[0]?.total_count ?? 0),
      items: rows.map((r) => ({
        id: r.id,
        pseudonymId: r.pseudonym_id,
        paperId: r.paper_id,
        paperSlug: r.paper_slug,
        paperTitle: r.paper_title,
        versionNo: r.version_no,
        moduleTitleAtStart: r.module_title_at_start,
        mode: r.mode,
        status: r.status,
        createdAt: r.created_at,
        lastMessageAt: r.last_message_at,
        studentTurns: r.student_turns,
        feedbackCount: r.feedback_count,
      })),
    };
  }

  /** Read-only transcript with the state timeline; null when the conversation does not exist. */
  async conversation(id: string): Promise<ConversationReview | null> {
    const res = await this.db
      .from("conversations")
      .select(
        "id, student_id, paper_id, paper_version_id, module_title_at_start, mode, status, channel, is_test, state, created_at, last_message_at, profiles(pseudonym_id), papers(slug, title), paper_versions(version_no, teaching_guides(guide))",
      )
      .eq("id", id)
      .maybeSingle();
    if (res.error) throw new DbError(`conversation ${id}: ${res.error.message}`);
    if (!res.data) return null;
    const c = res.data as unknown as {
      id: string;
      student_id: string;
      paper_id: string;
      paper_version_id: string;
      module_title_at_start: string;
      mode: string;
      status: string;
      channel: string;
      is_test: boolean;
      state: { objectives?: Record<string, string> };
      created_at: string;
      last_message_at: string | null;
      profiles: { pseudonym_id: string };
      papers: { slug: string; title: string };
      paper_versions: {
        version_no: number;
        teaching_guides:
          { guide: { objectives?: unknown } } | { guide: { objectives?: unknown } }[] | null;
      };
    };
    const g = c.paper_versions.teaching_guides;
    const guide = Array.isArray(g) ? g[0] : g;

    const msgs = await fetchAll(
      (from, to) =>
        this.db
          .from("messages")
          .select(
            "id, role, event, mode, help_level, content, status, error_code, citations, model, prompt_version, generation, created_at, feedback(rating, comment)",
          )
          .eq("conversation_id", id)
          .order("created_at")
          .order("id")
          .range(from, to),
      "transcript",
    );
    const messages: TranscriptMessage[] = (
      msgs as {
        id: string;
        role: TranscriptMessage["role"];
        event: string | null;
        mode: string | null;
        help_level: string | null;
        content: string;
        status: TranscriptMessage["status"];
        error_code: string | null;
        citations: { pageFrom: number; pageTo: number }[] | null;
        model: string | null;
        prompt_version: string | null;
        generation: { learner?: unknown } | null;
        created_at: string;
        feedback: { rating: 1 | -1; comment: string | null }[] | null;
      }[]
    ).map((m) => {
      const learner = LearnerSnapshotSchema.safeParse(m.generation?.learner);
      return {
        id: m.id,
        role: m.role,
        event: m.event,
        mode: m.mode,
        helpLevel: m.help_level,
        content: m.content,
        status: m.status,
        errorCode: m.error_code,
        citations: (m.citations ?? []).map((x) => ({ pageFrom: x.pageFrom, pageTo: x.pageTo })),
        model: m.model,
        promptVersion: m.prompt_version,
        createdAt: m.created_at,
        feedback: m.feedback?.[0] ?? null,
        learner: learner.success ? learner.data : null,
      };
    });

    return {
      conversation: {
        id: c.id,
        studentId: c.student_id,
        pseudonymId: c.profiles.pseudonym_id,
        paperId: c.paper_id,
        paperVersionId: c.paper_version_id,
        paperSlug: c.papers.slug,
        paperTitle: c.papers.title,
        versionNo: c.paper_versions.version_no,
        moduleTitleAtStart: c.module_title_at_start,
        mode: c.mode,
        status: c.status,
        channel: c.channel,
        isTest: c.is_test,
        createdAt: c.created_at,
        lastMessageAt: c.last_message_at,
      },
      objectives: parseObjectives(guide?.guide.objectives),
      current: c.state.objectives ?? {},
      messages,
      timeline: buildTimeline(messages),
    };
  }

  /** FR-7.1 "Reveal identity": the email of a conversation's student (callers log the reveal). */
  async studentEmail(studentId: string): Promise<string | null> {
    const { data, error } = await this.db.auth.admin.getUserById(studentId);
    if (error) return null;
    return data.user?.email ?? null;
  }

  // ── FR-7.2 ───────────────────────────────────────────────────────

  async classReport(
    paperId: string,
    opts: { names?: ReadonlyMap<string, string>; now?: Date } = {},
  ): Promise<ClassReport | null> {
    const paper = await this.db
      .from("papers")
      .select("id, slug, title")
      .eq("id", paperId)
      .maybeSingle();
    if (paper.error) throw new DbError(`paper ${paperId}: ${paper.error.message}`);
    if (!paper.data) return null;
    const rows = (await fetchAll(
      (from, to) => this.db.rpc("report_conversations", { p_paper: paperId }).range(from, to),
      "report conversations",
    )) as {
      id: string;
      pseudonym_id: string;
      version_no: number;
      objectives: unknown;
      state: { objectives?: Record<string, string>; misconceptions_seen?: unknown[] };
      student_turns: number;
      cost_eur: number | string;
    }[];
    const counts = (
      must(await this.db.rpc("report_counts", { p_paper: paperId }), "report counts") as {
        feedback_up: number;
        feedback_down: number;
        tutor_calls: number;
        tutor_calls_invalid_citations: number;
        assessment_calls: number;
        assessment_failures: number;
      }[]
    )[0]!;
    const conversations: ReportConversation[] = rows.map((r) => ({
      id: r.id,
      pseudonymId: r.pseudonym_id,
      versionNo: r.version_no,
      objectives: parseObjectives(r.objectives),
      state: {
        objectives: (r.state.objectives ?? {}) as ReportConversation["state"]["objectives"],
        misconceptions_seen: (r.state.misconceptions_seen ??
          []) as ReportConversation["state"]["misconceptions_seen"],
      },
      studentTurns: r.student_turns,
      costEur: Number(r.cost_eur),
    }));
    const p = paper.data as { id: string; slug: string; title: string };
    return buildClassReport({
      paper: p,
      generatedAt: opts.now ?? new Date(),
      conversations,
      counts: {
        feedbackUp: counts.feedback_up,
        feedbackDown: counts.feedback_down,
        tutorCalls: counts.tutor_calls,
        tutorCallsWithInvalidCitations: counts.tutor_calls_invalid_citations,
        assessmentCalls: counts.assessment_calls,
        assessmentFailures: counts.assessment_failures,
      },
      ...(opts.names ? { names: opts.names } : {}),
    });
  }

  /** CLI `report --named`: pseudonym → email (operator only, never the web UI). */
  async namesFor(pseudonyms: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!pseudonyms.length) return out;
    const rows = must(
      await this.db
        .from("profiles")
        .select("id, pseudonym_id, display_name")
        .in("pseudonym_id", pseudonyms),
      "profiles",
    ) as { id: string; pseudonym_id: string; display_name: string | null }[];
    for (const r of rows) {
      const email = await this.studentEmail(r.id);
      out.set(r.pseudonym_id, [r.display_name, email].filter(Boolean).join(" · "));
    }
    return out;
  }

  // ── FR-7.3 ───────────────────────────────────────────────────────

  async exportRows(filters: ExportFilters, researchOnly: boolean): Promise<ExportRow[]> {
    const rows = (await fetchAll(
      (from, to) =>
        this.db
          .rpc("export_rows", { ...filterArgs(filters), p_research_only: researchOnly })
          .range(from, to),
      "export rows",
    )) as (Omit<ExportRow, "created_at"> & { created_at: string })[];
    return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
  }

  async logExport(e: {
    instructorId: string | null;
    channel: "web" | "cli";
    format: ExportFormat;
    filters: ExportFilters;
    researchOnly: boolean;
    rowCount: number;
  }): Promise<void> {
    const { error } = await this.db.from("export_log").insert({
      instructor_id: e.instructorId,
      channel: e.channel,
      format: e.format,
      filters: e.filters,
      research_only: e.researchOnly,
      row_count: e.rowCount,
    });
    if (error) throw new DbError(`export log: ${error.message}`);
  }

  async exportLog(limit = 50): Promise<ExportLogEntry[]> {
    const rows = must(
      await this.db
        .from("export_log")
        .select(
          "id, channel, format, filters, research_only, row_count, created_at, profiles(pseudonym_id)",
        )
        .order("created_at", { ascending: false })
        .limit(limit),
      "export log",
    ) as unknown as {
      id: string;
      channel: "web" | "cli";
      format: ExportFormat;
      filters: ExportFilters;
      research_only: boolean;
      row_count: number;
      created_at: string;
      profiles: { pseudonym_id: string } | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      instructorPseudonym: r.profiles?.pseudonym_id ?? null,
      channel: r.channel,
      format: r.format,
      filters: r.filters,
      researchOnly: r.research_only,
      rowCount: r.row_count,
      createdAt: r.created_at,
    }));
  }

  // ── FR-7.4 ───────────────────────────────────────────────────────

  async usage(month: string, ceilingEur: number, now = new Date()): Promise<UsageReport> {
    const { from, to } = monthRange(month);
    const range = { p_from: from.toISOString(), p_to: to.toISOString() };
    const [byModel, latency, days, active] = await Promise.all([
      this.db.rpc("usage_by_model", range),
      this.db.rpc("usage_latency", range),
      this.db.rpc("usage_days", range),
      this.db.rpc("usage_active_students", range),
    ]);
    const bm = must(byModel, "usage by model") as {
      purpose: string;
      provider: string;
      model: string;
      calls: number;
      errors: number;
      input_tokens: number | string;
      output_tokens: number | string;
      cached_input_tokens: number | string;
      cache_write_input_tokens: number | string;
      cost_eur: number | string;
    }[];
    const lat = must(latency, "usage latency") as {
      purpose: string;
      latency_p50_ms: number | null;
      latency_p95_ms: number | null;
      ttft_p95_ms: number | null;
    }[];
    const dd = must(days, "usage days") as {
      day: string;
      active_students: number;
      cost_eur: number | string;
    }[];
    if (active.error) throw new DbError(`active students: ${active.error.message}`);
    return buildUsageReport({
      month,
      ceilingEur,
      isCurrentMonth: monthOf(now) === month,
      byModel: bm.map((r) => ({
        purpose: r.purpose,
        provider: r.provider,
        model: r.model,
        calls: r.calls,
        errors: r.errors,
        inputTokens: Number(r.input_tokens),
        outputTokens: Number(r.output_tokens),
        cachedInputTokens: Number(r.cached_input_tokens),
        cacheWriteInputTokens: Number(r.cache_write_input_tokens),
        costEur: Number(r.cost_eur),
      })),
      latency: lat.map((r) => ({
        purpose: r.purpose,
        latencyP50Ms: r.latency_p50_ms,
        latencyP95Ms: r.latency_p95_ms,
        ttftP95Ms: r.ttft_p95_ms,
      })),
      days: dd.map((r) => ({
        day: r.day,
        activeStudents: r.active_students,
        costEur: Number(r.cost_eur),
      })),
      activeStudents: Number(active.data ?? 0),
    });
  }

  // ── FR-9.5 health ────────────────────────────────────────────────

  async workerHeartbeats(): Promise<{ name: string; lastSeenAt: string }[]> {
    const rows = must(
      await this.db.from("worker_heartbeats").select("name, last_seen_at").order("name"),
      "worker heartbeats",
    ) as { name: string; last_seen_at: string }[];
    return rows.map((r) => ({ name: r.name, lastSeenAt: r.last_seen_at }));
  }

  /** The newest failed model call and failed ingest job (codes only, no content). */
  async lastErrors(): Promise<{
    llm: { at: string; purpose: string; model: string; errorCode: string | null } | null;
    ingest: { at: string; versionId: string; error: string | null } | null;
  }> {
    const [llm, job] = await Promise.all([
      this.db
        .from("llm_calls")
        .select("created_at, purpose, model, error_code")
        .eq("ok", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.db
        .from("ingest_jobs")
        .select("finished_at, created_at, version_id, error")
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const l = llm.data as {
      created_at: string;
      purpose: string;
      model: string;
      error_code: string | null;
    } | null;
    const j = job.data as {
      finished_at: string | null;
      created_at: string;
      version_id: string;
      error: string | null;
    } | null;
    return {
      llm: l
        ? { at: l.created_at, purpose: l.purpose, model: l.model, errorCode: l.error_code }
        : null,
      ingest: j
        ? { at: j.finished_at ?? j.created_at, versionId: j.version_id, error: j.error }
        : null,
    };
  }

  async storageReachable(bucket = "papers"): Promise<boolean> {
    const { error } = await this.db.storage.from(bucket).list("", { limit: 1 });
    return !error;
  }
}
