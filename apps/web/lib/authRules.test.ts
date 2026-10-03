import { describe, expect, it } from "vitest";
import { classifyAuthError, isAllowedEmail, maskEmail, safeNext, SignUpSchema } from "./authRules";

describe("FR-1.1 email domain allow-list", () => {
  it("accepts listed domains case-insensitively and rejects others", () => {
    const allowed = ["thi.de", "studmail.thi.de"];
    expect(isAllowedEmail("Ada@THI.de", allowed)).toBe(true);
    expect(isAllowedEmail("ada@studmail.thi.de", allowed)).toBe(true);
    expect(isAllowedEmail("ada@evil-thi.de", allowed)).toBe(false);
    expect(isAllowedEmail("ada@thi.de.evil.com", allowed)).toBe(false);
    expect(isAllowedEmail("ada@gmail.com", allowed)).toBe(false);
    expect(isAllowedEmail("ada@anything.org", [])).toBe(true);
  });

  it("normalises the email in the sign-up schema", () => {
    expect(SignUpSchema.parse({ email: "  Ada@THI.de ", password: "x" }).email).toBe("ada@thi.de");
    expect(SignUpSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
});

describe("redirect safety", () => {
  it("only allows same-origin relative paths outside /auth", () => {
    expect(safeNext("/papers/visible-cues")).toBe("/papers/visible-cues");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/auth/sign-in")).toBe("/");
    expect(safeNext(null, "/onboarding")).toBe("/onboarding");
  });
});

describe("auth error mapping (HANDOFF §6.2)", () => {
  it("never distinguishes wrong email from wrong password", () => {
    expect(classifyAuthError({ code: "invalid_credentials", status: 400 })).toBe("credentials");
    expect(classifyAuthError({ code: "email_not_confirmed", status: 400 })).toBe("unverified");
    expect(classifyAuthError({ status: 429 })).toBe("rate_limited");
    expect(
      classifyAuthError({
        code: "weak_password",
        message: "Password is known to be weak and easy to guess (pwned)",
      }),
    ).toBe("password_leaked");
    expect(
      classifyAuthError({
        code: "weak_password",
        message: "Password should be at least 10 characters",
      }),
    ).toBe("password_short");
    expect(
      classifyAuthError({ status: 403, message: "Only university email addresses can register." }),
    ).toBe("domain");
    expect(classifyAuthError({ status: 500 })).toBe("network");
  });

  it("masks emails for display", () => {
    expect(maskEmail("ada@thi.de")).toBe("a•••@thi.de");
  });
});
