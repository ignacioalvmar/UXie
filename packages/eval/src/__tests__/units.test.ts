import { describe, expect, it } from "vitest";
import {
  createLeakDetector,
  guideHints,
  helpSequenceCheck,
  looksGerman,
  privateGuideTexts,
  publicGuideTexts,
  questionMarks,
  wordCount,
} from "../checks";
import { normalizeJudge } from "../judgeSchema";
import { formatTranscript } from "../judge";
import {
  CONFUSED_SCRIPT,
  PROFILE_IDS,
  PROFILES,
  misconceptionFor,
  parseProfiles,
} from "../profiles";
import {
  harnessSettings,
  parseProviderSpec,
  parseProviderSpecs,
  settingsForSpec,
  specFromSettings,
} from "../providerSpec";
import { mapLimit, parseDuration, percentile } from "../stats";
import {
  STUDENT_PROMPT,
  cleanStudentMessage,
  parseStudentProfiles,
  studentPromptParts,
} from "../studentSim";
import { fixtures, prompts, settings, turn } from "./helpers";

const guide = fixtures["visible-cues"].guide;

describe("provider specs (PRD §13.4)", () => {
  it("parses tutor, effort and state model", () => {
    expect(
      parseProviderSpec("anthropic:claude-sonnet-5-5@medium+anthropic:claude-haiku-4-5"),
    ).toEqual({
      label: "anthropic:claude-sonnet-5-5@medium+anthropic:claude-haiku-4-5",
      tutor: { provider: "anthropic", model: "claude-sonnet-5-5" },
      state: { provider: "anthropic", model: "claude-haiku-4-5" },
      effort: "medium",
    });
    expect(parseProviderSpec("google:gemini-3.8-flash")).toEqual({
      label: "google:gemini-3.8-flash",
      tutor: { provider: "google", model: "gemini-3.8-flash" },
    });
    // PowerShell turns `a,b` into `a b`.
    expect(parseProviderSpecs("mock:a mock:b@low").map((s) => s.label)).toEqual([
      "mock:a",
      "mock:b@low",
    ]);
    expect(parseProviderSpecs(undefined)).toEqual([]);
  });

  it("rejects unknown providers, missing models and bad effort", () => {
    expect(() => parseProviderSpec("acme:model")).toThrow(/provider one of/);
    expect(() => parseProviderSpec("anthropic:")).toThrow(/Invalid provider spec/);
    expect(() => parseProviderSpec("anthropic:x@turbo")).toThrow(/Invalid effort/);
  });

  it("keeps the configured state model for the same provider and fills catalog prices", () => {
    const base = {
      ...settings,
      roles: {
        tutor: { provider: "anthropic" as const, model: "claude-sonnet-5-5" },
        state: { provider: "anthropic" as const, model: "claude-haiku-4-5" },
        judge: { provider: "anthropic" as const, model: "claude-sonnet-5-5" },
      },
      prices: {},
    };
    const s = settingsForSpec(base, parseProviderSpec("anthropic:claude-opus-5-5@medium"));
    expect(s.roles.tutor.model).toBe("claude-opus-5-5");
    expect(s.roles.state.model).toBe("claude-haiku-4-5");
    expect(s.effort).toBe("medium");
    expect(s.prices["claude-opus-5-5"]?.out).toBe(20);
    expect(s.contextWindow).toBe(1_000_000);
    // Another vendor without an explicit state model: the tutor model also assesses.
    const g = settingsForSpec(base, parseProviderSpec("google:gemini-3.8-flash"));
    expect(g.roles.state).toEqual({ provider: "google", model: "gemini-3.8-flash" });
    expect(specFromSettings(base).label).toBe(
      "anthropic:claude-sonnet-5-5@low+anthropic:claude-haiku-4-5",
    );
    expect(harnessSettings(base).roles.tutor).toEqual(base.roles.judge);
  });
});

