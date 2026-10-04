import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { PagesFileSchema, TeachingGuideSchema } from "@uxie/core";
import {
  AdminRepo,
  approveGuideChecked,
  createServiceClient,
  IngestQueue,
  publishChecked,
  regenerateChecked,
  saveGuideChecked,
  StudentViewsRepo,
  SupabaseConversationRepo,
  SupabaseIngestStore,
  type AdminPaper,
  type Db,
} from "../src";
import { SEED_USERS } from "../scripts/seedData";

/** M8: content management against the local stack (PRD §16 M8 acceptance, FR-5.1, FR-6.1–6.7). */

const fixture = (f: string) =>
  new URL(`../../../fixtures/papers/visible-cues/${f}`, import.meta.url);
const pdf = readFileSync(fixture("source.pdf"));
const pagesFile = PagesFileSchema.parse(JSON.parse(readFileSync(fixture("pages.json"), "utf8")));
const fixtureGuide = parseYaml(readFileSync(fixture("guide.yaml"), "utf8")) as Record<
  string,
  unknown
>;

const [INSTRUCTOR, A] = SEED_USERS;
const run = Date.now().toString(36);
let db: Db;
let repo: AdminRepo;
let moduleA: string;
let moduleB: string;
let paper: AdminPaper;

beforeAll(async () => {
  db = createServiceClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SECRET_KEY!);
  repo = new AdminRepo(db);
  moduleA = (await repo.createModule({ slug: `m8-a-${run}`, title: "M8 module A" })).id;
  moduleB = (await repo.createModule({ slug: `m8-b-${run}`, title: "M8 module B" })).id;
  await repo.updateModule(moduleA, { status: "published" });
  await repo.updateModule(moduleB, { status: "published" });
  paper = await repo.createPaper({
    moduleId: moduleA,
    slug: `m8-paper-${run}`,
    title: "Visible Cues (M8 test)",
    authors: ["A. Fixture"],
    year: 2026,
  });
});

afterAll(async () => {
  for (const p of await repo.papers()) if (p.slug.endsWith(run)) await repo.deletePaper(p.id);
  await db.from("modules").delete().in("id", [moduleA, moduleB]);
});

/** FR-5.1 steps 1–3 for real (signed upload URL + PUT), step 4 simulated with the store. */
async function uploadAndIngest(guide: unknown = fixtureGuide) {
  const { version, signedUploadUrl } = await repo.createVersionUpload(paper.id, INSTRUCTOR!.id);
  expect(version.status).toBe("uploading");
  const put = await fetch(signedUploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/pdf" },
    body: pdf,
  });
  expect(put.ok).toBe(true);
  expect(await repo.uploadedSize(version.pdfPath)).toBe(pdf.byteLength);
  const job = await repo.queueIngest(version.id);
  expect(job).toMatchObject({ status: "queued", kind: "ingest" });

  const claimed = await new IngestQueue(db).claim();
  expect(claimed).toMatchObject({ id: job.id, versionId: version.id, attempts: 1 });
  const store = new SupabaseIngestStore(db, job.id);
  const source = await store.loadSource(version.id);
  expect(source.pdf.byteLength).toBe(pdf.byteLength);
  expect(source.title).toBe(paper.title);
  await store.setStep(version.id, "extract");
  await store.saveExtraction(version.id, {
    sha256: "test",
    extractor: "unpdf",
    pageCount: pagesFile.pages.length,
    tokenEstimate: 2000,
    pages: pagesFile.pages,
    warnings: pagesFile.warnings,
  });
  await store.saveGuideDraft(version.id, {
    guide: guide as Record<string, unknown>,
    issues: [],
    promptVersion: "guide_draft@test",
    model: "mock",
  });
  await store.markReady(version.id);
  await new IngestQueue(db).succeed(job.id);
  return (await repo.version(version.id))!;
}

async function approveAndPublish(versionId: string) {
  expect((await approveGuideChecked(repo, { versionId, actorId: INSTRUCTOR!.id })).ok).toBe(true);
  const published = await publishChecked(repo, versionId);
  expect(published.ok).toBe(true);
}

async function studentConversation(versionId: string, studentId: string) {
  const guide = TeachingGuideSchema.parse(fixtureGuide);
  return new SupabaseConversationRepo(db).create({
    studentId,
    paperId: paper.id,
    paperVersionId: versionId,
    moduleId: moduleA,
    moduleTitle: "M8 module A",
    guide,
  });
}

