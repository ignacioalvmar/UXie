import { writeFileSync } from "node:fs";
import {
  classReportMarkdown,
  ExportFormat,
  monthOf,
  parseEnv,
  ServerEnvSchema,
  usageReportMarkdown,
} from "@uxie/core";
import { AdminRepo, buildExport, createServiceClient, DataRightsRepo, ReviewRepo } from "@uxie/db";
import { userPath } from "../paths";

/**
 * Review, reporting and lifecycle commands (PRD §10.10, FR-7.2–7.4, FR-8.4): `report`, `costs`,
 * `export`, `purge`. Same repositories as the admin pages, on the secret key (operator CLI).
 */

function context() {
  const env = parseEnv(ServerEnvSchema, process.env);
  const db = createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  return { env, db, review: new ReviewRepo(db), admin: new AdminRepo(db) };
}

function output(text: string, out?: string) {
  if (!out) {
    process.stdout.write(text);
    return;
  }
  writeFileSync(userPath(out), text);
  console.error(`Wrote ${out}`);
}

/** `report <paper> [--named] [--out file]` → class report as Markdown (FR-7.2). */
export async function reportCommand(slug: string, opts: { named?: boolean; out?: string }) {
  const { review, admin } = context();
  const paper = await admin.paperBySlug(slug);
  if (!paper) throw new Error(`No paper with slug "${slug}".`);
  let report = (await review.classReport(paper.id))!;
  if (opts.named) {
    // Operator-only: names and emails never appear in the web report.
    const names = await review.namesFor(report.students.map((s) => s.pseudonymId));
    report = (await review.classReport(paper.id, { names }))!;
    console.error("Named report: contains personal data. Do not share it.");
  }
  output(classReportMarkdown(report), opts.out);
}

/** `costs [--month YYYY-MM] [--out file]` → usage & cost summary (FR-7.4). */
export async function costsCommand(opts: { month?: string; out?: string }) {
  const { env, review } = context();
  const month = opts.month ?? monthOf(new Date());
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("--month must look like 2026-10.");
  output(usageReportMarkdown(await review.usage(month, env.MONTHLY_SPEND_CEILING_EUR)), opts.out);
}

/** `export [--paper p] [--research] --format csv|json --out file` (FR-7.3), logged. */
export async function exportCommand(opts: {
  paper?: string;
  research?: boolean;
  format: string;
  out: string;
}) {
  const format = ExportFormat.safeParse(opts.format);
  if (!format.success) throw new Error("--format must be csv or json.");
  const { review, admin } = context();
  let paperId: string | undefined;
  if (opts.paper) {
    const paper = await admin.paperBySlug(opts.paper);
    if (!paper) throw new Error(`No paper with slug "${opts.paper}".`);
    paperId = paper.id;
  }
  const file = await buildExport(review, {
    filters: paperId ? { paperId } : {},
    format: format.data,
    researchOnly: Boolean(opts.research),
    instructorId: null,
    channel: "cli",
  });
  writeFileSync(userPath(opts.out), file.body);
  await admin.logEvent("export", null, {
    format: format.data,
    research_only: Boolean(opts.research),
    rows: file.rowCount,
    channel: "cli",
  });
  console.error(
    `Wrote ${file.rowCount} rows to ${opts.out}${opts.research ? " (research export: consenting students only)" : ""}. Logged in export_log.`,
  );
}

/** `purge --before <date> [--dry-run]` (FR-8.4): conversations last active before the date. */
export async function purgeCommand(opts: { before: string; dryRun?: boolean }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.before) || Number.isNaN(Date.parse(opts.before)))
    throw new Error("--before must be a date like 2026-03-31.");
  const before = new Date(`${opts.before}T00:00:00Z`);
  if (before.getTime() > Date.now()) throw new Error("--before must not be in the future.");
  const { db, admin } = context();
  const rights = new DataRightsRepo(db);
  const counts = await rights.purge(before, Boolean(opts.dryRun));
  const what = `${counts.conversations} conversations (${counts.messages} messages, ${counts.feedback} feedback) of ${counts.students} students, last active before ${opts.before}`;
  if (opts.dryRun) {
    console.log(`Dry run: would delete ${what}. Model-call cost totals are kept.`);
    return;
  }
  await admin.logEvent("retention_purge", null, { before: opts.before, ...counts });
  console.log(`Deleted ${what}. Model-call cost totals were kept without the conversation link.`);
}