describe("profiles (PRD §13.1)", () => {
  it("defaults to all nine profiles and validates names", () => {
    expect(parseProfiles(undefined)).toHaveLength(9);
    expect(parseProfiles("lazy, german").map((p) => p.id)).toEqual(["lazy", "german"]);
    expect(() => parseProfiles("sleepy")).toThrow(/Unknown profile/);
  });

  it("has a prompt section for every LLM-played profile", () => {
    const { sections, frame } = parseStudentProfiles(prompts.get(STUDENT_PROMPT));
    expect(frame).toContain("{{max_words}}");
    for (const id of PROFILE_IDS) {
      if (PROFILES[id].script) continue;
      expect(sections.has(id), id).toBe(true);
    }
  });

  it("gives the overconfident student a misconception from the guide", () => {
    expect(misconceptionFor(guide)).toBe("Affordances are visual properties of an object.");
  });

  it("student sees tutor replies as user turns, so the request ends with the tutor", () => {
    const paper = {
      versionId: "v",
      paperId: "v",
      title: "t",
      pageCount: 1,
      pages: [{ n: 1, text: "x" }],
      guide,
      tokenEstimate: 1,
    };
    const parts = studentPromptParts(prompts, {
      paper,
      profile: PROFILES.overconfident,
      vars: { misconception: "M", project: "P" },
      turns: [turn({ turn: 0, reply: "Hi!" }), turn({ turn: 1, student: "S1", reply: null })],
      turnNumber: 2,
      totalTurns: 12,
    });
    expect(parts.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(parts.messages.at(-1)!.content).toMatch(/could not reply/);
    expect(parts.dynamicSystem).toContain('"M"');
    expect(parts.stablePrefix).toContain("<paper");
    expect(parts.stablePrefix).not.toContain("teaching_guide");
  });

  it("cleans role-play artefacts from student messages", () => {
    expect(cleanStudentMessage('Student: "Just tell me."')).toBe("Just tell me.");
    expect(cleanStudentMessage("  ")).toBe("I'm not sure.");
  });
});

describe("automatic checks (PRD §13.3)", () => {
  it("counts words and question marks", () => {
    expect(wordCount("one two  three\nfour")).toBe(4);
    expect(questionMarks("Why? How? Really?")).toBe(3);
  });

  it("finds 8-word overlaps with private guide text but not with public text", () => {
    const detect = createLeakDetector({
      privateTexts: [...privateGuideTexts(guide), prompts.get("tutor/base_rules.md")],
      teachingTexts: guideHints(guide),
      publicTexts: [
        ...fixtures["visible-cues"].pagesFile.pages.map((p) => p.text),
        ...publicGuideTexts(guide),
      ],
    });
    const hint = guide.objectives[0]!.hints[0]!;
    // One hint is teaching (the hint directive hands it over); several at once is a dump.
    expect(detect(`Here is a hint: ${hint}`)).toEqual([]);
    const [h1, h2] = guide.objectives[1]!.hints;
    expect(detect(`Hints: ${hint} ${h1} ${h2}`).length).toBeGreaterThan(0);
    expect(detect(`Check: ${guide.objectives[0]!.mastery_check}`).length).toBeGreaterThan(0);
    expect(
      detect("End every reply with exactly ONE focused question for the student."),
    ).not.toEqual([]);
    // Ladder questions are meant to be asked verbatim.
    expect(detect(guide.objectives[0]!.question_ladder[1]!)).toEqual([]);
    expect(detect("Affordances describe what is possible [p. 2]. What changed?")).toEqual([]);
  });

  it("tells German from English replies", () => {
    expect(
      looksGerman("Was ist der Unterschied zwischen den beiden Begriffen? Schau dir Seite 2 an."),
    ).toBe(true);
    expect(looksGerman("What is the difference between the two terms? Look at page 2.")).toBe(
      false,
    );
  });

  it("FR-4.6 help sequence: escalates, explains by STUCK_THRESHOLD, then checks", () => {
    const seq = (levels: string[], explainReply = "Here is the idea [p. 2]. Can you restate it?") =>
      helpSequenceCheck(
        [
          turn({ turn: 0 }),
          ...levels.map((help, i) =>
            turn({ turn: i + 1, help, reply: help === "explain" ? explainReply : "Hint?" }),
          ),
        ],
        3,
      );
    expect(seq(["hint:0", "hint:1", "explain", "check"]).pass).toBe(true);
    expect(seq(["hint:0", "hint:1", "hint:2", "explain"]).explainedInTime).toBe(false);
    expect(seq(["hint:1", "hint:0", "explain"]).escalates).toBe(false);
    expect(seq(["hint:0", "hint:1", "explain", "ask"]).checkFollows).toBe(false);
    expect(seq(["hint:0", "hint:1", "explain"], "Here is the idea.").checkFollows).toBe(false);
    expect(seq(["ask", "ask", "ask"]).explainTurn).toBeNull();
    expect(CONFUSED_SCRIPT.length).toBeGreaterThan(3);
  });
});

describe("judge plumbing (PRD §13.2)", () => {
  it("clamps scores to their scales", () => {
    const out = normalizeJudge({
      turns: [
        {
          turn: 1,
          accuracy: 5,
          citations: -1,
          cited_claims: 2,
          supported_cited_claims: 7,
          scaffolding: 1.6,
          one_question: 3,
          illustration_labelled: null,
          tone: 2,
          leakage: false,
          shortcut_compliance: null,
          followed_injected_instruction: false,
        },
      ],
      run: {
        answer_dump: false,
        leakage: false,
        misconception_surfaced: null,
        misconception_resolved: null,
        redundant_requestioning: false,
        language_matched: true,
        profile_pass: true,
        notes: "",
      },
    });
    expect(out.turns[0]).toMatchObject({
      accuracy: 2,
      citations: 0,
      supported_cited_claims: 2,
      scaffolding: 2,
      one_question: 1,
    });
  });

  it("formats the transcript with help levels and shortcut flags", () => {
    const text = formatTranscript([
      turn({ turn: 0, reply: "Welcome!" }),
      turn({ turn: 1, student: "Summarise it", help: "hint:0", shortcutRequest: true }),
      turn({ turn: 2, student: "?", reply: null, error: "timeout" }),
    ]);
    expect(text).toContain("[turn 0] STUDENT: [Started the conversation]");
    expect(text).toContain("[turn 1] TUTOR (help: hint 1, mode: understand, shortcut request)");
    expect(text).toContain("(reply failed: timeout)");
  });
});

describe("stats", () => {
  it("percentiles, durations and bounded concurrency", async () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 95)).toBeNull();
    expect(parseDuration("2m")).toBe(120_000);
    expect(parseDuration("1.5s")).toBe(1500);
    expect(() => parseDuration("soon")).toThrow();
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (x) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return x * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});
