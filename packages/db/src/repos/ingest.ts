import type { ExtractionWarning, GuideIssue, Page } from "@uxie/core";
import { DbError, must, NotFoundError, type Db } from "../client";
import { AdminRepo, type ExtractorChoice, type IngestJob, type JobKind } from "./admin";

/**
 * Background ingestion on Supabase (FR-5.1, ADR-010, ADR-027): the job queue used by
 * apps/worker and the `IngestStore` port of packages/ingest, matched structurally because
 * packages/db may not import packages/ingest (PRD §4.3). apps/worker type-checks the match.
 */

export interface ClaimedJob {
  id: string;
  versionId: string;
  kind: JobKind;
  attempts: number;
  extractor: ExtractorChoice | null;
}

export class IngestQueue {
  constructor(private readonly db: Db) {}

  /** `claim_ingest_job()`: one queued job, atomically set `running` (FOR UPDATE SKIP LOCKED). */
  async claim(): Promise<ClaimedJob | null> {
    const res = await this.db.rpc("claim_ingest_job");
    if (res.error) throw new DbError(`claim job: ${res.error.message}`, res.error.code);
    const row = (
      res.data as {
        id: string;
        version_id: string;
        kind: JobKind;
        attempts: number;
        extractor: ExtractorChoice | null;
      }[]
    )[0];
    return row
      ? {
          id: row.id,
          versionId: row.version_id,
          kind: row.kind,
          attempts: row.attempts,
          extractor: row.extractor,
        }
      : null;
  }

  async succeed(jobId: string): Promise<void> {
    await this.finish(jobId, { status: "succeeded", error: null });
  }

  async fail(jobId: string, error: string): Promise<void> {
    await this.finish(jobId, { status: "failed", error: error.slice(0, 2000) });
  }

  /** An infrastructure error with attempts left: back to the queue for the next poll. */
  async requeue(jobId: string, error: string): Promise<void> {
    const res = await this.db
      .from("ingest_jobs")
      .update({ status: "queued", error: error.slice(0, 2000), started_at: null })
      .eq("id", jobId);
    if (res.error) throw new DbError(`requeue job: ${res.error.message}`, res.error.code);
  }

  /** Jobs running longer than the timeout go back to the queue, or fail after `maxAttempts`. */
  async requeueStale(timeoutMs: number, maxAttempts = 2): Promise<number> {
    const res = await this.db.rpc("requeue_stale_ingest_jobs", {
      p_timeout_ms: timeoutMs,
      p_max_attempts: maxAttempts,
    });
    if (res.error) throw new DbError(`requeue stale: ${res.error.message}`, res.error.code);
    return (res.data as number | null) ?? 0;
  }

  /** FR-9.5: the worker upserts its heartbeat on every poll. */
  async heartbeat(name: string, meta: Record<string, unknown> = {}): Promise<void> {
    const res = await this.db
      .from("worker_heartbeats")
      .upsert({ name, last_seen_at: new Date().toISOString(), meta }, { onConflict: "name" });
    if (res.error) throw new DbError(`heartbeat: ${res.error.message}`, res.error.code);
  }

  async job(id: string): Promise<IngestJob | null> {
    return new AdminRepo(this.db).job(id);
  }

  private async finish(jobId: string, patch: { status: string; error: string | null }) {
    const res = await this.db
      .from("ingest_jobs")
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq("id", jobId);
    if (res.error) throw new DbError(`finish job: ${res.error.message}`, res.error.code);
  }
}

/** Insert pages in batches so long papers stay under request size limits. */
const PAGE_BATCH = 50;

/**
 * IngestStore (packages/ingest/pipeline.ts) for one claimed job. The paper title entered by the
 * instructor wins over the PDF's metadata.
 */
export class SupabaseIngestStore {
  private readonly admin: AdminRepo;

  constructor(
    private readonly db: Db,
    private readonly jobId: string,
  ) {
    this.admin = new AdminRepo(db);
  }

