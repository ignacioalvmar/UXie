import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  deleteE2ePapers,
  expectAccessible,
  INSTRUCTOR,
  REPO,
  SEED_PASSWORD,
  serviceDb,
  signIn,
  watchConsole,
} from "./support";

/**
 * PRD §15 E2E: the instructor publish flow (add paper → upload PDF → worker ingests → approve the
 * drafted guide → publish → delete), plus axe scans of every admin page (NFR-20).
 */
test.describe.configure({ mode: "serial" });

const slug = `e2e-paper-${Date.now().toString(36)}`;
const title = `E2E: Visible cues (${slug})`;
let page: Page;

test.beforeAll(async ({ browser, baseURL }) => {
  page = await (await browser.newContext({ baseURL })).newPage();
  await signIn(page, INSTRUCTOR, SEED_PASSWORD);
});

// A failed run may leave the paper behind.
test.afterAll(async () => deleteE2ePapers());

for (const path of [
  "/admin",
  "/admin/content",
  "/admin/conversations",
  "/admin/reports",
  "/admin/exports",
  "/admin/data-requests",
  "/admin/usage",
  "/admin/health",
  "/admin/settings/ai",
]) {
  test(`NFR-20 ${path} has no axe violations`, async () => {
    const watch = watchConsole(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectAccessible(page, path);
    expect(watch.problems).toEqual([]);
  });
}

test("FR-6.1–6.6 add a paper, ingest, approve the guide, publish", async () => {
  test.setTimeout(180_000);
  const watch = watchConsole(page);
  await page.goto("/admin/content");
  const module = page
    .locator("section")
    .filter({ hasText: "Foundations of interaction" })
    .filter({ has: page.getByRole("button", { name: "Add a paper" }) })
    .first();
  await module.getByRole("button", { name: "Add a paper" }).click();
  const form = page.getByRole("form", { name: "New paper" });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Slug").fill(slug);
  await form.getByLabel("Authors").fill("A. Fixture, B. Synthetic");
  await form.getByLabel("Year").fill("2026");
  await form.getByRole("button", { name: "Create and upload PDF" }).click();
  await page.waitForURL(/\/admin\/papers\//);
  await expectAccessible(page, "paper page");

  // FR-5.1 direct-to-Storage upload, then the worker extracts and drafts the guide.
  await page
    .getByLabel("PDF file")
    .setInputFiles(resolve(REPO, "fixtures/papers/visible-cues/source.pdf"));
  await page.getByRole("button", { name: "Upload" }).click();
  const open = page.getByRole("link", { name: /Open v1: check the extraction and the guide/ });
  await expect(open).toBeVisible({ timeout: 120_000 });
  await open.click();
  await page.waitForURL(/\/admin\/versions\//);
  await expect(page.getByRole("button", { name: "Publish version 1" })).toBeDisabled();
  await expectAccessible(page, "version page (extraction)");

  await page.getByRole("tab", { name: "Teaching guide" }).click();
  await expectAccessible(page, "version page (guide)");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Guide approved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Publish version 1" }).click();
  await expect(page.getByText("Version 1 is published.")).toBeVisible();

  const { data } = await serviceDb()
    .from("papers")
    .select("status, current_version_id")
    .eq("slug", slug)
    .single();
  expect(data).toMatchObject({ status: "published" });
  expect(data!.current_version_id).toBeTruthy();
  expect(watch.problems).toEqual([]);
});

test("FR-6.7 delete the paper permanently (typed slug)", async () => {
  await page.goto("/admin/content");
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/admin\/papers\//);
  await page.getByRole("button", { name: "Delete paper permanently…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete paper permanently?" });
  const confirm = dialog.getByRole("button", { name: "Delete permanently" });
  await expect(confirm).toBeDisabled();
  await expectAccessible(page, "delete dialog");
  await dialog.getByLabel(`Type the paper slug “${slug}” to confirm`).fill(slug);
  await confirm.click();
  await page.waitForURL(/\/admin\/content$/);
  const { data } = await serviceDb().from("papers").select("id").eq("slug", slug);
  expect(data).toEqual([]);
});
