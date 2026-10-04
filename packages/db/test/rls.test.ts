import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SEED_MODULE_ID,
  SEED_PAPER_ID,
  SEED_PASSWORD,
  SEED_USERS,
  SEED_VERSION_ID,
} from "../scripts/seedData";

/**
 * PRD §9.2 RLS matrix, signed in as student A, student B, an instructor and anonymous, against
 * the local stack seeded by supabase/seed.sql. Writes in setup use the service client.
 */

const url = () => process.env.TEST_SUPABASE_URL!;
const publishable = () => process.env.TEST_SUPABASE_PUBLISHABLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

let service: SupabaseClient;
let anon: SupabaseClient;
let instructor: SupabaseClient;
let studentA: SupabaseClient;
let studentB: SupabaseClient;
const [INSTRUCTOR, A, B] = SEED_USERS;

async function signedIn(email: string) {
  const client = createClient(url(), publishable(), opts);
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return client;
}

const rows = async (q: PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
  const { data, error } = await q;
  return { n: data?.length ?? 0, error };
};

const DRAFT_PAPER = "00000000-0000-4000-c000-0000000000ff";
const DRAFT_VERSION = "00000000-0000-4000-d000-0000000000ff";
let convA: string;

beforeAll(async () => {
  service = createClient(url(), process.env.TEST_SUPABASE_SECRET_KEY!, opts);
  anon = createClient(url(), publishable(), opts);
  [instructor, studentA, studentB] = await Promise.all([
    signedIn(INSTRUCTOR.email),
    signedIn(A.email),
    signedIn(B.email),
  ]);

  // An unpublished paper version and one conversation of student A on the published one.
  await service.from("papers").upsert({
    id: DRAFT_PAPER,
    module_id: SEED_MODULE_ID,
    slug: "rls-draft",
    title: "Draft paper",
    status: "draft",
  });
  await service.from("paper_versions").upsert({
    id: DRAFT_VERSION,
    paper_id: DRAFT_PAPER,
    version_no: 1,
    pdf_path: `${DRAFT_PAPER}/${DRAFT_VERSION}.pdf`,
    pdf_sha256: "x",
    status: "ready",
  });
  await service
    .from("paper_pages")
    .upsert({ version_id: DRAFT_VERSION, page_no: 1, text: "draft" });
  const conv = await service
    .from("conversations")
    .insert({
      student_id: A.id,
      paper_id: SEED_PAPER_ID,
      paper_version_id: SEED_VERSION_ID,
      module_id_at_start: SEED_MODULE_ID,
      module_title_at_start: "Foundations",
      state: {},
      is_test: true,
    })
    .select("id")
    .single();
  convA = conv.data!.id as string;
  await service
    .from("messages")
    .insert({ conversation_id: convA, role: "student", content: "hello" });
  await service
    .from("llm_credentials")
    .upsert({ provider: "anthropic", api_key_sealed: "v1.x", key_hint: "…abcd" });
  await service.from("llm_settings").upsert({ id: true, config: {} });
  await service
    .from("llm_calls")
    .insert({ purpose: "tutor", provider: "mock", model: "m", ok: true });
});

afterAll(async () => {
  await service.from("conversations").delete().eq("id", convA);
  await service.from("paper_pages").delete().eq("version_id", DRAFT_VERSION);
  await service.from("paper_versions").delete().eq("id", DRAFT_VERSION);
  await service.from("papers").delete().eq("id", DRAFT_PAPER);
  await service.from("llm_credentials").delete().eq("provider", "anthropic");
  await service.from("llm_settings").delete().eq("id", true);
});

