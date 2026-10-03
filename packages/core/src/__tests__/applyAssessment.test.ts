import { describe, expect, it } from "vitest";
import {
  LearnerStateSchema,
  MAX_MISCONCEPTIONS,
  applyAssessment,
  initialState,
  meetsNorthStar,
  nextObjectiveId,
  progressView,
  resetState,
  switchMode,
  type Assessment,
  type LearnerState,
  type TurnEvent,
} from "../index";
import { miniGuide as guide } from "./fixtures";

const config = { stuckThreshold: 3 };
const message: TurnEvent = { type: "message" };

const assess = (patch: Partial<Assessment> = {}): Assessment => ({
  intent: "answer",
  answer_quality: "partial",
  objective_updates: [],
  misconception: null,
  misconception_resolved: null,
  language: "en",
  ...patch,
});

const run = (state: LearnerState, assessment: Assessment | null, event: TurnEvent = message) =>
  applyAssessment({ state, guide, assessment, event, config });

const fresh = () => initialState(guide);

describe("initialState / resetState / switchMode", () => {
  it("starts on the first objective of the mode's kind, all not_started, valid per schema", () => {
    const s = fresh();
    expect(s.active_objective).toBe("U1");
    expect(Object.values(s.objectives).every((v) => v === "not_started")).toBe(true);
    expect(LearnerStateSchema.parse(s)).toEqual(s);
    expect(initialState(guide, "apply").active_objective).toBe("A1");
    expect(initialState(guide, "critique").active_objective).toBe("C1");
    expect(initialState(guide, "build").active_objective).toBeNull();
  });

  it("FR-3.5 resetState equals a fresh state in the given mode", () => {
    expect(resetState(guide, "apply")).toEqual(initialState(guide, "apply"));
  });

  it("FR-4.7 switchMode keeps progress and restarts the ladder on the new kind", () => {
    const s: LearnerState = {
      ...fresh(),
      attempts: 2,
      stuck_requests: 1,
      active_question_index: 1,
      objectives: { ...fresh().objectives, U1: "demonstrated", A1: "in_progress" },
      evidence: { U1: "said it" },
      history_summary: "summary",
      language: "de",
    };
    const t = switchMode(s, "apply", guide);
    expect(t).toMatchObject({
      mode: "apply",
      active_objective: "A1",
      active_question_index: 0,
      attempts: 0,
      stuck_requests: 0,
      last_help_level: { kind: "ask" },
    });
    expect(t.objectives).toEqual(s.objectives);
    expect(t.evidence).toEqual(s.evidence);
    expect(t.history_summary).toBe("summary");
    expect(t.language).toBe("de");
    expect(switchMode(s, "understand", guide)).toBe(s);
  });

  it("nextObjectiveId wraps around and skips demonstrated objectives", () => {
    const o = { ...fresh().objectives, U1: "in_progress" as const };
    expect(nextObjectiveId(guide, o, "understand", "U2")).toBe("U1");
    expect(nextObjectiveId(guide, { ...o, U1: "demonstrated" }, "understand", "U2")).toBeNull();
    expect(nextObjectiveId(guide, o, "build")).toBeNull();
  });
});

