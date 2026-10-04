import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { CSV_BOM, initialState, TeachingGuideSchema, type LearnerState } from "@uxie/core";
import { buildExport, createServiceClient, DataRightsRepo, ReviewRepo, type Db } from "../src";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/seedData";

/**
 * M9 acceptance against the local stack (PRD §16 M9): class report numbers on a fixture class,
 * CSV escaping and research filtering, export log, deletion workflow + ledger, cost dashboard
 * sum, retention purge, and the new SQL functions refused to signed-in users.
 */

const guide = TeachingGuideSchema.parse(
  parseYaml(
    readFileSync(
      new URL("../../../fixtures/papers/visible-cues/guide.yaml", import.meta.url),
      "utf8",
    ),
  ),
);
const [INSTRUCTOR] = SEED_USERS;
const run = Date.now().toString(36);
let db: Db;
let review: ReviewRepo;
let rights: DataRightsRepo;
let moduleId: string;
let paperId: string;
let versionId: string;
const students: Record<"c" | "d" | "e", { id: string; email: string; pseudonym: string }> =
  {} as never;
const convs: Record<string, string> = {};

const state = (
  objectives: Record<string, LearnerState["objectives"][string]>,
  extra: Partial<LearnerState> = {},
) => ({
  ...initialState(guide, "understand"),
  objectives: { ...initialState(guide, "understand").objectives, ...objectives },
  ...extra,
});

async function createStudent(key: "c" | "d" | "e", consent: boolean) {
  const email = `m9-${key}-${run}@thi.de`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const id = data.user.id;
  await db
    .from("profiles")
    .update({
      privacy_notice_version: "2026-10-01",
      privacy_ack_at: new Date().toISOString(),
      research_consent: consent,
    })
    .eq("id", id);
  const p = await db.from("profiles").select("pseudonym_id").eq("id", id).single();
  students[key] = { id, email, pseudonym: (p.data as { pseudonym_id: string }).pseudonym_id };
}

async function conversation(
  key: string,
  studentId: string,
  s: object,
  messages: {
    role: "student" | "tutor" | "event";
    content: string;
    event?: string;
    rating?: 1 | -1;
  }[],
  opts: { isTest?: boolean; at?: string; status?: "active" | "closed" } = {},
) {
  const c = await db
    .from("conversations")
    .insert({
      student_id: studentId,
      paper_id: paperId,
      paper_version_id: versionId,
      module_id_at_start: moduleId,
      module_title_at_start: "M9 module",
      state: s,
      is_test: opts.isTest ?? false,
      status: opts.status ?? "active",
      ...(opts.at ? { created_at: opts.at, last_message_at: opts.at } : {}),
    })
    .select("id")
    .single();
  if (c.error) throw c.error;
  const id = (c.data as { id: string }).id;
  convs[key] = id;
  let t = Date.parse(opts.at ?? "2026-10-04T10:00:00Z");
  for (const m of messages) {
    const ins = await db
      .from("messages")
      .insert({
        conversation_id: id,
        role: m.role,
        content: m.content,
        event: m.event ?? null,
        mode: "understand",
        help_level: m.role === "tutor" ? "ask" : null,
        created_at: new Date((t += 1000)).toISOString(),
      })
      .select("id")
      .single();
    if (ins.error) throw ins.error;
    if (m.rating)
      await db.from("feedback").insert({
        message_id: (ins.data as { id: string }).id,
        student_id: studentId,
        rating: m.rating,
      });
  }
  return id;
}

const llmCall = (
  conversationId: string | null,
  purpose: string,
  ok: boolean,
  cost: number,
  meta = {},
  at?: string,
) =>
  db.from("llm_calls").insert({
    conversation_id: conversationId,
    purpose,
    provider: "mock",
    model: "m9-model",
    input_tokens: 1000,
    output_tokens: 100,
    cached_input_tokens: 400,
    cost_eur: cost,
    latency_ms: 1000,
    ttft_ms: 500,
    ok,
    error_code: ok ? null : "timeout",
    meta,
    ...(at ? { created_at: at } : {}),
  });

