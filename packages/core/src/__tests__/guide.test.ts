import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  PagesFileSchema,
  TeachingGuideSchema,
  formatGuideIssues,
  validateGuide,
  validateGuideAgainstPaper,
} from "../index";
import { fixtureGuide, fixtureGuideRaw, fixturePages, miniGuide } from "./fixtures";

const clone = <T>(x: T): T => structuredClone(x);

describe("teaching guide schema (PRD §3.1, §8.1)", () => {
  it("M1 fixture guide.yaml validates against the schema and the paper", () => {
    const result = validateGuide(fixtureGuideRaw, fixturePages.pages.length);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(fixtureGuide.objectives.map((o) => o.id)).toEqual(["U1", "U2", "C1", "A1"]);
  });

  it("applies defaults for optional lists", () => {
    expect(miniGuide.objectives[0]!.misconceptions).toEqual([]);
    expect(miniGuide.discussion_prompts).toEqual([]);
    expect(miniGuide.evidence_limits).toEqual([]);
  });

  it("M1 an invalid guide reports human-readable errors with paths", () => {
    const bad = parse(`
schema_version: 1
title: Broken
summary_for_tutor: x
starter_questions: ["only one"]
objectives:
  - id: u1
    kind: understanding
    statement: short
    refs: []
    key_concepts: [a]
    question_ladder: [a, b]
    hints: [only one]
    mastery_check: "Explains it well."
ux_scenarios: []
`);
    const result = validateGuide(bad);
    expect(result.ok).toBe(false);
    const text = formatGuideIssues(result.issues);
    expect(text).toContain("starter_questions:");
    expect(text).toContain("objectives[0].id: must look like U1, A2 or C10");
    expect(text).toContain("objectives[0].statement:");
    expect(text).toContain("objectives[0].refs:");
    expect(text).toContain("objectives[0].hints:");
    expect(text).toContain("objectives:"); // fewer than 3 objectives
    expect(text).toContain("ux_scenarios:");
    expect(text.split("\n").every((line) => /^[\w[\].()]+: \S/.test(line))).toBe(true);
  });

  it("requires at least one understanding and one application objective", () => {
    const g = clone(fixtureGuideRaw) as { objectives: { kind: string }[] };
    g.objectives.forEach((o) => (o.kind = "understanding"));
    const issues = validateGuide(g).issues;
    expect(issues).toContainEqual({
      path: "objectives",
      message: "Need ≥1 understanding and ≥1 application objective",
    });
  });

  it("requires unique objective ids", () => {
    const g = clone(fixtureGuideRaw) as { objectives: { id: string }[] };
    g.objectives[1]!.id = g.objectives[0]!.id;
    expect(formatGuideIssues(validateGuide(g).issues)).toContain("Objective ids must be unique");
  });

  it("rejects an unknown schema_version", () => {
    expect(TeachingGuideSchema.safeParse({ ...miniGuide, schema_version: 2 }).success).toBe(false);
  });

  it("validateGuideAgainstPaper flags refs beyond the last page", () => {
    expect(validateGuideAgainstPaper(fixtureGuide, 7)).toEqual([]);
    const issues = validateGuideAgainstPaper(fixtureGuide, 5);
    expect(issues).toContainEqual({
      path: "objectives[2].refs[1].page",
      message: "page 6 does not exist (paper has 5 pages)",
    });
  });

  it("validateGuide returns the parsed guide when only page checks fail", () => {
    const result = validateGuide(fixtureGuideRaw, 3);
    expect(result.ok).toBe(false);
    expect(result.guide?.title).toBe(fixtureGuide.title);
  });
});

describe("pages file schema", () => {
  it("parses the fixture paper", () => {
    expect(fixturePages.pages).toHaveLength(7);
    expect(fixturePages.warnings[0]?.kind).toBe("references_start");
  });

  it("requires pages numbered 1..N", () => {
    const r = PagesFileSchema.safeParse({
      title: "t",
      pages: [
        { n: 1, text: "a" },
        { n: 3, text: "b" },
      ],
    });
    expect(r.success).toBe(false);
  });
});