describe("applyAssessment: intents (PRD §8.2)", () => {
  it("FR-4.6 correct answer resets counters and moves up the ladder", () => {
    const { state, help } = run(
      { ...fresh(), attempts: 2, stuck_requests: 1 },
      assess({ answer_quality: "correct" }),
    );
    expect(state).toMatchObject({ attempts: 0, stuck_requests: 0, active_question_index: 1 });
    expect(help).toEqual({ kind: "ask" });
  });

  it.each(["partial", "incorrect", "none"] as const)(
    "FR-4.6 %s answer increments attempts",
    (q) => {
      const { state, help } = run(fresh(), assess({ answer_quality: q }));
      expect(state.attempts).toBe(1);
      expect(state.active_question_index).toBe(0);
      expect(help).toEqual({ kind: "hint", index: 0 });
    },
  );

  it.each(["question", "meta", "greeting"] as const)("%s does not change attempts", (intent) => {
    const { state, flags } = run(
      { ...fresh(), attempts: 1 },
      assess({ intent, answer_quality: "none" }),
    );
    expect(state.attempts).toBe(1);
    expect(flags).toEqual({ shortcutRequest: false, offTopic: false });
  });

  it("FR-4.4 shortcut request sets the flag without counting as an attempt or stuck request", () => {
    const { state, flags, help } = run(
      fresh(),
      assess({ intent: "shortcut_request", answer_quality: "none" }),
    );
    expect(flags.shortcutRequest).toBe(true);
    expect(state.attempts).toBe(0);
    expect(state.stuck_requests).toBe(0);
    expect(help).toEqual({ kind: "ask" });
  });

  it("FR-4.5 off-topic sets the flag without counting as an attempt", () => {
    const { state, flags } = run(fresh(), assess({ intent: "off_topic", answer_quality: "none" }));
    expect(flags.offTopic).toBe(true);
    expect(state.attempts).toBe(0);
  });

  it("stores the detected language", () => {
    expect(run(fresh(), assess({ language: "DE" })).state.language).toBe("de");
  });
});

describe("applyAssessment: help ladder sequence", () => {
  it("FR-4.6 escalates ask → hint → hint → explain at STUCK_THRESHOLD, then check, then ask", () => {
    let s = fresh();
    const levels: string[] = [];
    const wrong = assess({ answer_quality: "incorrect" });
    for (let i = 0; i < 5; i++) {
      const r = run(s, wrong);
      s = r.state;
      levels.push(r.help.kind === "hint" ? `hint${r.help.index}` : r.help.kind);
    }
    expect(levels).toEqual(["hint0", "hint1", "explain", "check", "hint0"]);
  });

  it("FR-4.6 'Explain it to me' (stuck event) escalates the same way", () => {
    let s = fresh();
    const levels: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = run(s, null, { type: "stuck" });
      s = r.state;
      levels.push(r.help.kind);
    }
    expect(levels).toEqual(["hint", "hint", "explain", "check"]);
  });

  it("check resets attempts and stuck_requests afterwards", () => {
    const s = {
      ...fresh(),
      attempts: 2,
      stuck_requests: 1,
      last_help_level: { kind: "explain" as const },
    };
    const { state, help } = run(s, assess({ answer_quality: "partial" }));
    expect(help).toEqual({ kind: "check" });
    expect(state).toMatchObject({
      attempts: 0,
      stuck_requests: 0,
      last_help_level: { kind: "check" },
    });
  });

  it("records the chosen help level as last_help_level", () => {
    expect(run(fresh(), assess()).state.last_help_level).toEqual({ kind: "hint", index: 0 });
  });
});