beforeAll(async () => {
  db = createServiceClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SECRET_KEY!);
  review = new ReviewRepo(db);
  rights = new DataRightsRepo(db);
  moduleId = (
    (
      await db
        .from("modules")
        .insert({ slug: `m9-${run}`, title: "M9 module", status: "published" })
        .select("id")
        .single()
    ).data as { id: string }
  ).id;
  paperId = (
    (
      await db
        .from("papers")
        .insert({
          module_id: moduleId,
          slug: `m9-paper-${run}`,
          title: "M9 paper",
          status: "published",
        })
        .select("id")
        .single()
    ).data as { id: string }
  ).id;
  versionId = (
    (
      await db
        .from("paper_versions")
        .insert({
          paper_id: paperId,
          version_no: 1,
          pdf_path: `${paperId}/v1.pdf`,
          status: "published",
          page_count: 7,
        })
        .select("id")
        .single()
    ).data as { id: string }
  ).id;
  await db.from("papers").update({ current_version_id: versionId }).eq("id", paperId);
  await db
    .from("teaching_guides")
    .insert({ version_id: versionId, guide, status: "approved", guide_hash: "m9" });

  await createStudent("c", true);
  await createStudent("d", false);
  await createStudent("e", true);

  // Fixture class (objectives U1, U2, C1, A1). Expected numbers are in the tests below.
  const c1 = await conversation(
    "c",
    students.c.id,
    state(
      { U1: "demonstrated", U2: "in_progress", A1: "demonstrated" },
      {
        misconceptions_seen: [
          { objective: "U1", text: "Affordances are visual properties", resolved: true },
        ],
      },
    ),
    [
      { role: "event", content: "", event: "start" },
      { role: "tutor", content: "What is an affordance?" },
      { role: "student", content: '=HYPERLINK("http://evil","click")' },
      { role: "tutor", content: "Look at page 2 [p. 2].", rating: 1 },
      { role: "student", content: '+ it is about, "cues"' },
      { role: "tutor", content: "Good." },
      { role: "student", content: "@done" },
    ],
  );
  await conversation(
    "d",
    students.d.id,
    state(
      { U1: "in_progress" },
      {
        misconceptions_seen: [
          { objective: "U1", text: "affordances are  visual properties", resolved: false },
        ],
      },
    ),
    [
      { role: "tutor", content: "Hello" },
      { role: "student", content: "-1 is my answer" },
      { role: "tutor", content: "Why?", rating: -1 },
      { role: "student", content: "dunno" },
    ],
  );
  await conversation(
    "e",
    students.e.id,
    state({ U1: "demonstrated", C1: "demonstrated", A1: "demonstrated" }),
    [
      { role: "tutor", content: "Hello" },
      { role: "student", content: "e speaks", rating: undefined },
    ],
  );
  // An instructor test chat that must not count anywhere.
  await conversation(
    "test",
    INSTRUCTOR!.id,
    state({ U1: "demonstrated", U2: "demonstrated", A1: "demonstrated", C1: "demonstrated" }),
    [{ role: "student", content: "test chat" }],
    { isTest: true },
  );

  await llmCall(c1, "tutor", true, 0.01, { citation_invalid: 1 });
  await llmCall(c1, "tutor", true, 0.02, { citation_invalid: 0 });
  await llmCall(c1, "assessment", true, 0.001);
  await llmCall(c1, "assessment", false, 0);
  await llmCall(convs.d!, "tutor", true, 0.03);
  await llmCall(convs.test!, "tutor", true, 5, { citation_invalid: 3 });
});

afterAll(async () => {
  await db.from("conversations").delete().eq("paper_id", paperId);
  await db.from("papers").update({ current_version_id: null }).eq("id", paperId);
  await db.from("paper_versions").delete().eq("paper_id", paperId);
  await db.from("papers").delete().eq("id", paperId);
  await db.from("modules").delete().eq("id", moduleId);
  for (const s of Object.values(students)) await db.auth.admin.deleteUser(s.id).catch(() => {});
  await db.from("llm_calls").delete().eq("model", "m9-model");
  await db.from("export_log").delete().contains("filters", { paperId });
});

describe("FR-7.2 class report (M9 acceptance: fixture-verified numbers)", () => {
  it("reports per-objective percentages and the north-star proxy, excluding test chats", async () => {
    const r = (await review.classReport(paperId))!;
    expect(r.conversations).toBe(3);
    expect(r.studentsActive).toBe(3);
    expect(r.medianTurns).toBe(2);
    const o = Object.fromEntries(r.objectives.map((x) => [x.id, x]));
    expect(o.U1!.status.demonstrated).toEqual({ n: 2, total: 3, pct: 66.7 });
    expect(o.U1!.status.in_progress).toEqual({ n: 1, total: 3, pct: 33.3 });
    expect(o.U2!.status.not_started).toEqual({ n: 2, total: 3, pct: 66.7 });
    expect(o.A1!.status.demonstrated).toEqual({ n: 2, total: 3, pct: 66.7 });
    expect(o.C1!.status.demonstrated).toEqual({ n: 1, total: 3, pct: 33.3 });
    expect(r.northStar.conversations).toEqual({ n: 2, total: 3, pct: 66.7 });
    expect(r.northStar.students).toEqual({ n: 2, total: 3, pct: 66.7 });
    expect(r.helpfulness).toEqual({ n: 1, total: 2, pct: 50 });
    expect(r.invalidCitationRate).toEqual({ n: 1, total: 3, pct: 33.3 });
    expect(r.assessmentFailureRate).toEqual({ n: 1, total: 2, pct: 50 });
    expect(r.costEur).toBeCloseTo(0.061, 5);
    expect(r.misconceptions[0]).toMatchObject({ objective: "U1", conversations: 2, resolved: 1 });
  });
});