describe("RLS: students (PRD §9.2)", () => {
  it("see only their own profile and may edit only display name and project", async () => {
    expect((await rows(studentA.from("profiles").select("id"))).n).toBe(1);
    const ok = await studentA
      .from("profiles")
      .update({ display_name: "A" })
      .eq("id", A.id)
      .select("id");
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(1);
    const role = await studentA.from("profiles").update({ role: "instructor" }).eq("id", A.id);
    expect(role.error).not.toBeNull();
    const consent = await studentA
      .from("profiles")
      .update({ research_consent: true })
      .eq("id", A.id);
    expect(consent.error).not.toBeNull();
    const other = await studentA
      .from("profiles")
      .update({ display_name: "x" })
      .eq("id", B.id)
      .select("id");
    expect(other.data ?? []).toHaveLength(0);
  });

  it("see published modules, papers, versions and pages only", async () => {
    expect((await rows(studentA.from("modules").select("id"))).n).toBe(1);
    const papers = await studentA.from("papers").select("slug");
    expect(papers.data?.map((p) => p.slug)).toEqual(["visible-cues"]);
    expect((await rows(studentA.from("paper_versions").select("id"))).n).toBe(1);
    expect(
      (await rows(studentA.from("paper_pages").select("page_no").eq("version_id", SEED_VERSION_ID)))
        .n,
    ).toBe(7);
    expect(
      (await rows(studentA.from("paper_pages").select("page_no").eq("version_id", DRAFT_VERSION)))
        .n,
    ).toBe(0);
    const can = await studentA.rpc("can_read_version", { v: DRAFT_VERSION });
    expect(can.data).toBe(false);
  });

  it("never see teaching guides", async () => {
    expect((await rows(studentA.from("teaching_guides").select("version_id"))).n).toBe(0);
  });

  it("see only their own conversations and messages", async () => {
    expect((await rows(studentA.from("conversations").select("id"))).n).toBe(1);
    expect((await rows(studentA.from("messages").select("id"))).n).toBe(1);
    expect((await rows(studentB.from("conversations").select("id"))).n).toBe(0);
    expect((await rows(studentB.from("messages").select("id"))).n).toBe(0);
  });

  it("cannot write content, conversations or messages", async () => {
    const conv = await studentA.from("conversations").insert({
      student_id: A.id,
      paper_id: SEED_PAPER_ID,
      paper_version_id: SEED_VERSION_ID,
      module_id_at_start: SEED_MODULE_ID,
      module_title_at_start: "x",
      state: {},
    });
    expect(conv.error).not.toBeNull();
    const msg = await studentA
      .from("messages")
      .insert({ conversation_id: convA, role: "tutor", content: "x" });
    expect(msg.error).not.toBeNull();
    const mod = await studentA.from("modules").update({ title: "x" }).eq("id", SEED_MODULE_ID);
    expect(mod.error).not.toBeNull();
  });

  it("cannot read operations tables, settings or credentials", async () => {
    for (const table of [
      "llm_calls",
      "ingest_jobs",
      "export_log",
      "events",
      "deletion_ledger",
      "worker_heartbeats",
      "llm_settings",
      "alerts_sent",
    ]) {
      expect((await rows(studentA.from(table).select("*"))).n, table).toBe(0);
    }
    const creds = await studentA.from("llm_credentials").select("*");
    expect(creds.data ?? []).toHaveLength(0);
    expect(creds.error).not.toBeNull();
  });

  it("cannot call server-only functions", async () => {
    expect((await studentA.rpc("claim_ingest_job")).error).not.toBeNull();
    expect(
      (await studentA.rpc("increment_usage", { p_student: A.id, p_day: "2026-10-01" })).error,
    ).not.toBeNull();
    expect((await studentA.rpc("spend_since", { p_since: "2026-01-01" })).error).not.toBeNull();
  });
});

describe("RLS: instructors", () => {
  it("see everything students cannot, except credentials", async () => {
    expect((await rows(instructor.from("profiles").select("id"))).n).toBeGreaterThanOrEqual(3);
    expect(
      (await rows(instructor.from("teaching_guides").select("version_id"))).n,
    ).toBeGreaterThanOrEqual(1);
    expect(
      (await rows(instructor.from("paper_versions").select("id").eq("id", DRAFT_VERSION))).n,
    ).toBe(1);
    expect((await rows(instructor.from("conversations").select("id"))).n).toBeGreaterThanOrEqual(1);
    expect((await rows(instructor.from("llm_calls").select("id"))).n).toBeGreaterThanOrEqual(1);
    expect((await rows(instructor.from("llm_settings").select("id"))).n).toBe(1);
    const creds = await instructor.from("llm_credentials").select("*");
    expect(creds.data ?? []).toHaveLength(0);
    expect(creds.error).not.toBeNull();
  });

  it("still cannot write from the browser (server is the only writer)", async () => {
    const res = await instructor.from("modules").update({ title: "x" }).eq("id", SEED_MODULE_ID);
    expect(res.error).not.toBeNull();
  });
});

describe("RLS: anonymous", () => {
  it("sees nothing", async () => {
    for (const table of [
      "profiles",
      "modules",
      "papers",
      "paper_versions",
      "paper_pages",
      "conversations",
    ]) {
      expect((await rows(anon.from(table).select("*"))).n, table).toBe(0);
    }
  });
});

describe("FR-1.1 sign-up domain hook", () => {
  it("rejects a non-university email and accepts an allowed one", async () => {
    const bad = await anon.auth.signUp({
      email: `x${Date.now()}@gmail.com`,
      password: "long-enough-password",
    });
    expect(bad.error?.message).toMatch(/university email/i);
    const email = `rls${Date.now()}@thi.de`;
    const good = await anon.auth.signUp({ email, password: "long-enough-password" });
    expect(good.error).toBeNull();
    const created = await service
      .from("profiles")
      .select("id, role")
      .eq("id", good.data.user!.id)
      .single();
    expect(created.data?.role).toBe("student");
    await service.auth.admin.deleteUser(good.data.user!.id);
  });

  it("rejects passwords under 10 characters", async () => {
    const res = await anon.auth.signUp({ email: `short${Date.now()}@thi.de`, password: "short" });
    expect(res.error).not.toBeNull();
  });
});