describe("applyAssessment: objectives", () => {
  it("applies forward transitions only", () => {
    const s = { ...fresh(), objectives: { ...fresh().objectives, U2: "demonstrated" as const } };
    const { state } = run(
      s,
      assess({
        objective_updates: [
          { objective_id: "U2", status: "in_progress", evidence: "" },
          { objective_id: "A1", status: "in_progress", evidence: "" },
        ],
      }),
    );
    expect(state.objectives.U2).toBe("demonstrated");
    expect(state.objectives.A1).toBe("in_progress");
  });

  it("demonstrated requires non-empty evidence", () => {
    const { state } = run(
      fresh(),
      assess({
        objective_updates: [{ objective_id: "A1", status: "demonstrated", evidence: "  " }],
      }),
    );
    expect(state.objectives.A1).toBe("not_started");
    expect(state.evidence.A1).toBeUndefined();
  });

  it("ignores unknown objective ids", () => {
    const { state } = run(
      fresh(),
      assess({
        objective_updates: [{ objective_id: "Z9", status: "demonstrated", evidence: "x" }],
      }),
    );
    expect(state.objectives).toEqual(fresh().objectives);
  });

  it("M7 demonstrating the active objective stores evidence and advances to the next one", () => {
    const { state, help } = run(
      { ...fresh(), attempts: 1, active_question_index: 1 },
      assess({
        answer_quality: "correct",
        objective_updates: [
          { objective_id: "U1", status: "demonstrated", evidence: " explained it well " },
        ],
      }),
    );
    expect(state.objectives.U1).toBe("demonstrated");
    expect(state.evidence.U1).toBe("explained it well");
    expect(state).toMatchObject({ active_objective: "U2", active_question_index: 0, attempts: 0 });
    expect(help).toEqual({ kind: "ask" });
  });

  it("demonstrating a non-active objective does not move the active one", () => {
    const { state } = run(
      fresh(),
      assess({
        objective_updates: [{ objective_id: "U2", status: "demonstrated", evidence: "e" }],
      }),
    );
    expect(state.active_objective).toBe("U1");
    expect(state.objectives.U2).toBe("demonstrated");
  });

  it("exhausting the ladder moves to the next objective of the mode's kind", () => {
    const { state } = run(
      { ...fresh(), active_question_index: 1 },
      assess({ answer_quality: "correct" }),
    );
    expect(state).toMatchObject({ active_objective: "U2", active_question_index: 0 });
    expect(state.objectives.U1).toBe("not_started");
  });

  it("exhausted ladder with no other open objective stays on the last question", () => {
    const s = {
      ...fresh(),
      active_objective: "U2",
      active_question_index: 2,
      objectives: { ...fresh().objectives, U1: "demonstrated" as const },
    };
    const { state } = run(s, assess({ answer_quality: "correct" }));
    expect(state).toMatchObject({ active_objective: "U2", active_question_index: 2 });
  });

  it("returns to an earlier open objective when later ones are done", () => {
    const s = {
      ...fresh(),
      active_objective: "U2",
      active_question_index: 2,
      objectives: { ...fresh().objectives, U1: "in_progress" as const },
    };
    expect(run(s, assess({ answer_quality: "correct" })).state.active_objective).toBe("U1");
  });

  it("active objective becomes null when every objective of the mode is demonstrated", () => {
    const s = {
      ...fresh(),
      active_objective: "U2",
      objectives: { ...fresh().objectives, U1: "demonstrated" as const },
    };
    const { state } = run(
      s,
      assess({
        objective_updates: [{ objective_id: "U2", status: "demonstrated", evidence: "e" }],
      }),
    );
    expect(state.active_objective).toBeNull();
    expect(state.active_question_index).toBe(0);
  });
});

describe("applyAssessment: misconceptions", () => {
  it("appends, dedupes case-insensitively, and resolves", () => {
    let s = run(
      fresh(),
      assess({ misconception: { objective_id: "U1", text: "Affordances are visual" } }),
    ).state;
    s = run(
      s,
      assess({ misconception: { objective_id: "U1", text: " affordances ARE visual " } }),
    ).state;
    expect(s.misconceptions_seen).toEqual([
      { objective: "U1", text: "Affordances are visual", resolved: false },
    ]);
    s = run(s, assess({ misconception_resolved: "AFFORDANCES are visual" })).state;
    expect(s.misconceptions_seen[0]!.resolved).toBe(true);
  });

  it("attributes misconceptions with unknown objective ids to the active objective", () => {
    const s = run(fresh(), assess({ misconception: { objective_id: "", text: "wrong" } })).state;
    expect(s.misconceptions_seen[0]!.objective).toBe("U1");
  });

  it(`caps the list at ${MAX_MISCONCEPTIONS}`, () => {
    let s = fresh();
    for (let i = 0; i < MAX_MISCONCEPTIONS + 5; i++) {
      s = run(s, assess({ misconception: { objective_id: "U1", text: `m${i}` } })).state;
    }
    expect(s.misconceptions_seen).toHaveLength(MAX_MISCONCEPTIONS);
    expect(LearnerStateSchema.safeParse(s).success).toBe(true);
  });
});

