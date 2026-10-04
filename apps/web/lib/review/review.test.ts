import { describe, expect, it } from "vitest";
import { buildTimeline, type TranscriptMessage } from "@uxie/db";
import { DataRequestPatch, ExportBody, parseReviewQuery, toReviewFilters } from "./schemas";
import { deletionConfirmationMail, dueLabel, mailtoLink, retentionReminder } from "./text";

const UUID = "00000000-0000-4000-c000-000000000001";

describe("FR-7.1 review filters", () => {
  it("keeps valid filters and drops invalid ones instead of failing the page", () => {
    const q = parseReviewQuery({
      paper: UUID,
      module: "not-a-uuid",
      mode: "apply",
      from: "2026-10-01",
      to: "tomorrow",
      feedback: "1",
      pseudonym: ["S-ab", "S-cd"],
      page: "2",
    });
    expect(q).toEqual({
      paper: UUID,
      mode: "apply",
      from: "2026-10-01",
      feedback: "1",
      pseudonym: "S-ab",
      page: 2,
    });
    expect(toReviewFilters(q)).toEqual({
      paperId: UUID,
      mode: "apply",
      from: "2026-10-01",
      pseudonym: "S-ab",
      hasFeedback: true,
    });
  });

  it("builds objective transitions between consecutive replies", () => {
    const msg = (
      id: string,
      role: TranscriptMessage["role"],
      objectives?: Record<string, string>,
      extra: Partial<TranscriptMessage> = {},
    ): TranscriptMessage => ({
      id,
      role,
      event: null,
      mode: "understand",
      helpLevel: role === "tutor" ? "ask" : null,
      content: "",
      status: "complete",
      errorCode: null,
      citations: [],
      model: null,
      promptVersion: null,
      createdAt: "2026-10-04T10:00:00Z",
      feedback: null,
      learner: objectives
        ? {
            mode: "understand",
            active_objective: "U1",
            objectives,
            attempts: 0,
            stuck_requests: 0,
            assessment_failed: false,
          }
        : null,
      ...extra,
    });
    const t = buildTimeline([
      msg("e", "event", undefined, { event: "start" }),
      msg("t1", "tutor", { U1: "in_progress" }),
      msg("s1", "student"),
      msg("t2", "tutor", { U1: "demonstrated", A1: "in_progress" }, { helpLevel: "hint:0" }),
      msg("t3", "tutor", undefined, { status: "failed" }),
      msg("t4", "tutor", undefined), // an older reply without a snapshot: no transitions
    ]);
    expect(t.map((x) => x.messageId)).toEqual(["e", "t1", "t2", "t4"]);
    expect(t[1]!.transitions).toEqual([
      { objective: "U1", from: "not_started", to: "in_progress" },
    ]);
    expect(t[2]!.transitions).toEqual([
      { objective: "A1", from: "not_started", to: "in_progress" },
      { objective: "U1", from: "in_progress", to: "demonstrated" },
    ]);
    expect(t[2]!.helpLevel).toBe("hint:0");
    expect(t[3]!.transitions).toEqual([]);
  });
});

describe("FR-7.3 / FR-8.3 request bodies", () => {
  it("export body", () => {
    expect(ExportBody.safeParse({ format: "csv", researchOnly: true }).success).toBe(true);
    expect(ExportBody.safeParse({ format: "xlsx", researchOnly: true }).success).toBe(false);
    expect(ExportBody.safeParse({ format: "csv", researchOnly: true, email: "x" }).success).toBe(
      false,
    );
  });

  it("data request actions", () => {
    expect(
      DataRequestPatch.safeParse({ action: "complete", confirmPseudonym: "S-1" }).success,
    ).toBe(true);
    expect(DataRequestPatch.safeParse({ action: "reject" }).success).toBe(false);
    expect(DataRequestPatch.safeParse({ action: "delete" }).success).toBe(false);
  });
});

describe("FR-8.x wording", () => {
  const now = new Date("2026-10-04T12:00:00Z");

  it("due labels flag overdue requests", () => {
    expect(dueLabel("2026-10-07T12:00:00Z", now)).toEqual({
      text: "due in 3 days",
      overdue: false,
    });
    expect(dueLabel("2026-10-02T12:00:00Z", now)).toEqual({
      text: "overdue by 2 days",
      overdue: true,
    });
    expect(dueLabel("2026-10-04T12:00:00Z", now).text).toBe("due today");
  });

  it("retention reminder appears within 30 days and when overdue", () => {
    expect(retentionReminder(undefined, now)).toBeNull();
    expect(retentionReminder("2027-03-01", now)).toBeNull();
    expect(retentionReminder("2026-10-20", now)).toMatch(/in 16 days/);
    expect(retentionReminder("2026-09-01", now)).toMatch(/was due/);
  });

  it("confirmation mail names the pseudonym, not the email, and a mailto fallback", () => {
    const mail = deletionConfirmationMail({
      pseudonymId: "S-abc",
      deletedAt: now,
      appUrl: "https://uxie.example",
    });
    expect(mail.text).toContain("S-abc");
    expect(mail.text).toContain("2026-10-04");
    expect(mail.text).toContain("https://uxie.example/privacy");
    const link = mailtoLink("a.b@thi.de", mail);
    expect(link.startsWith("mailto:a.b%40thi.de?subject=")).toBe(true);
    expect(decodeURIComponent(link.split("body=")[1]!)).toBe(mail.text);
  });
});
