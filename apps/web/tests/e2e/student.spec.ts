import { expect, test, type Page } from "@playwright/test";
import {
  appUrlFromEmailLink,
  deleteE2eUsers,
  expectAccessible,
  latestLink,
  newEmail,
  PASSWORD,
  SEED_PAPER_SLUG,
  watchConsole,
} from "./support";

/**
 * PRD §15 E2E: register → verify (Mailpit) → onboard → library → workspace → chat 3 turns (mock
 * LLM) → citation click → stuck → progress → start over, with axe scans on every student page.
 */
test.describe.configure({ mode: "serial" });
test.afterAll(async () => deleteE2eUsers());

const email = newEmail("student");
let page: Page;

test.beforeAll(async ({ browser, baseURL }) => {
  // axe needs a page from an explicit context.
  page = await (await browser.newContext({ baseURL })).newPage();
});

/** Runs a chat action and waits until UXie's reply has finished (a new feedback bar, no Stop). */
async function turn(action: () => Promise<void>) {
  const done = page.getByRole("button", { name: "Helpful" });
  const before = await done.count();
  await action();
  await expect.poll(() => done.count(), { timeout: 30_000 }).toBeGreaterThan(before);
  await expect(page.getByRole("button", { name: "Stop" })).toBeHidden();
}

test("FR-1.1/1.2 register and verify the email", async ({ baseURL }) => {
  await page.goto("/auth/sign-up");
  await page.getByLabel("University email").fill(email);
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/auth\/verify/);
  await expectAccessible(page, "/auth/verify");

  const link = await latestLink(email, /confirm/i);
  await page.goto(await appUrlFromEmailLink(link, baseURL!));
  await page.waitForURL(/\/onboarding/);
});

test("FR-1.3 onboarding: privacy notice, character, consent", async () => {
  await expectAccessible(page, "/onboarding");
  await page.getByText("Miso", { exact: true }).click();
  await page.getByLabel("I have read the privacy notice above.").check();
  await page.getByRole("button", { name: "Continue to UXie" }).click();
  await page.waitForURL((u) => u.pathname === "/");
});

test("FR-2.1 library lists the published paper", async () => {
  await expectAccessible(page, "library");
  await page.locator(`a[href="/papers/${SEED_PAPER_SLUG}"]`).first().click();
  await page.waitForURL(new RegExp(`/papers/${SEED_PAPER_SLUG}`));
  await expect(page.getByRole("heading", { name: "Start with a question" })).toBeVisible();
});

test("FR-3.x workspace: three turns with citations, stuck, progress", async () => {
  const watch = watchConsole(page);
  await expectAccessible(page, "workspace (empty)");

  // Turn 1: a starter question.
  await page.getByRole("heading", { name: "Start with a question" }).waitFor();
  await turn(() => page.locator('section[aria-labelledby="starters-h"] button').first().click());

  // Turns 2 and 3: typed answers (Enter sends).
  const composer = page.getByLabel("Reply to Miso");
  await composer.fill("A signifier is the cue that shows what you can do.");
  await turn(() => composer.press("Enter"));
  await composer.fill("The affordance stayed the same; only the cue changed.");
  await turn(() => page.getByRole("button", { name: "Send" }).click());
  await expect(page.getByText("A signifier is the cue that shows what you can do.")).toBeVisible();

  // FR-3.4 a citation chip opens the cited page in the reader.
  await page.getByRole("button", { name: "Open page 1 in the paper" }).last().click();
  await expect(page.getByText("Cited in chat · p. 1")).toBeVisible();

  // FR-4.3 "Explain it to me" climbs the help ladder.
  await turn(() => page.getByRole("button", { name: "Explain it to me" }).click());
  await expect(page.getByText(/\(mock UXie, hint\)/).last()).toBeVisible();

  // FR-4.6 progress drawer.
  await page.getByRole("button", { name: /^Progress:/ }).click();
  const drawer = page.getByRole("dialog", { name: "Your progress" });
  await expect(drawer).toBeVisible();
  await expectAccessible(page, "progress drawer");
  await drawer.getByRole("button", { name: "Close progress" }).click();
  await expect(drawer).toBeHidden();

  await expectAccessible(page, "workspace (conversation)");
  expect(watch.problems).toEqual([]);
});

test("FR-3.5 start over keeps the old conversation readable", async () => {
  await page.getByRole("button", { name: "Start over" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Start over?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Start over" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Helpful" })).toHaveCount(0);

  await page.goto("/conversations");
  await expectAccessible(page, "/conversations");
  await expect(page.getByRole("main")).toContainText(/Visible Cues/);
});

test("FR-8.1 account page", async () => {
  await page.goto("/account");
  await expectAccessible(page, "/account");
});