describe("applyAssessment: events and failure", () => {
  it("FR-3.5 assessment failure keeps the previous state (no attempt increment)", () => {
    const s = { ...fresh(), attempts: 1 };
    const { state, help } = run(s, null);
    expect(state).toEqual({ ...s, last_help_level: { kind: "hint", index: 0 } });
    expect(help).toEqual({ kind: "hint", index: 0 });
  });

  it("FR-4.1 start event leaves the state as is and asks", () => {
    const { state, help } = run(fresh(), null, { type: "start" });
    expect(state).toEqual(fresh());
    expect(help).toEqual({ kind: "ask" });
  });

  it("mode_switch event switches mode via switchMode", () => {
    const { state, help } = run({ ...fresh(), attempts: 2 }, null, {
      type: "mode_switch",
      mode: "apply",
    });
    expect(state).toMatchObject({ mode: "apply", active_objective: "A1", attempts: 0 });
    expect(help).toEqual({ kind: "ask" });
  });

  it("reset event returns a fresh state in the current mode", () => {
    const s = { ...initialState(guide, "apply"), attempts: 2, evidence: { A1: "x" } };
    expect(run(s, null, { type: "reset" }).state).toEqual(initialState(guide, "apply"));
  });

  it("never mutates its input", () => {
    const s = fresh();
    const snapshot = structuredClone(s);
    run(s, assess({ misconception: { objective_id: "U1", text: "m" }, answer_quality: "correct" }));
    expect(s).toEqual(snapshot);
  });
});

describe("applyAssessment: monotonicity (property)", () => {
  // Deterministic pseudo-random sequences (mulberry32), so failures are reproducible.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const RANK = { not_started: 0, in_progress: 1, demonstrated: 2 } as const;
  const ids = ["U1", "U2", "A1", "C1", "X9"];

  it("objective statuses never move backwards and state stays schema-valid", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = rng(seed);
      let s = initialState(guide, pick(r, ["understand", "apply", "critique", "build"] as const));
      for (let turn = 0; turn < 40; turn++) {
        const event: TurnEvent =
          r() < 0.1
            ? { type: "stuck" }
            : r() < 0.05
              ? {
                  type: "mode_switch",
                  mode: pick(r, ["understand", "apply", "critique", "build"] as const),
                }
              : message;
        const a =
          event.type === "message" && r() > 0.1
            ? assess({
                intent: pick(r, [
                  "answer",
                  "question",
                  "shortcut_request",
                  "off_topic",
                  "meta",
                  "greeting",
                ] as const),
                answer_quality: pick(r, ["correct", "partial", "incorrect", "none"] as const),
                objective_updates: [
                  {
                    objective_id: pick(r, ids),
                    status: pick(r, ["in_progress", "demonstrated"] as const),
                    evidence: pick(r, ["", "said so"]),
                  },
                ],
              })
            : null;
        const next = run(s, a, event).state;
        for (const id of Object.keys(s.objectives)) {
          expect(RANK[next.objectives[id]!]).toBeGreaterThanOrEqual(RANK[s.objectives[id]!]);
        }
        expect(LearnerStateSchema.safeParse(next).success).toBe(true);
        s = next;
      }
    }
  });
});

describe("progressView / meetsNorthStar", () => {
  it("lists objective statements and statuses without guide internals", () => {
    const s = {
      ...fresh(),
      objectives: { ...fresh().objectives, U1: "demonstrated" as const },
      evidence: { U1: "e" },
    };
    const view = progressView(s, guide);
    expect(view[0]).toEqual({
      id: "U1",
      kind: "understanding",
      statement: "Understand concept one.",
      status: "demonstrated",
      evidence: "e",
      active: true,
    });
    expect(JSON.stringify(view)).not.toMatch(/hint|ladder|mastery/i);
  });

  it("north-star proxy needs one understanding AND one application objective demonstrated", () => {
    const o = fresh().objectives;
    expect(meetsNorthStar({ ...fresh(), objectives: { ...o, U1: "demonstrated" } }, guide)).toBe(
      false,
    );
    expect(
      meetsNorthStar(
        { ...fresh(), objectives: { ...o, U2: "demonstrated", A1: "demonstrated" } },
        guide,
      ),
    ).toBe(true);
  });
});
