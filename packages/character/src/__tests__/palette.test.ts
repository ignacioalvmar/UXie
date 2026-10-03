import { describe, expect, it } from "vitest";
import { CHARACTERS, mix, normalizeHex, resolveColors } from "../palette";

describe("palette", () => {
  it("normalizes hex", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" #A1B2C3 ")).toBe("#a1b2c3");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });

  it("mixes colors", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#123456", "#ffffff", 0)).toBe("#123456");
  });

  it("falls back to the original palette on invalid overrides", () => {
    const c = resolveColors("miso", { body: "not-a-color" });
    expect(c.base).toBe(CHARACTERS.miso.colors.body.toLowerCase());
  });

  it("gives Miso and Luma a body matching the head, Pip a lighter tint", () => {
    expect(resolveColors("luma").belly).toBe(resolveColors("luma").base);
    expect(resolveColors("miso").belly).toBe(resolveColors("miso").base);
    expect(resolveColors("pip").belly).not.toBe(resolveColors("pip").base);
  });

  it("first swatch equals the default colors", () => {
    for (const m of Object.values(CHARACTERS)) {
      expect(m.swatches.body[0]).toBe(m.colors.body);
      expect(m.swatches.accent[0]).toBe(m.colors.accent);
    }
  });
});
