import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

/** Shared helpers for the e2e suite (local stack only; synthetic accounts). */

export const REPO = resolve(import.meta.dirname, "../../../..");
export const SEED_PASSWORD = "uxie-dev-password"; // packages/db/scripts/seedData.ts
export const INSTRUCTOR = "instructor@thi.de";
export const SEED_PAPER_SLUG = "visible-cues";
export const fixturePdf = (name: string) =>
  readFileSync(resolve(REPO, "fixtures/papers", name, "source.pdf"));

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export function serviceDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase env missing (apps/web/.env.local or exported)");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url))
    throw new Error(`The e2e suite only runs against the local stack, not ${url}`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A fresh synthetic student address; `e2e-` accounts are removed before and after runs. */
export const newEmail = (tag: string) =>
  `e2e-${tag}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@thi.de`;
export const PASSWORD = "e2e-Password-2026!";

export async function deleteE2eUsers(db = serviceDb()) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users)
      if (u.email?.startsWith("e2e-")) await db.auth.admin.deleteUser(u.id);
    if (data.users.length < 200) break;
  }
}

/** Papers created by the instructor flow (`e2e-paper-…`), with their Storage files. */
export async function deleteE2ePapers(db = serviceDb()) {
  const { data } = await db.from("papers").select("id").like("slug", "e2e-paper-%");
  for (const { id } of (data ?? []) as { id: string }[]) {
    const paths = await db.rpc("delete_paper", { p_paper: id });
    if (paths.error) throw paths.error;
    const files = (paths.data as string[] | null) ?? [];
    if (files.length) await db.storage.from("papers").remove(files);
  }
}

/** The newest email to `to` from Mailpit (local Supabase's mail catcher) with a link. */
export async function latestLink(to: string, subject: RegExp): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=5`,
        );
        const list = (await res.json()) as { messages: { ID: string; Subject: string }[] };
        const msg = list.messages.find((m) => subject.test(m.Subject));
        if (!msg) return false;
        const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as {
          HTML: string;
          Text: string;
        };
        found = (full.HTML || full.Text).match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
        return !!found;
      },
      { timeout: 20_000, message: `email to ${to}` },
    )
    .toBe(true);
  return found!;
}

/**
 * Follows a Supabase email link and returns the app URL it redirects to, re-based on the suite's
 * base URL: the local stack's redirect allow-list may only name port 3000 (cookies ignore ports).
 */
export async function appUrlFromEmailLink(link: string, baseURL: string): Promise<string> {
  const res = await fetch(link, { redirect: "manual" });
  const location = res.headers.get("location");
  if (!location) throw new Error(`no redirect from the email link (${res.status})`);
  const target = new URL(location);
  const base = new URL(baseURL);
  target.protocol = base.protocol;
  target.host = base.host;
  return target.toString();
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth/sign-in");
  await page.getByLabel("University email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/sign-in"));
}

/** NFR-20: no WCAG 2.2 A/AA violations from axe on the current page. */
export async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

/** Collects CSP violations and uncaught errors; assert with `expect(watch.problems).toEqual([])`. */
export function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content.Security.Policy|Refused to/i.test(m.text()))
      problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return { problems };
}