describe("M8 acceptance", () => {
  let v1: string;
  let v1Conversation: string;

  it("FR-5.1 upload → ingest job → ready version with pages, warnings and a draft guide", async () => {
    const v = await uploadAndIngest();
    v1 = v.id;
    expect(v).toMatchObject({ versionNo: 1, status: "ready", pageCount: 7, guideStatus: "draft" });
    expect(v.warnings.some((w) => w.kind === "references_start")).toBe(true);
    expect(await repo.pages(v1)).toHaveLength(7);
    const job = await repo.latestJob(v1);
    expect(job).toMatchObject({ status: "succeeded", step: "extract" });
  });

  it("FR-6.6 publishing is blocked without an approved, valid guide", async () => {
    expect(await publishChecked(repo, v1)).toMatchObject({ ok: false, code: "guide_not_approved" });
    // An invalid edit cannot be approved, and saving any edit un-approves.
    const broken = { ...fixtureGuide, starter_questions: ["only one"] };
    const saved = await saveGuideChecked(repo, {
      versionId: v1,
      guide: broken,
      source: "editor",
      actorId: INSTRUCTOR!.id,
    });
    expect(saved.ok && saved.issues.map((i) => i.path)).toEqual(["starter_questions"]);
    expect(await approveGuideChecked(repo, { versionId: v1, actorId: null })).toMatchObject({
      ok: false,
      code: "guide_invalid",
    });
    // Page references beyond the paper are invalid too.
    const objectives = (fixtureGuide.objectives as { refs: { page: number }[] }[]).map((o, i) =>
      i === 0 ? { ...o, refs: [{ page: 99 }] } : o,
    );
    await saveGuideChecked(repo, {
      versionId: v1,
      guide: { ...fixtureGuide, objectives },
      source: "editor",
      actorId: null,
    });
    const refused = await approveGuideChecked(repo, { versionId: v1, actorId: null });
    expect(!refused.ok && refused.issues?.[0]?.message).toMatch(/page 99 does not exist/);
    // A stale approval (guide changed since it was loaded) is refused.
    await saveGuideChecked(repo, {
      versionId: v1,
      guide: fixtureGuide,
      source: "editor",
      actorId: null,
    });
    expect(
      await approveGuideChecked(repo, { versionId: v1, actorId: null, expectedHash: "stale" }),
    ).toMatchObject({ ok: false, code: "guide_changed" });

    await approveAndPublish(v1);
    const after = await repo.paper(paper.id);
    expect(after).toMatchObject({ status: "published", currentVersionId: v1 });
    expect((await repo.version(v1))!.status).toBe("published");
  });

  it("published guides are read-only; a copy makes an editable next version (ADR-027)", async () => {
    expect(
      await saveGuideChecked(repo, {
        versionId: v1,
        guide: fixtureGuide,
        source: "cli",
        actorId: null,
      }),
    ).toMatchObject({ ok: false, code: "version_locked" });
    expect(await regenerateChecked(repo, v1)).toMatchObject({ ok: false, code: "version_locked" });
    const copy = await repo.cloneVersion(v1, INSTRUCTOR!.id);
    expect(copy).toMatchObject({ versionNo: 2, status: "ready", pageCount: 7 });
    expect(await repo.pages(copy.id)).toHaveLength(7);
    expect((await repo.guide(copy.id))!.status).toBe("draft");
    expect(await repo.uploadedSize(copy.pdfPath)).toBe(pdf.byteLength);
    // Not needed further: delete it (not the current version, so allowed).
    expect(await repo.deleteVersion(copy.id)).toEqual({ files: 1 });
  });

  it("replacing a PDF creates the next version; v1 conversations stay on v1; new ones use the new version", async () => {
    v1Conversation = (await studentConversation(v1, A!.id)).id;
    const v3 = await uploadAndIngest();
    // The deleted copy freed number 2 (next = highest existing + 1).
    expect(v3.versionNo).toBe(2);
    await approveAndPublish(v3.id);

    expect((await repo.version(v1))!.status).toBe("superseded");
    expect((await repo.paper(paper.id))!.currentVersionId).toBe(v3.id);
    const conv = await new SupabaseConversationRepo(db).get(v1Conversation);
    expect(conv).toMatchObject({ paperVersionId: v1, status: "active" });
    // The student can still read v1 (own conversation) and opens new conversations on v3.
    const views = new StudentViewsRepo(db);
    expect(await views.studentCanReadVersion(A!.id, v1)).toBe(true);
    const visible = await views.visiblePaperBySlug(paper.slug);
    expect(visible!.paper.currentVersionId).toBe(v3.id);
  });

  it("moving a paper keeps module_title_at_start on old conversations", async () => {
    const moved = await repo.movePaper(paper.id, moduleB);
    expect(moved.moduleId).toBe(moduleB);
    const { data } = await db
      .from("conversations")
      .select("module_id_at_start, module_title_at_start")
      .eq("id", v1Conversation)
      .single();
    expect(data).toEqual({ module_id_at_start: moduleA, module_title_at_start: "M8 module A" });
    const views = new StudentViewsRepo(db);
    expect((await views.publishedPapers([moduleB])).map((p) => p.id)).toContain(paper.id);
  });

  it("retired: not in the library, history still visible; un-retire restores it", async () => {
    await repo.setRetired(paper.id, true);
    const views = new StudentViewsRepo(db);
    expect((await views.publishedPapers([moduleB])).map((p) => p.id)).not.toContain(paper.id);
    const visible = await views.visiblePaperBySlug(paper.slug);
    expect(visible?.paper.status).toBe("retired");
    expect((await views.ownConversation(A!.id, v1Conversation))?.id).toBe(v1Conversation);
    expect((await repo.setRetired(paper.id, false)).status).toBe("published");
  });

  it("FR-6.7 deletion impact counts versions, conversations, messages and consenting students", async () => {
    await new SupabaseConversationRepo(db).insertStudentMessage({
      conversationId: v1Conversation,
      clientMessageId: crypto.randomUUID(),
      role: "student",
      event: null,
      content: "hello",
      mode: "understand",
    });
    await db.from("profiles").update({ research_consent: true }).eq("id", A!.id);
    try {
      const impact = await repo.deletionImpact({ paperId: paper.id });
      expect(impact).toEqual({
        versions: 2,
        files: 2,
        conversations: 1,
        messages: 1,
        students: 1,
        researchConsentStudents: 1,
      });
      expect(await repo.deletionImpact({ versionId: v1 })).toMatchObject({
        versions: 1,
        students: 1,
      });
    } finally {
      await db.from("profiles").update({ research_consent: false }).eq("id", A!.id);
    }
  });

  it("the current version cannot be deleted alone; deleting the paper removes rows and files", async () => {
    const current = (await repo.paper(paper.id))!.currentVersionId!;
    await expect(repo.deleteVersion(current)).rejects.toMatchObject({ code: "current_version" });
    const paths = (await repo.versions(paper.id)).map((v) => v.pdfPath);
    expect(await repo.deletePaper(paper.id)).toEqual({ files: 2 });
    expect(await repo.paper(paper.id)).toBeNull();
    const { count } = await db
      .from("conversations")
      .select("id", { head: true, count: "exact" })
      .eq("id", v1Conversation);
    expect(count).toBe(0);
    for (const p of paths) expect(await repo.uploadedSize(p)).toBeNull();
  });
});

