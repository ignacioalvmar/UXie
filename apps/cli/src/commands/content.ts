import { readFileSync, writeFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { formatGuideIssues, parseEnv, ServerEnvSchema, validateGuide } from "@uxie/core";
import {
  AdminRepo,
  approveGuideChecked,
  createServiceClient,
  publishChecked,
  saveGuideChecked,
  type AdminPaper,
  type AdminVersion,
  type ContentResult,
} from "@uxie/db";
import { guideToYaml } from "@uxie/ingest";
import { userPath } from "../paths";

/**
 * Content commands (PRD §10.10, FR-6.2/6.4/6.6): `guide pull|push|approve`, `publish`, `retire`.
 * They use the same rules as the admin pages (`packages/db/src/content.ts`) on the secret key;
 * events are logged without an actor (operator CLI).
 */

export interface VersionOption {
  version?: string;
}

function repo() {
  const env = parseEnv(ServerEnvSchema, process.env);
  return new AdminRepo(createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY));
}

async function paperAndVersion(
  admin: AdminRepo,
  slug: string,
  opts: VersionOption,
  pick: (versions: AdminVersion[]) => AdminVersion | undefined = (v) => v[0],
): Promise<{ paper: AdminPaper; version: AdminVersion }> {
  const paper = await admin.paperBySlug(slug);
  if (!paper) throw new Error(`No paper with slug "${slug}".`);
  let version: AdminVersion | undefined | null;
  if (opts.version !== undefined) {
    const n = Number(opts.version);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--version must be a positive integer.`);
    version = await admin.versionByNumber(paper.id, n);
    if (!version) throw new Error(`${slug} has no version ${n}.`);
  } else {
    version = pick(await admin.versions(paper.id));
    if (!version) throw new Error(`${slug} has no suitable version. Upload a PDF first.`);
  }
  return { paper, version };
}

function report<T extends object>(result: ContentResult<T>): asserts result is { ok: true } & T {
  if (!result.ok) {
    const issues = result.issues?.length ? `\n${formatGuideIssues(result.issues)}` : "";
    throw new Error(`${result.message}${issues}`);
  }
}

/** `guide pull <paper> [--version n] [--out file]`: the guide as YAML (default: newest version). */
export async function guidePullCommand(slug: string, opts: VersionOption & { out?: string }) {
  const admin = repo();
  const { paper, version } = await paperAndVersion(admin, slug, opts);
  const record = await admin.guide(version.id);
  if (!record) throw new Error(`${slug} v${version.versionNo} has no teaching guide yet.`);
  const { issues } = validateGuide(record.guide, version.pageCount ?? undefined);
  const yaml = guideToYaml(record.guide, {
    issues,
    header: [
      `Teaching guide: ${paper.title} (${slug} v${version.versionNo}, ${version.pageCount ?? "?"} pages)`,
      `Status: ${record.status}${record.status === "approved" ? "" : " — run `pnpm uxie guide approve` after pushing"}`,
    ],
  });
  if (opts.out) {
    writeFileSync(userPath(opts.out), yaml);
    console.error(`Wrote ${opts.out} (${slug} v${version.versionNo}, ${record.status}).`);
  } else process.stdout.write(yaml);
}

/** `guide push <paper> <file> [--version n]`: validate and save as a draft (default: newest version). */
export async function guidePushCommand(slug: string, file: string, opts: VersionOption) {
  const admin = repo();
  const { version } = await paperAndVersion(admin, slug, opts);
  const doc = parseDocument(readFileSync(userPath(file), "utf8"), { uniqueKeys: true });
  if (doc.errors.length) throw new Error(`${file}: ${doc.errors[0]!.message}`);
  const result = await saveGuideChecked(admin, {
    versionId: version.id,
    guide: doc.toJS(),
    source: "cli",
    actorId: null,
  });
  report(result);
  await admin.logEvent("guide_pushed", null, { version_id: version.id });
  if (result.issues.length) {
    console.log(
      `Saved as a draft on ${slug} v${version.versionNo}, with issues to fix before approving:`,
    );
    console.log(formatGuideIssues(result.issues));
    process.exitCode = 1;
  } else {
    console.log(
      `Saved on ${slug} v${version.versionNo}. It validates; approve with \`pnpm uxie guide approve ${slug}\`.`,
    );
  }
}

/** `guide approve <paper> [--version n]` (FR-6.4): only a guide that validates. */
export async function guideApproveCommand(slug: string, opts: VersionOption) {
  const admin = repo();
  const { version } = await paperAndVersion(admin, slug, opts);
  const result = await approveGuideChecked(admin, { versionId: version.id, actorId: null });
  report(result);
  await admin.logEvent("guide_approved", null, { version_id: version.id });
  console.log(`Approved the guide of ${slug} v${version.versionNo}.`);
}

/** `publish <paper> [--version n]` (FR-6.6): default is the newest `ready` version. */
export async function publishCommand(slug: string, opts: VersionOption) {
  const admin = repo();
  const { paper, version } = await paperAndVersion(admin, slug, opts, (vs) =>
    vs.find((v) => v.status === "ready"),
  );
  const previous = paper.currentVersionId;
  const result = await publishChecked(admin, version.id);
  report(result);
  await admin.logEvent("version_published", null, {
    paper_id: paper.id,
    version_id: version.id,
    version_no: version.versionNo,
  });
  console.log(
    `Published ${slug} v${version.versionNo}.` +
      (previous && previous !== version.id ? " The previous version is now superseded." : ""),
  );
}

/** `retire <paper> [--undo]` (FR-6.2): no new conversations; history stays readable. */
export async function retireCommand(slug: string, opts: { undo?: boolean }) {
  const admin = repo();
  const paper = await admin.paperBySlug(slug);
  if (!paper) throw new Error(`No paper with slug "${slug}".`);
  const updated = await admin.setRetired(paper.id, !opts.undo);
  await admin.logEvent(opts.undo ? "paper_unretired" : "paper_retired", null, {
    paper_id: paper.id,
  });
  console.log(`${slug} is now ${updated.status}.`);
}