describe("FR-7.1 review", () => {
  it("lists real conversations with filters and shows a transcript", async () => {
    const all = await review.listConversations({ paperId });
    expect(all.total).toBe(3);
    const fb = await review.listConversations({ paperId, hasFeedback: true });
    expect(fb.items.map((i) => i.pseudonymId).sort()).toEqual(
      [students.c.pseudonym, students.d.pseudonym].sort(),
    );
    const byPseudonym = await review.listConversations({ pseudonym: students.d.pseudonym });
    expect(byPseudonym.items).toHaveLength(1);
    const t = (await review.conversation(convs.c!))!;
    expect(t.conversation.pseudonymId).toBe(students.c.pseudonym);
    expect(t.messages).toHaveLength(7);
    expect(t.messages.find((m) => m.feedback)?.feedback?.rating).toBe(1);
    expect(t.objectives.map((x) => x.id)).toContain("A1");
    expect(await review.studentEmail(students.c.id)).toBe(students.c.email);
  });
});

describe("FR-7.3 exports (M9 acceptance)", () => {
  it("escapes formula-like cells, excludes test chats and logs the export", async () => {
    const file = await buildExport(review, {
      filters: { paperId },
      format: "csv",
      researchOnly: false,
      instructorId: INSTRUCTOR!.id,
      channel: "web",
    });
    expect(file.body.startsWith(CSV_BOM)).toBe(true);
    expect(file.body).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(file.body).toContain(`"'+ it is about, ""cues"""`);
    expect(file.body).toContain(",'@done,");
    expect(file.body).toContain(",'-1 is my answer,");
    expect(file.body).not.toContain("test chat");
    expect(file.body).not.toMatch(/@thi\.de/);
    expect(file.rowCount).toBe(13);
    const log = (await review.exportLog()).find((l) => l.filters.paperId === paperId)!;
    expect(log).toMatchObject({ format: "csv", researchOnly: false, rowCount: 13, channel: "web" });
  });

  it("research-only keeps consenting students, drops pending deletions and the deleted", async () => {
    await rights.requestDeletion(students.e.id);
    const rows = await review.exportRows({ paperId }, true);
    expect(new Set(rows.map((r) => r.pseudonym_id))).toEqual(new Set([students.c.pseudonym]));
    const json = await buildExport(review, {
      filters: { paperId },
      format: "json",
      researchOnly: true,
      instructorId: null,
      channel: "cli",
    });
    expect(JSON.parse(json.body).rows).toHaveLength(7);
  });
});

describe("FR-8.x data rights (M9 acceptance)", () => {
  it("download my data includes the email and is logged as an access request", async () => {
    const data = await rights.exportPersonalData(students.d.id, students.d.email);
    expect(data.profile.email).toBe(students.d.email);
    expect(data.conversations).toHaveLength(1);
    expect(data.messages).toHaveLength(4);
    expect(data.feedback).toHaveLength(1);
    expect(data.dataRequests.some((r) => r.type === "access" && r.status === "completed")).toBe(
      true,
    );
  });

  it("a second deletion request returns the open one", async () => {
    const again = await rights.requestDeletion(students.e.id);
    expect(again.created).toBe(false);
  });

  it("completing a deletion removes every student row, writes the ledger and closes the request", async () => {
    const e = students.e;
    await db.from("usage_daily").insert({ student_id: e.id, day: "2026-10-04", turns: 3 });
    await db.from("events").insert({ student_id: e.id, type: "message_sent", props: {} });
    const req = (await rights.requestsOf(e.id)).find((r) => r.type === "deletion")!;
    expect(await rights.completeDeletion(req.id)).toBe("ok");

    const count = async (table: string, col: string, val: string) =>
      (await db.from(table).select("*", { count: "exact", head: true }).eq(col, val)).count;
    expect(await count("profiles", "id", e.id)).toBe(0);
    expect(await count("conversations", "student_id", e.id)).toBe(0);
    expect(await count("messages", "conversation_id", convs.e!)).toBe(0);
    expect(await count("feedback", "student_id", e.id)).toBe(0);
    expect(await count("usage_daily", "student_id", e.id)).toBe(0);
    expect(await count("events", "student_id", e.id)).toBe(0);
    expect(await count("data_requests", "student_id", e.id)).toBe(0);
    expect((await db.auth.admin.getUserById(e.id)).data.user).toBeNull();
    expect(await rights.ledgerHas(e.pseudonym)).toBe(true);
    const done = (await rights.request(req.id))!;
    expect(done).toMatchObject({ status: "completed", studentId: null, pseudonymId: e.pseudonym });
    expect(await rights.completeDeletion(req.id)).toBe("already_closed");
  });

  it("refuses to delete an instructor account", async () => {
    const { data } = await db
      .from("data_requests")
      .insert({ student_id: INSTRUCTOR!.id, pseudonym_id: "S-instr", type: "deletion" })
      .select("id")
      .single();
    const id = (data as { id: string }).id;
    expect(await rights.completeDeletion(id)).toBe("instructor_account");
    await db.from("data_requests").delete().eq("id", id);
  });
});

