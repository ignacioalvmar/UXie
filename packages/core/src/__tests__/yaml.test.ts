import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { toYaml } from "../index";
import { fixtureGuide } from "./fixtures";

describe("toYaml", () => {
  it("round-trips the fixture guide through a real YAML parser", () => {
    expect(parse(toYaml(fixtureGuide))).toEqual(fixtureGuide);
  });

  it("emits nested structures deterministically", () => {
    const out = toYaml({ a: 1, "b c": ["x", { y: true, z: [] }], d: {}, e: null, f: undefined });
    expect(out).toBe('a: 1\n"b c":\n  - "x"\n  - y: true\n    z: []\nd: {}\ne: null\n');
    expect(parse(out)).toEqual({ a: 1, "b c": ["x", { y: true, z: [] }], d: {}, e: null });
  });

  it("quotes strings that would otherwise be YAML syntax", () => {
    const tricky = { s: ["yes", "- dash", "a: b", "#hash", 'quote "x"', "multi\nline", "💡"] };
    expect(parse(toYaml(tricky))).toEqual(tricky);
  });

  it("handles nested lists and top-level scalars", () => {
    expect(parse(toYaml([[1, 2], [3]]))).toEqual([[1, 2], [3]]);
    expect(toYaml("s")).toBe('"s"\n');
    expect(toYaml([])).toBe("[]\n");
    expect(() => toYaml({ f: () => 1 })).toThrow(TypeError);
  });
});
