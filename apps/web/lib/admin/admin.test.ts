import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { initialState, TeachingGuideSchema } from "@uxie/core";
import { parse } from "yaml";
import { stateDiff } from "./debug";
import { checkGuideYaml, guideToEditorYaml, parseGuideYaml } from "./guideYaml";
import { CreatePaperBody, PatchPaperBody, Slug, TestChatBody } from "./schemas";

const guideYaml = readFileSync(
  new URL("../../../../fixtures/papers/visible-cues/guide.yaml", import.meta.url),
  "utf8",
);
const guide = TeachingGuideSchema.parse(parse(guideYaml));

describe("FR-6.4 guide editor YAML", () => {
  it("the fixture guide round-trips through the editor YAML without issues", () => {
    const text = guideToEditorYaml(guide);
    const checked = checkGuideYaml(text, 7);
    expect(checked.issues).toEqual([]);
    expect(TeachingGuideSchema.parse(checked.value)).toEqual(guide);
  });

  it("reports YAML syntax errors with a line number", () => {
    const parsed = parseGuideYaml("title: a\n  bad: [indent\n");
    expect(parsed.ok).toBe(false);
    const checked = checkGuideYaml("title: a\nobjectives: [\n", 7);
    expect(checked.syntax).toBe(true);
    expect(checked.issues[0]!.path).toMatch(/^line \d+$/);
  });

  it("reports schema issues by path and page refs beyond the paper", () => {
    const text = guideToEditorYaml({ ...guide, starter_questions: ["one"] });
    expect(checkGuideYaml(text, 7).issues.map((i) => i.path)).toEqual(["starter_questions"]);
    expect(checkGuideYaml(guideToEditorYaml(guide), 2).issues[0]!.message).toMatch(
      /does not exist \(paper has 2 pages\)/,
    );
  });

  it("an empty draft shows an empty editor", () => {
    expect(guideToEditorYaml({})).toBe("");
    expect(guideToEditorYaml(null)).toBe("");
  });
});

describe("FR-6.5 debug panel state diff", () => {
  it("lists changed leaves only, with before and after", () => {
    const before = initialState(guide, "understand");
    const after = {
      ...before,
      attempts: 1,
      objectives: { ...before.objectives, U1: "demonstrated" as const },
      evidence: { U1: "explained signifiers" },
    };
    expect(stateDiff(before, after)).toEqual([
      { path: "attempts", before: 0, after: 1 },
      { path: "objectives.U1", before: before.objectives.U1, after: "demonstrated" },
      { path: "evidence", before: {}, after: null },
      { path: "evidence.U1", before: null, after: "explained signifiers" },
    ]);
    expect(stateDiff(before, before)).toEqual([]);
  });
});

describe("admin request bodies (PRD §11)", () => {
  it("slugs are lowercase words joined by single dashes", () => {
    expect(Slug.safeParse("visible-cues-2").success).toBe(true);
    for (const bad of ["Visible", "a--b", "-a", "a b", "x"])
      expect(Slug.safeParse(bad).success).toBe(false);
  });

  it("a paper PATCH is exactly one of: details, move, retire", () => {
    expect(PatchPaperBody.safeParse({ title: "New title" }).success).toBe(true);
    expect(PatchPaperBody.safeParse({ moduleId: crypto.randomUUID() }).success).toBe(true);
    expect(PatchPaperBody.safeParse({ retired: true }).success).toBe(true);
    expect(PatchPaperBody.safeParse({ retired: true, title: "x y" }).success).toBe(false);
    expect(PatchPaperBody.safeParse({}).success).toBe(false);
  });

  it("new papers default to no authors and no year", () => {
    const p = CreatePaperBody.parse({
      moduleId: crypto.randomUUID(),
      slug: "p-1",
      title: "A paper",
    });
    expect(p).toMatchObject({ authors: [], year: null });
  });

  it("test-chat bodies: text, stuck, a mode switch on an existing chat, or nothing to start", () => {
    const id = crypto.randomUUID();
    const conv = crypto.randomUUID();
    expect(TestChatBody.safeParse({ clientMessageId: id }).success).toBe(true);
    expect(
      TestChatBody.safeParse({ clientMessageId: id, text: "hi", conversationId: conv }).success,
    ).toBe(true);
    expect(
      TestChatBody.safeParse({ clientMessageId: id, event: "stuck", conversationId: conv }).success,
    ).toBe(true);
    expect(
      TestChatBody.safeParse({
        clientMessageId: id,
        event: "mode_switch",
        mode: "apply",
        conversationId: conv,
      }).success,
    ).toBe(true);
    expect(
      TestChatBody.safeParse({ clientMessageId: id, event: "mode_switch", mode: "apply" }).success,
    ).toBe(false);
    expect(
      TestChatBody.safeParse({ clientMessageId: id, text: "hi", event: "stuck" }).success,
    ).toBe(false);
  });
});
