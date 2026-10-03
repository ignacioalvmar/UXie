import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chunkPages, estimateTokens, promptHash, sha256Hex } from "../index";

describe("sha256Hex", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ])("matches the FIPS test vector for %j", (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it("matches node:crypto across lengths and Unicode", () => {
    for (const s of [
      "💡 Illustrative example: ä ö ü",
      "x".repeat(55),
      "y".repeat(56),
      "z".repeat(64),
      "w".repeat(1000),
    ]) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });
});

describe("promptHash (PRD §8.5)", () => {
  it("is 12 hex chars, stable, and sensitive to content and boundaries", () => {
    const h = promptHash(["base", "mode"]);
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(promptHash(["base", "mode"])).toBe(h);
    expect(promptHash(["base", "mode2"])).not.toBe(h);
    expect(promptHash(["ab", "c"])).not.toBe(promptHash(["a", "bc"]));
  });
});

describe("estimateTokens / chunkPages", () => {
  it("estimates ceil(chars / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("groups pages within the budget and never splits a page", () => {
    const page = (n: number, chars: number) => ({ n, text: "x".repeat(chars) });
    const chunks = chunkPages([page(1, 40), page(2, 40), page(3, 400), page(4, 4)], 25);
    expect(chunks.map((c) => c.map((p) => p.n))).toEqual([[1, 2], [3], [4]]);
    expect(chunkPages([], 10)).toEqual([]);
  });
});
