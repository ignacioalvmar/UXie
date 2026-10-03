import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SecretsError, decryptSecret, encryptSecret, encryptionKeyId } from "./secrets";

const key = randomBytes(32).toString("base64");
const otherKey = randomBytes(32).toString("base64");

describe("provider key encryption (FR-9.7)", () => {
  it("round-trips and never contains the plaintext", () => {
    const sealed = encryptSecret("sk-ant-api03-secret", key, "llm_settings:anthropic");
    expect(sealed).not.toContain("secret");
    expect(sealed.startsWith(`v1.${encryptionKeyId(key)}.`)).toBe(true);
    expect(decryptSecret(sealed, key, "llm_settings:anthropic")).toBe("sk-ant-api03-secret");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", key, "a")).not.toBe(encryptSecret("same", key, "a"));
  });

  it("refuses a different key, other associated data, and tampering", () => {
    const sealed = encryptSecret("sk-x", key, "llm_settings:openai");
    expect(() => decryptSecret(sealed, otherKey, "llm_settings:openai")).toThrow(
      /different SETTINGS_ENCRYPTION_KEY/,
    );
    expect(() => decryptSecret(sealed, key, "llm_settings:google")).toThrow(SecretsError);
    const parts = sealed.split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key, "llm_settings:openai")).toThrow(SecretsError);
    expect(() => decryptSecret("garbage", key, "x")).toThrow(/format/);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"), "a")).toThrow(/32 bytes/);
  });
});
