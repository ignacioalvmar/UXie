import { validateGuide, type GuideIssue } from "@uxie/core";
import type {
  AdminRepo,
  AdminVersion,
  GuideDraftMeta,
  GuideRecord,
  IngestJob,
} from "./repos/admin";

/**
 * Content rules shared by the admin API and the CLI (FR-6.3–6.6, ADR-027). Every function
 * returns a refusal code instead of throwing for rule violations, so both callers can show the
 * same messages (HTTP status mapping lives in apps/web/lib/admin).
 */

export type Refusal =
  | "not_found"
  | "version_locked"
  | "version_not_ready"
  | "guide_missing"
  | "guide_invalid"
  | "guide_changed"
  | "guide_not_approved"
  | "job_running";

export type ContentResult<T = object> =
  ({ ok: true } & T) | { ok: false; code: Refusal; message: string; issues?: GuideIssue[] };

const refuse = (code: Refusal, message: string, issues?: GuideIssue[]) =>
  ({ ok: false, code, message, ...(issues ? { issues } : {}) }) as const;

/**
 * Guides are edited only while the version is `ready` (not yet published). Published and
 * superseded versions are immutable (ADR-009): conversations depend on them.
 */
export const guideEditable = (v: Pick<AdminVersion, "status">) => v.status === "ready";

const LOCKED =
  "This version is published (or superseded), so its guide is read-only. Make a new version from it to change the guide.";

export async function saveGuideChecked(
  repo: AdminRepo,
  input: {
    versionId: string;
    guide: unknown;
    source: NonNullable<GuideDraftMeta["source"]>;
    actorId: string | null;
  },
): Promise<ContentResult<{ guide: GuideRecord; issues: GuideIssue[] }>> {
  const version = await repo.version(input.versionId);
  if (!version) return refuse("not_found", "Version not found.");
  if (!guideEditable(version)) return refuse("version_locked", LOCKED);
  if (typeof input.guide !== "object" || input.guide === null || Array.isArray(input.guide))
    return refuse("guide_invalid", "The guide must be a YAML mapping (key: value).");
  const { issues } = validateGuide(input.guide, version.pageCount ?? undefined);
  const guide = await repo.saveGuide(
    input.versionId,
    input.guide,
    { source: input.source, issues },
    input.actorId,
  );
  return { ok: true, guide, issues };
}

/** FR-6.4 "Approve": only a schema-valid guide whose page refs exist, and only the one shown. */
export async function approveGuideChecked(
  repo: AdminRepo,
  input: { versionId: string; actorId: string | null; expectedHash?: string },
): Promise<ContentResult<{ guide: GuideRecord }>> {
  const version = await repo.version(input.versionId);
  if (!version) return refuse("not_found", "Version not found.");
  if (!guideEditable(version)) return refuse("version_locked", LOCKED);
  const record = await repo.guide(input.versionId);
  if (!record) return refuse("guide_missing", "This version has no teaching guide yet.");
  const v = validateGuide(record.guide, version.pageCount ?? undefined);
  if (!v.ok) return refuse("guide_invalid", "Fix the guide before approving it.", v.issues);
  const hash = input.expectedHash ?? record.guideHash;
  if (!(await repo.approveGuide(input.versionId, hash, input.actorId)))
    return refuse("guide_changed", "The guide changed since you loaded it. Reload and try again.");
  return { ok: true, guide: (await repo.guide(input.versionId))! };
}

const PUBLISH_MESSAGE: Record<string, [Refusal, string]> = {
  not_found: ["not_found", "Version not found."],
  version_not_ready: ["version_not_ready", "Only a ready version can be published."],
  guide_not_approved: ["guide_not_approved", "Approve the teaching guide before publishing."],
};

/**
 * FR-6.6: requires a `ready` version and an approved, valid guide. The SQL function repeats the
 * status checks inside the transaction that switches versions.
 */
export async function publishChecked(
  repo: AdminRepo,
  versionId: string,
): Promise<ContentResult<{ version: AdminVersion }>> {
  const version = await repo.version(versionId);
  if (!version) return refuse("not_found", "Version not found.");
  if (version.status !== "ready") return refuse(...PUBLISH_MESSAGE.version_not_ready!);
  const record = await repo.guide(versionId);
  if (!record || record.status !== "approved")
    return refuse(...PUBLISH_MESSAGE.guide_not_approved!);
  const v = validateGuide(record.guide, version.pageCount ?? undefined);
  if (!v.ok) return refuse("guide_invalid", "The approved guide does not validate.", v.issues);
  const code = await repo.publishVersion(versionId);
  if (code !== "ok") {
    const [c, m] = PUBLISH_MESSAGE[code] ?? ["version_not_ready", `Publishing refused (${code}).`];
    return refuse(c, m);
  }
  return { ok: true, version: (await repo.version(versionId))! };
}

const busy = (job: IngestJob | null) => job?.status === "queued" || job?.status === "running";

/** FR-6.4 "Regenerate draft" (overwrites the draft; the UI confirms first). */
export async function regenerateChecked(
  repo: AdminRepo,
  versionId: string,
): Promise<ContentResult<{ job: IngestJob }>> {
  const version = await repo.version(versionId);
  if (!version) return refuse("not_found", "Version not found.");
  if (!guideEditable(version)) return refuse("version_locked", LOCKED);
  if (busy(await repo.latestJob(versionId)))
    return refuse("job_running", "A job for this version is still running.");
  return { ok: true, job: await repo.queueGuideDraft(versionId) };
}

/** FR-5.5: re-run ingestion of a failed version, optionally with the other extractor. */
export async function retryIngestChecked(
  repo: AdminRepo,
  versionId: string,
  extractor: "unpdf" | "docling" | null,
): Promise<ContentResult<{ job: IngestJob }>> {
  const version = await repo.version(versionId);
  if (!version) return refuse("not_found", "Version not found.");
  if (version.status !== "failed")
    return refuse("version_not_ready", "Only a failed version can be ingested again.");
  if (busy(await repo.latestJob(versionId)))
    return refuse("job_running", "A job for this version is still running.");
  return { ok: true, job: await repo.queueIngest(versionId, extractor) };
}
