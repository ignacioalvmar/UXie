import {
  ExtractionWarningSchema,
  sha256Hex,
  type ExtractionWarning,
  type GuideIssue,
} from "@uxie/core";
import { DbError, must, NotFoundError, type Db } from "../client";

/**
 * Instructor content management (PRD §10.5, §10.6; ADR-027). Runs on the secret-key client:
 * callers (admin API routes, CLI) check `is_instructor` first. Validation of guides happens in
 * the callers with `validateGuide` (packages/core); this repo stores what it is given.
 */

export type ModuleStatus = "draft" | "published" | "archived";
export type AdminPaperStatus = "draft" | "published" | "retired";
export type VersionStatus =
  "uploading" | "processing" | "ready" | "failed" | "published" | "superseded";
export type GuideStatus = "draft" | "approved";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobKind = "ingest" | "draft_guide";
export type ExtractorChoice = "unpdf" | "docling";

export interface AdminModule {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  position: number;
  status: ModuleStatus;
}

export interface AdminPaper {
  id: string;
  moduleId: string;
  slug: string;
  title: string;
  authors: string[];
  year: number | null;
  position: number;
  status: AdminPaperStatus;
  currentVersionId: string | null;
}

export interface AdminVersion {
  id: string;
  paperId: string;
  versionNo: number;
  status: VersionStatus;
  pdfPath: string;
  pdfSha256: string | null;
  pageCount: number | null;
  tokenEstimate: number | null;
  extractor: string | null;
  warnings: ExtractionWarning[];
  createdAt: string;
  publishedAt: string | null;
  guideStatus: GuideStatus | null;
}

