import { describe, expect, it } from "vitest";
import { computeHelpLevel, initialState, type HelpLevel, type LearnerState } from "../index";
import { miniGuide } from "./fixtures";

const cfg = { stuckThreshold: 3 };
const at = (patch: Partial<LearnerState>): LearnerState => ({
  ...initialState(miniGuide),
  ...patch,
});

describe("computeHelpLevel (PRD §3.3, §8.2)", () => {
  const cases: [string, Partial<LearnerState>, HelpLevel][] = [
    ["n = 0 → ask", {}, { kind: "ask" }],
    ["attempts 1 → hint 0", { attempts: 1 }, { kind: "hint", index: 0 }],
    ["stuck 1 → hint 0", { stuck_requests: 1 }, { kind: "hint", index: 0 }],
    [
      "attempts 1 + stuck 1 → hint 1",
      { attempts: 1, stuck_requests: 1 },
      { kind: "hint", index: 1 },
    ],
    ["n = threshold → explain", { attempts: 3 }, { kind: "explain" }],
    ["n > threshold → explain", { attempts: 2, stuck_requests: 4 }, { kind: "explain" }],
    [
      "after explain → check, whatever n is",
      { attempts: 5, last_help_level: { kind: "explain" } },
      { kind: "check" },
    ],
    ["after check with n = 0 → ask", { last_help_level: { kind: "check" } }, { kind: "ask" }],
    [
      "after hint → still follows n",
      { attempts: 2, last_help_level: { kind: "hint", index: 0 } },
      { kind: "hint", index: 1 },
    ],
  ];

  it.each(cases)("FR-4.6 %s", (_name, patch, expected) => {
    expect(computeHelpLevel(at(patch), miniGuide, cfg)).toEqual(expected);
  });

  it("caps the hint index at the last hint", () => {
    const state = at({ active_objective: "A1", attempts: 4 }); // A1 has 2 hints
    expect(computeHelpLevel(state, miniGuide, { stuckThreshold: 10 })).toEqual({
      kind: "hint",
      index: 1,
    });
  });

  it("respects a different threshold", () => {
    expect(computeHelpLevel(at({ attempts: 1 }), miniGuide, { stuckThreshold: 1 })).toEqual({
      kind: "explain",
    });
  });

  it("without an active objective skips hints: ask until the threshold, then explain", () => {
    const none = at({ active_objective: null });
    expect(computeHelpLevel({ ...none, attempts: 1 }, miniGuide, cfg)).toEqual({ kind: "ask" });
    expect(computeHelpLevel({ ...none, stuck_requests: 3 }, miniGuide, cfg)).toEqual({
      kind: "explain",
    });
  });
});