describe("FR-7.4 usage & cost (M9 acceptance)", () => {
  it("the dashboard total matches the sum of llm_calls for the month", async () => {
    const at = (d: number) => `2001-01-${String(d).padStart(2, "0")}T12:00:00Z`;
    await llmCall(null, "tutor", true, 1.23456, {}, at(3));
    await llmCall(null, "tutor", false, 0.5, {}, at(4));
    await llmCall(null, "assessment", true, 0.00011, {}, at(31));
    await llmCall(null, "tutor", true, 99, {}, "2001-02-01T00:00:00Z");
    const r = await review.usage("2001-01", 100, new Date("2026-10-04"));
    const sum = (
      (
        await db
          .from("llm_calls")
          .select("cost_eur")
          .gte("created_at", "2001-01-01")
          .lt("created_at", "2001-02-01")
      ).data as { cost_eur: string }[]
    ).reduce((s, x) => s + Number(x.cost_eur), 0);
    expect(r.totalCostEur).toBeCloseTo(sum, 5);
    expect(r.totalCostEur).toBeCloseTo(1.73467, 5);
    expect(r.totalCalls).toBe(3);
    expect(r.errorRate.n).toBe(1);
    expect(r.cacheHitRatio.pct).toBe(40);
    expect(r.days.map((d) => d.day)).toEqual(["2001-01-03", "2001-01-04", "2001-01-31"]);
    expect(r.latency.find((l) => l.purpose === "tutor")?.latencyP50Ms).toBe(1000);
    expect(r.isCurrentMonth).toBe(false);
  });
});

describe("FR-8.4 purge", () => {
  it("dry run counts; purge deletes old conversations and keeps llm_calls aggregates", async () => {
    const old = await conversation(
      "old",
      students.c.id,
      state({}),
      [
        { role: "student", content: "old", rating: undefined },
        { role: "tutor", content: "reply", rating: 1 },
      ],
      { at: "2001-03-01T00:00:00Z", status: "closed" },
    );
    await llmCall(old, "tutor", true, 0.5, {}, "2001-03-01T00:00:00Z");
    const before = new Date("2001-06-01T00:00:00Z");
    expect(await rights.purge(before, true)).toEqual({
      conversations: 1,
      messages: 2,
      feedback: 1,
      students: 1,
    });
    expect((await db.from("conversations").select("id").eq("id", old)).data).toHaveLength(1);
    expect(await rights.purge(before, false)).toMatchObject({ conversations: 1 });
    expect((await db.from("conversations").select("id").eq("id", old)).data).toHaveLength(0);
    const kept = await db
      .from("llm_calls")
      .select("conversation_id, cost_eur")
      .eq("created_at", "2001-03-01T00:00:00Z");
    expect(kept.data).toEqual([{ conversation_id: null, cost_eur: 0.5 }]);
  });
});

describe("0007 SQL functions are server-only", () => {
  it("refuses them to signed-in users", async () => {
    const client = createClient(
      process.env.TEST_SUPABASE_URL!,
      process.env.TEST_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    await client.auth.signInWithPassword({ email: INSTRUCTOR!.email, password: SEED_PASSWORD });
    for (const [fn, args] of [
      ["review_conversations", {}],
      ["report_conversations", { p_paper: paperId }],
      ["report_counts", { p_paper: paperId }],
      ["export_rows", {}],
      ["usage_by_model", { p_from: "2001-01-01", p_to: "2001-02-01" }],
      ["complete_deletion", { p_request: paperId }],
      ["purge_conversations", { p_before: "2001-01-01", p_dry_run: true }],
      ["reapply_deletion_ledger", {}],
    ] as const) {
      const res = await client.rpc(fn, args);
      expect(res.error, fn).not.toBeNull();
    }
  });
});
