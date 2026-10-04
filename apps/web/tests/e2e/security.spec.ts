import { expect, test } from "@playwright/test";
import { expectAccessible, watchConsole } from "./support";

/** NFR-9 security headers and NFR-20 accessibility of the public pages. */

test("NFR-9 pages carry a nonce CSP without unsafe-eval, and scripts run under it", async ({
  page,
}) => {
  const watch = watchConsole(page);
  const res = await page.goto("/auth/sign-in");
  const h = res!.headers();
  const csp = h["content-security-policy"]!;
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();

  // Every script Next.js rendered carries this response's nonce.
  const nonce = csp.match(/'nonce-([^']+)'/)![1];
  const scripts = await page
    .locator("script")
    .evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
  expect(scripts.length).toBeGreaterThan(0);
  for (const n of scripts) expect(n).toBe(nonce);

  // Hydrated: the password toggle is a client component.
  await page.getByLabel("Show password").click();
  await expect(page.getByLabel("Hide password")).toBeVisible();
  expect(watch.problems).toEqual([]);
});

test("NFR-9 a fresh nonce per request", async ({ request }) => {
  const a = (await request.get("/auth/sign-in")).headers()["content-security-policy"];
  const b = (await request.get("/auth/sign-in")).headers()["content-security-policy"];
  expect(a).not.toBe(b);
});

test("NFR-9 mutations from another origin are refused", async ({ request }) => {
  const res = await request.post("/api/me/deletion-request", {
    headers: { origin: "https://evil.example" },
    data: {},
  });
  expect(res.status()).toBe(403);
});

test("unknown pages: dynamic 404 with the nonce'd scripts", async ({ page }) => {
  const watch = watchConsole(page);
  const res = await page.goto("/auth/does-not-exist");
  expect(res!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expectAccessible(page, "404");
  expect(watch.problems).toEqual([]);
});

for (const path of ["/auth/sign-in", "/auth/sign-up", "/auth/reset", "/privacy"]) {
  test(`NFR-20 ${path} has no axe violations`, async ({ page }) => {
    await page.goto(path);
    await expectAccessible(page, path);
  });
}