export interface IngestJob {
  id: string;
  versionId: string;
  kind: JobKind;
  status: JobStatus;
  step: string | null;
  error: string | null;
  attempts: number;
  extractor: ExtractorChoice | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface GuideDraftMeta {
  source?: "draft" | "editor" | "cli" | "copy";
  prompt_version?: string;
  model?: string;
  issues?: GuideIssue[];
}

export interface GuideRecord {
  versionId: string;
  guide: unknown;
  status: GuideStatus;
  guideHash: string;
  draftMeta: GuideDraftMeta;
  updatedAt: string;
  approvedAt: string | null;
}

/** What a permanent deletion removes (FR-6.7). */
export interface DeletionImpact {
  versions: number;
  files: number;
  conversations: number;
  messages: number;
  students: number;
  /** Affected students with research consent: the instructor must confirm retention checks. */
  researchConsentStudents: number;
}

const MODULE_COLUMNS = "id, slug, title, description, position, status";
const PAPER_COLUMNS =
  "id, module_id, slug, title, authors, year, position, status, current_version_id";
const VERSION_COLUMNS =
  "id, paper_id, version_no, status, pdf_path, pdf_sha256, page_count, token_estimate, extractor, extraction_warnings, created_at, published_at, teaching_guides(status)";
const JOB_COLUMNS =
  "id, version_id, kind, status, step, error, attempts, extractor, created_at, started_at, finished_at";

interface RawPaper {
  id: string;
  module_id: string;
  slug: string;
  title: string;
  authors: string[] | null;
  year: number | null;
  position: number;
  status: AdminPaperStatus;
  current_version_id: string | null;
}

interface RawVersion {
  id: string;
  paper_id: string;
  version_no: number;
  status: VersionStatus;
  pdf_path: string;
  pdf_sha256: string | null;
  page_count: number | null;
  token_estimate: number | null;
  extractor: string | null;
  extraction_warnings: unknown;
  created_at: string;
  published_at: string | null;
  teaching_guides: { status: GuideStatus } | { status: GuideStatus }[] | null;
}

interface RawJob {
  id: string;
  version_id: string;
  kind: JobKind;
  status: JobStatus;
  step: string | null;
  error: string | null;
  attempts: number;
  extractor: ExtractorChoice | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const toPaper = (r: RawPaper): AdminPaper => ({
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

function parseWarnings(raw: unknown): ExtractionWarning[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((w) => {
    const parsed = ExtractionWarningSchema.safeParse(w);
    return parsed.success ? [parsed.data] : [];
  });
}

const toVersion = (r: RawVersion): AdminVersion => {
  const g = Array.isArray(r.teaching_guides) ? r.teaching_guides[0] : r.teaching_guides;
  return {
    id: r.id,
    paperId: r.paper_id,
    versionNo: r.version_no,
    status: r.status,
    pdfPath: r.pdf_path,
    pdfSha256: r.pdf_sha256,
    pageCount: r.page_count,
    tokenEstimate: r.token_estimate,
    extractor: r.extractor,
    warnings: parseWarnings(r.extraction_warnings),
    createdAt: r.created_at,
    publishedAt: r.published_at,
    guideStatus: g?.status ?? null,
  };
};

const toJob = (r: RawJob): IngestJob => ({
  id: r.id,
  versionId: r.version_id,
  kind: r.kind,
  status: r.status,
  step: r.step,
  error: r.error,
  attempts: r.attempts,
  extractor: r.extractor,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

/** Stable content hash of a stored guide (`teaching_guides.guide_hash`). */
export const guideHash = (guide: unknown) => sha256Hex(JSON.stringify(guide ?? null)).slice(0, 16);

/** Storage object path of a version's PDF (PRD §9.3). */
export const pdfPathFor = (paperId: string, versionId: string) => `${paperId}/${versionId}.pdf`;

export class AdminRepo {
  constructor(private readonly db: Db) {}

  // ── Modules (FR-6.1) ─────────────────────────────────────────────

  async modules(): Promise<AdminModule[]> {
    return must(
      await this.db.from("modules").select(MODULE_COLUMNS).order("position").order("created_at"),
      "modules",
    ) as AdminModule[];
  }

  async createModule(m: { slug: string; title: string; description?: string | null }) {
    const position = await this.nextPosition("modules");
    return must(
      await this.db
        .from("modules")
        .insert({
          slug: m.slug,
          title: m.title,
          description: m.description ?? null,
          position,
          status: "draft",
        })
        .select(MODULE_COLUMNS)
        .single(),
      "create module",
    ) as AdminModule;
  }

  async updateModule(
    id: string,
    patch: { title?: string; description?: string | null; status?: ModuleStatus },
  ): Promise<AdminModule> {
    return must(
      await this.db
        .from("modules")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(MODULE_COLUMNS)
        .maybeSingle(),
      `module ${id}`,
    ) as AdminModule;
  }

  /** Positions follow the given order; ids not listed keep theirs (after the listed ones). */
  async reorderModules(ids: string[]): Promise<void> {
    await this.reorder("modules", ids);
  }

  // ── Papers (FR-6.2) ──────────────────────────────────────────────

  async papers(moduleId?: string): Promise<AdminPaper[]> {
    let q = this.db.from("papers").select(PAPER_COLUMNS).order("position").order("created_at");
    if (moduleId) q = q.eq("module_id", moduleId);
    return (must(await q, "papers") as RawPaper[]).map(toPaper);
  }

  async paper(id: string): Promise<AdminPaper | null> {
    const res = await this.db.from("papers").select(PAPER_COLUMNS).eq("id", id).maybeSingle();
    if (res.error) throw new DbError(`paper: ${res.error.message}`, res.error.code);
    return res.data ? toPaper(res.data as RawPaper) : null;
  }

  async paperBySlug(slug: string): Promise<AdminPaper | null> {
    const res = await this.db.from("papers").select(PAPER_COLUMNS).eq("slug", slug).maybeSingle();
    if (res.error) throw new DbError(`paper: ${res.error.message}`, res.error.code);
    return res.data ? toPaper(res.data as RawPaper) : null;
  }

  async createPaper(p: {
    moduleId: string;
    slug: string;
    title: string;
    authors: string[];
    year: number | null;
  }): Promise<AdminPaper> {
    const position = await this.nextPosition("papers", p.moduleId);
    const row = must(
      await this.db
        .from("papers")
        .insert({
          module_id: p.moduleId,
          slug: p.slug,
          title: p.title,
          authors: p.authors,
          year: p.year,
          position,
          status: "draft",
        })
        .select(PAPER_COLUMNS)
        .single(),
      "create paper",
    ) as RawPaper;
    return toPaper(row);
  }

  async updatePaper(
    id: string,
    patch: { title?: string; authors?: string[]; year?: number | null },
  ): Promise<AdminPaper> {
    const row = must(
      await this.db
        .from("papers")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(PAPER_COLUMNS)
        .maybeSingle(),
      `paper ${id}`,
    ) as RawPaper;
    return toPaper(row);
  }

  async reorderPapers(moduleId: string, ids: string[]): Promise<void> {
    await this.reorder("papers", ids, moduleId);
  }

  /**
   * FR-6.2 move: the paper goes to the end of the target module. Existing conversations keep
   * `module_id_at_start` / `module_title_at_start` (they are never rewritten).
   */
  async movePaper(id: string, moduleId: string): Promise<AdminPaper> {
    const position = await this.nextPosition("papers", moduleId);
    const row = must(
      await this.db
        .from("papers")
        .update({ module_id: moduleId, position, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(PAPER_COLUMNS)
        .maybeSingle(),
      `paper ${id}`,
    ) as RawPaper;
    return toPaper(row);
  }

  /**
   * FR-6.2 retire / un-retire. Retired: no new conversations, history intact (FR-2.3). Un-retiring
   * returns to `published` when a version is published, else `draft`.
   */
  async setRetired(id: string, retired: boolean): Promise<AdminPaper> {
    const paper = await this.paper(id);
    if (!paper) throw new NotFoundError(`Paper ${id}`);
    const status: AdminPaperStatus = retired
      ? "retired"
      : paper.currentVersionId
        ? "published"
        : "draft";
    const row = must(
      await this.db
        .from("papers")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(PAPER_COLUMNS)
        .maybeSingle(),
      `paper ${id}`,
    ) as RawPaper;
    return toPaper(row);
  }

  // ── Versions & ingestion (FR-5.1, FR-6.3) ───────────────────────

  async versions(paperId: string): Promise<AdminVersion[]> {
    const rows = must(
      await this.db
        .from("paper_versions")
        .select(VERSION_COLUMNS)
        .eq("paper_id", paperId)
        .order("version_no", { ascending: false }),
      "versions",
    ) as RawVersion[];
    return rows.map(toVersion);
  }

  /** Number and status of every version, per paper (content overview). */
  async versionSummaries(): Promise<
    { id: string; paperId: string; versionNo: number; status: VersionStatus }[]
  > {
    const rows = must(
      await this.db
        .from("paper_versions")
        .select("id, paper_id, version_no, status")
        .order("version_no", { ascending: false }),
      "version summaries",
    ) as { id: string; paper_id: string; version_no: number; status: VersionStatus }[];
    return rows.map((r) => ({
      id: r.id,
      paperId: r.paper_id,
      versionNo: r.version_no,
      status: r.status,
    }));
  }

  async version(id: string): Promise<AdminVersion | null> {
    const res = await this.db
      .from("paper_versions")
      .select(VERSION_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (res.error) throw new DbError(`version: ${res.error.message}`, res.error.code);
    return res.data ? toVersion(res.data as RawVersion) : null;
  }

  /** `version_no` → version of a paper (CLI `--version n`); the newest when `versionNo` is omitted. */
  async versionByNumber(paperId: string, versionNo?: number): Promise<AdminVersion | null> {
    let q = this.db
      .from("paper_versions")
      .select(VERSION_COLUMNS)
      .eq("paper_id", paperId)
      .order("version_no", { ascending: false })
      .limit(1);
    if (versionNo !== undefined) q = q.eq("version_no", versionNo);
    const rows = must(await q, "version by number") as RawVersion[];
    return rows[0] ? toVersion(rows[0]) : null;
  }

  /**
   * FR-5.1 step 1: a new version in status `uploading` with the next `version_no`, and a signed
   * upload URL so the browser sends the PDF straight to Storage (never through Vercel).
   */
  async createVersionUpload(
    paperId: string,
    actorId: string | null,
  ): Promise<{ version: AdminVersion; signedUploadUrl: string; token: string }> {
    const latest = await this.versionByNumber(paperId);
    const versionNo = (latest?.versionNo ?? 0) + 1;
    const id = crypto.randomUUID();
    const row = must(
      await this.db
        .from("paper_versions")
        .insert({
          id,
          paper_id: paperId,
          version_no: versionNo,
          pdf_path: pdfPathFor(paperId, id),
          status: "uploading",
          created_by: actorId,
        })
        .select(VERSION_COLUMNS)
        .single(),
      "create version",
    ) as RawVersion;
    const version = toVersion(row);
    const { data, error } = await this.db.storage
      .from("papers")
      .createSignedUploadUrl(version.pdfPath, { upsert: true });
    if (error || !data) throw new DbError(`signed upload URL: ${error?.message ?? "no data"}`);
    return { version, signedUploadUrl: data.signedUrl, token: data.token };
  }

  /** Size of the uploaded object in bytes, or null when it is missing (FR-5.1 step 3). */
  async uploadedSize(pdfPath: string): Promise<number | null> {
    const slash = pdfPath.lastIndexOf("/");
    const dir = pdfPath.slice(0, slash);
    const name = pdfPath.slice(slash + 1);
    const { data, error } = await this.db.storage.from("papers").list(dir, { search: name });
    if (error) throw new DbError(`storage list: ${error.message}`);
    const obj = data?.find((o) => o.name === name);
    if (!obj) return null;
    const size = (obj.metadata as { size?: number } | null)?.size;
    return typeof size === "number" ? size : 0;
  }

  /**
   * "New version from this one" (ADR-027): published guides are read-only (ADR-009), so fixing one
   * makes v(n+1) with the same PDF (Storage copy), the same pages and the guide as a draft. The new
   * version is `ready` at once: no extraction or drafting runs.
   */
  async cloneVersion(versionId: string, actorId: string | null): Promise<AdminVersion> {
    const src = await this.version(versionId);
    if (!src) throw new NotFoundError(`Version ${versionId}`);
    if (!["ready", "published", "superseded"].includes(src.status))
      throw new DbError("Only an ingested version can be copied.", "version_not_ready");
    const latest = await this.versionByNumber(src.paperId);
    const id = crypto.randomUUID();
    const pdfPath = pdfPathFor(src.paperId, id);
    const copied = await this.db.storage.from("papers").copy(src.pdfPath, pdfPath);
    if (copied.error) throw new DbError(`copy PDF: ${copied.error.message}`);
    const row = must(
      await this.db
        .from("paper_versions")
        .insert({
          id,
          paper_id: src.paperId,
          version_no: (latest?.versionNo ?? src.versionNo) + 1,
          pdf_path: pdfPath,
          pdf_sha256: src.pdfSha256,
          page_count: src.pageCount,
          token_estimate: src.tokenEstimate,
          extractor: src.extractor,
          extraction_warnings: src.warnings,
          status: "ready",
          created_by: actorId,
        })
        .select(VERSION_COLUMNS)
        .single(),
      "copy version",
    ) as RawVersion;
    const pages = await this.pages(versionId);
    for (let i = 0; i < pages.length; i += 50) {
      const res = await this.db
        .from("paper_pages")
        .insert(
          pages.slice(i, i + 50).map((p) => ({ version_id: id, page_no: p.n, text: p.text })),
        );
      if (res.error) throw new DbError(`copy pages: ${res.error.message}`, res.error.code);
    }
    const guide = await this.guide(versionId);
    if (guide) await this.saveGuide(id, guide.guide, { source: "copy" }, actorId);
    return toVersion(row);
  }

  /** Puts a version into `processing` and queues an ingestion job (FR-5.1 step 3, FR-5.5 retry). */
  async queueIngest(versionId: string, extractor?: ExtractorChoice | null): Promise<IngestJob> {
    must(
      await this.db
        .from("paper_versions")
        .update({ status: "processing" })
        .eq("id", versionId)
        .select("id")
        .maybeSingle(),
      `version ${versionId}`,
    );
    return this.insertJob(versionId, "ingest", extractor ?? null);
  }

  /** "Regenerate draft" (FR-6.4): the worker re-drafts the guide from the stored pages. */
  async queueGuideDraft(versionId: string): Promise<IngestJob> {
    return this.insertJob(versionId, "draft_guide", null);
  }

  async job(id: string): Promise<IngestJob | null> {
    const res = await this.db.from("ingest_jobs").select(JOB_COLUMNS).eq("id", id).maybeSingle();
    if (res.error) throw new DbError(`job: ${res.error.message}`, res.error.code);
    return res.data ? toJob(res.data as RawJob) : null;
  }

  async latestJob(versionId: string): Promise<IngestJob | null> {
    const rows = must(
      await this.db
        .from("ingest_jobs")
        .select(JOB_COLUMNS)
        .eq("version_id", versionId)
        .order("created_at", { ascending: false })
        .limit(1),
      "latest job",
    ) as RawJob[];
    return rows[0] ? toJob(rows[0]) : null;
  }

  /** Latest job per version, for the paper page. */
  async latestJobs(versionIds: string[]): Promise<Map<string, IngestJob>> {
    const out = new Map<string, IngestJob>();
    if (!versionIds.length) return out;
    const rows = must(
      await this.db
        .from("ingest_jobs")
        .select(JOB_COLUMNS)
        .in("version_id", versionIds)
        .order("created_at", { ascending: false }),
      "latest jobs",
    ) as RawJob[];
    for (const r of rows) if (!out.has(r.version_id)) out.set(r.version_id, toJob(r));
    return out;
  }

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

  async signedPdfUrl(pdfPath: string, expiresInSeconds = 600): Promise<string | null> {
    const { data, error } = await this.db.storage
      .from("papers")
      .createSignedUrl(pdfPath, expiresInSeconds);
    return error || !data ? null : data.signedUrl;
  }

  // ── Guides (FR-6.4) ──────────────────────────────────────────────

  async guide(versionId: string): Promise<GuideRecord | null> {
    const res = await this.db
      .from("teaching_guides")
      .select("version_id, guide, status, guide_hash, draft_meta, updated_at, approved_at")
      .eq("version_id", versionId)
      .maybeSingle();
    if (res.error) throw new DbError(`guide: ${res.error.message}`, res.error.code);
    const r = res.data as {
      version_id: string;
      guide: unknown;
      status: GuideStatus;
      guide_hash: string;
      draft_meta: GuideDraftMeta | null;
      updated_at: string;
      approved_at: string | null;
    } | null;
    return r
      ? {
          versionId: r.version_id,
          guide: r.guide,
          status: r.status,
          guideHash: r.guide_hash,
          draftMeta: r.draft_meta ?? {},
          updatedAt: r.updated_at,
          approvedAt: r.approved_at,
        }
      : null;
  }

  /**
   * Stores a guide as a draft (editor save, CLI push, model draft). Any change un-approves it and
   * closes the version's open test chats, whose learner state was built from the old objectives.
   */
  async saveGuide(
    versionId: string,
    guide: unknown,
    meta: GuideDraftMeta,
    actorId: string | null,
  ): Promise<GuideRecord> {
    must(
      await this.db
        .from("teaching_guides")
        .upsert(
          {
            version_id: versionId,
            guide: guide ?? {},
            status: "draft",
            guide_hash: guideHash(guide ?? {}),
            draft_meta: meta,
            updated_by: actorId,
            updated_at: new Date().toISOString(),
            approved_at: null,
          },
          { onConflict: "version_id" },
        )
        .select("version_id")
        .single(),
      "save guide",
    );
    await this.closeTestConversations(versionId);
    return (await this.guide(versionId))!;
  }

  /** Callers validate first (schema + page range); approval of an unchanged guide only. */
  async approveGuide(
    versionId: string,
    expectedHash: string,
    actorId: string | null,
  ): Promise<boolean> {
    const rows = must(
      await this.db
        .from("teaching_guides")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
          updated_by: actorId,
        })
        .eq("version_id", versionId)
        .eq("guide_hash", expectedHash)
        .select("version_id"),
      "approve guide",
    ) as unknown[];
    return rows.length > 0;
  }

  /** FR-6.6, atomic in SQL: 'ok' | 'not_found' | 'version_not_ready' | 'guide_not_approved'. */
  async publishVersion(versionId: string): Promise<string> {
    const res = await this.db.rpc("publish_version", { p_version: versionId });
    if (res.error) throw new DbError(`publish: ${res.error.message}`, res.error.code);
    return res.data as string;
  }

  // ── Test as student (FR-6.5) ─────────────────────────────────────

  async closeTestConversations(versionId: string, instructorId?: string): Promise<void> {
    let q = this.db
      .from("conversations")
      .update({ status: "closed", updated_at: new Date().toISOString() })
      .eq("paper_version_id", versionId)
      .eq("is_test", true)
      .eq("status", "active");
    if (instructorId) q = q.eq("student_id", instructorId);
    const res = await q;
    if (res.error) throw new DbError(`close test chats: ${res.error.message}`, res.error.code);
  }

  /** The instructor's own test conversation, if `conversationId` is one (ownership check). */
  async ownTestConversation(instructorId: string, conversationId: string) {
    const res = await this.db
      .from("conversations")
      .select("id, paper_id, paper_version_id, mode, status")
      .eq("id", conversationId)
      .eq("student_id", instructorId)
      .eq("is_test", true)
      .maybeSingle();
    if (res.error) throw new DbError(`test conversation: ${res.error.message}`, res.error.code);
    return res.data as {
      id: string;
      paper_id: string;
      paper_version_id: string;
      mode: string;
      status: "active" | "reset" | "closed";
    } | null;
  }

  // ── Permanent deletion (FR-6.7) ──────────────────────────────────

  async deletionImpact(
    target: { paperId: string } | { versionId: string },
  ): Promise<DeletionImpact> {
    const versionIds =
      "versionId" in target
        ? [target.versionId]
        : (
            must(
              await this.db.from("paper_versions").select("id").eq("paper_id", target.paperId),
              "versions of paper",
            ) as { id: string }[]
          ).map((v) => v.id);
    const convs = versionIds.length
      ? (must(
          await this.db
            .from("conversations")
            .select("id, student_id, is_test")
            .in("paper_version_id", versionIds),
          "affected conversations",
        ) as { id: string; student_id: string; is_test: boolean }[])
      : [];
    let messages = 0;
    if (convs.length) {
      const res = await this.db
        .from("messages")
        .select("id", { head: true, count: "exact" })
        .in(
          "conversation_id",
          convs.map((c) => c.id),
        );
      if (res.error) throw new DbError(`message count: ${res.error.message}`);
      messages = res.count ?? 0;
    }
    const studentIds = [...new Set(convs.filter((c) => !c.is_test).map((c) => c.student_id))];
    let consenting = 0;
    if (studentIds.length) {
      const res = await this.db
        .from("profiles")
        .select("id", { head: true, count: "exact" })
        .in("id", studentIds)
        .eq("role", "student")
        .eq("research_consent", true);
      if (res.error) throw new DbError(`consent count: ${res.error.message}`);
      consenting = res.count ?? 0;
    }
    return {
      versions: versionIds.length,
      files: versionIds.length,
      conversations: convs.length,
      messages,
      students: studentIds.length,
      researchConsentStudents: consenting,
    };
  }

  /** Deletes rows in one SQL transaction, then the Storage files. */
  async deletePaper(paperId: string): Promise<{ files: number }> {
    const paths = must(
      await this.db.rpc("delete_paper", { p_paper: paperId }),
      "delete paper",
    ) as unknown as string[];
    return { files: await this.removeFiles(paths) };
  }

  async deleteVersion(versionId: string): Promise<{ files: number }> {
    const res = await this.db.rpc("delete_paper_version", { p_version: versionId });
    if (res.error) {
      if (res.error.message.includes("current_version"))
        throw new DbError("The paper's current version cannot be deleted.", "current_version");
      throw new DbError(`delete version: ${res.error.message}`, res.error.code);
    }
    return { files: await this.removeFiles((res.data as string[] | null) ?? []) };
  }

  // ── Counts for the paper page ────────────────────────────────────

  /** Real (non-test) conversations per version. */
  async conversationCounts(versionIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!versionIds.length) return out;
    const rows = must(
      await this.db
        .from("conversations")
        .select("paper_version_id")
        .in("paper_version_id", versionIds)
        .eq("is_test", false),
      "conversation counts",
    ) as { paper_version_id: string }[];
    for (const r of rows) out.set(r.paper_version_id, (out.get(r.paper_version_id) ?? 0) + 1);
    return out;
  }

  async logEvent(type: string, actorId: string | null, props: Record<string, unknown>) {
    const res = await this.db.from("events").insert({ student_id: actorId, type, props });
    if (res.error) throw new DbError(`event: ${res.error.message}`, res.error.code);
  }

  // ── Internals ────────────────────────────────────────────────────

  private async insertJob(versionId: string, kind: JobKind, extractor: ExtractorChoice | null) {
    const row = must(
      await this.db
        .from("ingest_jobs")
        .insert({ version_id: versionId, kind, extractor })
        .select(JOB_COLUMNS)
        .single(),
      "queue job",
    ) as RawJob;
    return toJob(row);
  }

  private async nextPosition(table: "modules" | "papers", moduleId?: string): Promise<number> {
    let q = this.db.from(table).select("position").order("position", { ascending: false }).limit(1);
    if (moduleId) q = q.eq("module_id", moduleId);
    const rows = must(await q, `${table} position`) as { position: number }[];
    return rows[0] ? rows[0].position + 1 : 0;
  }

  private async reorder(table: "modules" | "papers", ids: string[], moduleId?: string) {
    const now = new Date().toISOString();
    for (const [position, id] of ids.entries()) {
      let q = this.db.from(table).update({ position, updated_at: now }).eq("id", id);
      if (moduleId) q = q.eq("module_id", moduleId);
      const res = await q;
      if (res.error) throw new DbError(`reorder ${table}: ${res.error.message}`, res.error.code);
    }
  }

  private async removeFiles(paths: string[]): Promise<number> {
    if (!paths.length) return 0;
    const { data, error } = await this.db.storage.from("papers").remove(paths);
    if (error) throw new DbError(`remove files: ${error.message}`);
    return data?.length ?? 0;
  }
}
