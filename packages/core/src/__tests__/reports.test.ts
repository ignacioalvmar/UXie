import { describe, expect, it } from "vitest";
import {
  buildClassReport,
  buildUsageReport,
  classReportMarkdown,
  csvCell,
  EXPORT_COLUMNS,
  ExportFiltersSchema,
  median,
  monthRange,
  toCsv,
  usageReportMarkdown,
  type ReportConversation,
  type ReportObjective,
} from "../index";

describe("FR-7.3 CSV escaping", () => {
  it("prefixes formula-like strings with an apostrophe", () => {
    for (const s of ["=SUM(A1)", "+1", "-2+3", "@cmd", "\tx", "\rx"])
      expect(csvCell(s).replace(/^"|"$/g, "").startsWith("'")).toBe(true);
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("plain")).toBe("plain");
  });

  it("quotes commas, quotes and line breaks (RFC 4180)", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("\rx")).toBe(`"'\rx"`);
  });

  it("writes numbers, booleans, null and objects", () => {
    expect(csvCell(-1)).toBe("-1");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("true");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  it("starts with a BOM, uses CRLF and keeps the column order", () => {
    const csv = toCsv(["b", "a"], [{ a: "1", b: "=2" }]);
    expect(csv).toBe("﻿b,a\r\n'=2,1\r\n");
  });

  it("has the PRD column list without emails or auth ids", () => {
    expect(EXPORT_COLUMNS).toHaveLength(20);
    expect(EXPORT_COLUMNS.join()).not.toMatch(/email|student_id|auth/);
  });

  it("validates export filters", () => {
    expect(ExportFiltersSchema.safeParse({ from: "2026-10-01" }).success).toBe(true);
    expect(ExportFiltersSchema.safeParse({ from: "yesterday" }).success).toBe(false);
    expect(ExportFiltersSchema.safeParse({ email: "x" }).success).toBe(false);
  });
});

const OBJ: ReportObjective[] = [
  { id: "U1", kind: "understanding", statement: "Understand one." },
  { id: "U2", kind: "understanding", statement: "Understand two." },
  { id: "A1", kind: "application", statement: "Apply one." },
];

const conv = (
  id: string,
  pseudonymId: string,
  statuses: Record<string, "not_started" | "in_progress" | "demonstrated">,
  turns: number,
  extra: Partial<ReportConversation> = {},
): ReportConversation => ({
  id,
  pseudonymId,
  versionNo: 1,
  objectives: OBJ,
  state: { objectives: statuses, misconceptions_seen: [] },
  studentTurns: turns,
  costEur: 0.1,
  ...extra,
});

