import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { PagesFileSchema, TeachingGuideSchema, type TeachingGuide } from "../index";

export const fixtureDir = new URL("../../../../fixtures/papers/visible-cues/", import.meta.url);

export const fixtureGuideYaml = readFileSync(new URL("guide.yaml", fixtureDir), "utf8");
export const fixtureGuideRaw: unknown = parse(fixtureGuideYaml);
export const fixtureGuide: TeachingGuide = TeachingGuideSchema.parse(fixtureGuideRaw);
export const fixturePages = PagesFileSchema.parse(
  JSON.parse(readFileSync(new URL("pages.json", fixtureDir), "utf8")),
);

/** A small hand-made guide for state-machine tests: U1, U2 understanding; A1 application; C1. */
export const miniGuide: TeachingGuide = TeachingGuideSchema.parse({
  schema_version: 1,
  title: "Mini",
  summary_for_tutor: "Test guide.",
  starter_questions: ["Q1?", "Q2?"],
  objectives: [
    {
      id: "U1",
      kind: "understanding",
      statement: "Understand concept one.",
      refs: [{ page: 1 }],
      key_concepts: ["one"],
      question_ladder: ["U1 q1", "U1 q2"],
      hints: ["U1 h1", "U1 h2", "U1 h3"],
      mastery_check: "Explains concept one.",
    },
    {
      id: "A1",
      kind: "application",
      statement: "Apply concept one.",
      refs: [{ page: 2 }],
      key_concepts: ["one"],
      question_ladder: ["A1 q1", "A1 q2"],
      hints: ["A1 h1", "A1 h2"],
      mastery_check: "Applies concept one.",
    },
    {
      id: "U2",
      kind: "understanding",
      statement: "Understand concept two.",
      refs: [{ page: 2 }],
      key_concepts: ["two"],
      question_ladder: ["U2 q1", "U2 q2", "U2 q3"],
      hints: ["U2 h1", "U2 h2"],
      mastery_check: "Explains concept two.",
    },
    {
      id: "C1",
      kind: "critique",
      statement: "Critique the evidence.",
      refs: [{ page: 3 }],
      key_concepts: ["evidence"],
      question_ladder: ["C1 q1", "C1 q2"],
      hints: ["C1 h1", "C1 h2"],
      mastery_check: "Names two limitations.",
    },
  ],
  ux_scenarios: ["A scenario."],
});
