import { describe, expect, it } from "vitest";
import { stateForTurn } from "../states";

describe("stateForTurn", () => {
  it.each([
    [{ phase: "idle" }, "idle"],
    [{ phase: "typing" }, "listening"],
    [{ phase: "assessing" }, "thinking"],
    [{ phase: "streaming", help: "ask" }, "talking"],
    [{ phase: "streaming", help: "check" }, "talking"],
    [{ phase: "streaming", help: "hint" }, "hint"],
    [{ phase: "streaming", help: "explain" }, "explain"],
    [{ phase: "streaming", help: "hint", flags: { offTopic: true } }, "puzzled"],
    [{ phase: "streaming", flags: { shortcutRequest: true } }, "puzzled"],
  ] as const)("%j -> %s", (signal, expected) => {
    expect(stateForTurn(signal)).toBe(expected);
  });
});