describe("FR-5.1 step 4 stale jobs and heartbeat", () => {
  it("re-queues a job running too long, then fails it and its version after 2 attempts", async () => {
    const p = await repo.createPaper({
      moduleId: moduleA,
      slug: `m8-stale-${run}`,
      title: "Stale job paper",
      authors: [],
      year: null,
    });
    const { version } = await repo.createVersionUpload(p.id, null);
    const job = await repo.queueIngest(version.id);
    const queue = new IngestQueue(db);
    const old = new Date(Date.now() - 60 * 60_000).toISOString();

    await db
      .from("ingest_jobs")
      .update({ status: "running", started_at: old, attempts: 1 })
      .eq("id", job.id);
    expect(await queue.requeueStale(900_000)).toBe(1);
    expect((await repo.job(job.id))!.status).toBe("queued");

    await db
      .from("ingest_jobs")
      .update({ status: "running", started_at: old, attempts: 2 })
      .eq("id", job.id);
    expect(await queue.requeueStale(900_000)).toBe(1);
    expect((await repo.job(job.id))!).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/timed out/),
    });
    expect((await repo.version(version.id))!.status).toBe("failed");
  });

  it("FR-9.5 the heartbeat upserts worker_heartbeats", async () => {
    await new IngestQueue(db).heartbeat("m8-test-worker", { pid: 1 });
    const { data } = await db
      .from("worker_heartbeats")
      .select("name, meta")
      .eq("name", "m8-test-worker")
      .single();
    expect(data).toEqual({ name: "m8-test-worker", meta: { pid: 1 } });
    await db.from("worker_heartbeats").delete().eq("name", "m8-test-worker");
  });
});

describe("RLS: M8 functions are server-only", () => {
  it("signed-in users (even instructors) cannot call publish, delete or requeue", async () => {
    const client = createClient(
      process.env.TEST_SUPABASE_URL!,
      process.env.TEST_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );
    await client.auth.signInWithPassword({
      email: INSTRUCTOR!.email,
      password: "uxie-dev-password",
    });
    const id = crypto.randomUUID();
    for (const [fn, args] of [
      ["publish_version", { p_version: id }],
      ["delete_paper", { p_paper: id }],
      ["delete_paper_version", { p_version: id }],
      ["requeue_stale_ingest_jobs", { p_timeout_ms: 1, p_max_attempts: 2 }],
    ] as const) {
      const res = await client.rpc(fn, args);
      expect(res.error, fn).not.toBeNull();
    }
  });
});