describe("FR-7.2 class report", () => {
  const report = buildClassReport({
    paper: { id: "p", slug: "visible-cues", title: "Visible Cues" },
    generatedAt: new Date("2026-10-04T12:00:00Z"),
    conversations: [
      conv("c1", "S-a", { U1: "demonstrated", U2: "in_progress", A1: "demonstrated" }, 12, {
        state: {
          objectives: { U1: "demonstrated", U2: "in_progress", A1: "demonstrated" },
          misconceptions_seen: [
            { objective: "U1", text: "Affordances are visual", resolved: true },
            { objective: "U1", text: "affordances  are visual ", resolved: true },
          ],
        },
      }),
      conv("c2", "S-a", { U1: "in_progress" }, 3),
      conv("c3", "S-b", { U1: "demonstrated", U2: "demonstrated", A1: "in_progress" }, 9, {
        state: {
          objectives: { U1: "demonstrated", U2: "demonstrated", A1: "in_progress" },
          misconceptions_seen: [
            { objective: "U1", text: "Affordances are visual", resolved: false },
          ],
        },
      }),
      // A v2 conversation whose guide has a new objective.
      conv("c4", "S-c", { U1: "demonstrated", A1: "demonstrated", A2: "demonstrated" }, 10, {
        versionNo: 2,
        objectives: [...OBJ, { id: "A2", kind: "application", statement: "Apply two." }],
      }),
    ],
    counts: {
      feedbackUp: 3,
      feedbackDown: 1,
      tutorCalls: 20,
      tutorCallsWithInvalidCitations: 1,
      assessmentCalls: 18,
      assessmentFailures: 2,
    },
  });

  it("counts students, conversations and median turns", () => {
    expect(report.studentsActive).toBe(3);
    expect(report.conversations).toBe(4);
    expect(report.medianTurns).toBe(9.5);
    expect(report.totalTurns).toBe(34);
  });

  it("computes per-objective status percentages over conversations that have the objective", () => {
    const u1 = report.objectives.find((o) => o.id === "U1")!;
    expect(u1.total).toBe(4);
    expect(u1.status.demonstrated).toEqual({ n: 3, total: 4, pct: 75 });
    expect(u1.status.in_progress).toEqual({ n: 1, total: 4, pct: 25 });
    const u2 = report.objectives.find((o) => o.id === "U2")!;
    expect(u2.status.not_started).toEqual({ n: 2, total: 4, pct: 50 });
    const a2 = report.objectives.find((o) => o.id === "A2")!;
    expect(a2.total).toBe(1);
    expect(a2.status.demonstrated.pct).toBe(100);
    // Newest version's order first.
    expect(report.objectives.map((o) => o.id)).toEqual(["U1", "U2", "A1", "A2"]);
  });

  it("computes the north-star proxy per conversation, student and ≥10-turn student", () => {
    expect(report.northStar.conversations).toEqual({ n: 2, total: 4, pct: 50 });
    expect(report.northStar.students).toEqual({ n: 2, total: 3, pct: 66.7 });
    // S-a has 15 turns, S-c 10, S-b 9.
    expect(report.northStar.studentsTenTurns).toEqual({ n: 2, total: 2, pct: 100 });
  });

  it("groups misconceptions by objective and normalized text, once per conversation", () => {
    expect(report.misconceptions).toEqual([
      { objective: "U1", text: "Affordances are visual", conversations: 2, resolved: 1 },
    ]);
  });

  it("computes rates and cost per conversation", () => {
    expect(report.helpfulness.pct).toBe(75);
    expect(report.invalidCitationRate.pct).toBe(5);
    expect(report.assessmentFailureRate.pct).toBe(11.1);
    expect(report.costEur).toBe(0.4);
    expect(report.costPerConversationEur).toBe(0.1);
  });

  it("renders Markdown without names unless given", () => {
    const md = classReportMarkdown(report);
    expect(md).toContain("| North-star proxy (students) | 66.7% (2/3) |");
    expect(md).toContain(
      "| U1: Understand one. | understanding | 0.0% (0/4) | 25.0% (1/4) | 75.0% (3/4) |",
    );
    expect(md).not.toContain("| Name |");
  });

  it("handles an empty paper", () => {
    const empty = buildClassReport({
      paper: { id: "p", slug: "x", title: "X" },
      generatedAt: new Date(),
      conversations: [],
      counts: {
        feedbackUp: 0,
        feedbackDown: 0,
        tutorCalls: 0,
        tutorCallsWithInvalidCitations: 0,
        assessmentCalls: 0,
        assessmentFailures: 0,
      },
    });
    expect(empty.medianTurns).toBeNull();
    expect(empty.northStar.conversations.pct).toBeNull();
    expect(classReportMarkdown(empty)).toContain("None recorded.");
  });

  it("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
});

describe("FR-7.4 usage report", () => {
  it("month ranges are UTC calendar months", () => {
    const r = monthRange("2026-12");
    expect(r.from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(() => monthRange("2026-13")).toThrow();
  });

  it("totals cost, cache hit ratio and error rate", () => {
    const row = {
      provider: "anthropic",
      calls: 10,
      errors: 1,
      inputTokens: 1000,
      outputTokens: 100,
      cachedInputTokens: 600,
      cacheWriteInputTokens: 50,
    };
    const r = buildUsageReport({
      month: "2026-10",
      ceilingEur: 100,
      isCurrentMonth: true,
      byModel: [
        { ...row, purpose: "tutor", model: "claude-sonnet-5-5", costEur: 12.34567 },
        { ...row, purpose: "assessment", model: "claude-haiku-4-5", costEur: 0.65433, errors: 0 },
      ],
      latency: [{ purpose: "tutor", latencyP50Ms: 2000, latencyP95Ms: 5000, ttftP95Ms: 1500 }],
      days: [{ day: "2026-10-01", activeStudents: 2, costEur: 13 }],
      activeStudents: 2,
    });
    expect(r.totalCostEur).toBe(13);
    expect(r.ceilingUsed.pct).toBe(13);
    expect(r.errorRate).toEqual({ n: 1, total: 20, pct: 5 });
    expect(r.cacheHitRatio.pct).toBe(60);
    expect(r.byPurpose.map((p) => p.purpose)).toEqual(["assessment", "tutor"]);
    expect(usageReportMarkdown(r)).toContain("(month to date)");
  });
});