  async loadSource(versionId: string): Promise<{ pdf: Uint8Array; title?: string }> {
    const version = await this.admin.version(versionId);
    if (!version) throw new NotFoundError(`Version ${versionId}`);
    const paper = await this.admin.paper(version.paperId);
    const { data, error } = await this.db.storage.from("papers").download(version.pdfPath);
    if (error || !data) throw new DbError(`download ${version.pdfPath}: ${error?.message}`);
    return {
      pdf: new Uint8Array(await data.arrayBuffer()),
      ...(paper ? { title: paper.title } : {}),
    };
  }

  /** The pages and references start of an ingested version (Regenerate draft, FR-6.4). */
  async loadExtracted(versionId: string): Promise<{
    title: string;
    pages: Page[];
    referencesStartPage: number | null;
  }> {
    const version = await this.admin.version(versionId);
    if (!version) throw new NotFoundError(`Version ${versionId}`);
    const paper = await this.admin.paper(version.paperId);
    const pages = await this.admin.pages(versionId);
    const refs = version.warnings.find((w) => w.kind === "references_start");
    return { title: paper?.title ?? "", pages, referencesStartPage: refs?.page ?? null };
  }

  async setStep(_versionId: string, step: string): Promise<void> {
    const res = await this.db.from("ingest_jobs").update({ step }).eq("id", this.jobId);
    if (res.error) throw new DbError(`job step: ${res.error.message}`, res.error.code);
  }

  async saveExtraction(
    versionId: string,
    e: {
      sha256: string;
      extractor: string;
      pageCount: number;
      tokenEstimate: number;
      pages: Page[];
      warnings: ExtractionWarning[];
    },
  ): Promise<void> {
    // A re-run (retry, other extractor) replaces the pages of the earlier attempt.
    const del = await this.db.from("paper_pages").delete().eq("version_id", versionId);
    if (del.error) throw new DbError(`clear pages: ${del.error.message}`, del.error.code);
    for (let i = 0; i < e.pages.length; i += PAGE_BATCH) {
      const batch = e.pages
        .slice(i, i + PAGE_BATCH)
        .map((p) => ({ version_id: versionId, page_no: p.n, text: p.text }));
      const res = await this.db.from("paper_pages").insert(batch);
      if (res.error) throw new DbError(`insert pages: ${res.error.message}`, res.error.code);
    }
    must(
      await this.db
        .from("paper_versions")
        .update({
          pdf_sha256: e.sha256,
          extractor: e.extractor,
          page_count: e.pageCount,
          token_estimate: e.tokenEstimate,
          extraction_warnings: e.warnings,
        })
        .eq("id", versionId)
        .select("id")
        .maybeSingle(),
      `version ${versionId}`,
    );
  }

  /**
   * Saves the model's draft with its issues (FR-5.4). When drafting failed outright (`guide`
   * null) an existing guide is kept and only the issues are recorded.
   */
  async saveGuideDraft(
    versionId: string,
    d: {
      guide: Record<string, unknown> | null;
      issues: GuideIssue[];
      promptVersion: string;
      model: string;
    },
  ): Promise<void> {
    const meta = {
      source: "draft" as const,
      prompt_version: d.promptVersion,
      model: d.model,
      issues: d.issues,
    };
    if (d.guide) {
      await this.admin.saveGuide(versionId, d.guide, meta, null);
      return;
    }
    const existing = await this.admin.guide(versionId);
    if (existing) {
      const res = await this.db
        .from("teaching_guides")
        .update({ draft_meta: meta })
        .eq("version_id", versionId);
      if (res.error) throw new DbError(`guide meta: ${res.error.message}`, res.error.code);
    } else {
      await this.admin.saveGuide(versionId, {}, meta, null);
    }
  }

  async markReady(versionId: string): Promise<void> {
    await this.setVersionStatus(versionId, "ready");
  }

  async markFailed(versionId: string, _error: string): Promise<void> {
    // The message itself is stored on the job (`ingest_jobs.error`), shown on the paper page.
    await this.setVersionStatus(versionId, "failed");
  }

  private async setVersionStatus(versionId: string, status: "ready" | "failed") {
    // Only an ingesting version changes; a published version is never moved back.
    const res = await this.db
      .from("paper_versions")
      .update({ status })
      .eq("id", versionId)
      .in("status", ["processing", "failed", "uploading"]);
    if (res.error) throw new DbError(`version status: ${res.error.message}`, res.error.code);
  }
}
