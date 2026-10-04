import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce, staticSecurityHeaders } from "./security";

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.split(" ")[0] === name)
    ?.split(" ")
    .slice(1);

describe("NFR-9 security headers", () => {
  const prod = contentSecurityPolicy({
    nonce: "abc123",
    supabaseUrl: "https://xyz.supabase.co/",
    dev: false,
    https: true,
  });

  it("production CSP: nonce + strict-dynamic, no unsafe-eval, no framing", () => {
    expect(directive(prod, "script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(prod).not.toContain("unsafe-eval");
    expect(directive(prod, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(prod, "object-src")).toEqual(["'none'"]);
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("allows the Supabase origin for signed PDF URLs and direct uploads only", () => {
    expect(directive(prod, "connect-src")).toEqual(["'self'", "https://xyz.supabase.co"]);
    const none = contentSecurityPolicy({ nonce: "n", supabaseUrl: "not a url", dev: false });
    expect(directive(none, "connect-src")).toEqual(["'self'"]);
  });

  it("dev CSP allows eval for next dev; plain http is not upgraded", () => {
    const dev = contentSecurityPolicy({ nonce: "n", dev: true, https: false });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("HSTS only in production", () => {
    const keys = (p: boolean) => staticSecurityHeaders(p).map((h) => h.key);
    expect(keys(true)).toContain("Strict-Transport-Security");
    expect(keys(false)).not.toContain("Strict-Transport-Security");
    expect(keys(false)).toEqual(
      expect.arrayContaining(["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options"]),
    );
  });

  it("nonces are random base64", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});
