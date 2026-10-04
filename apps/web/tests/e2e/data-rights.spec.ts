import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  deleteE2eUsers,
  expectAccessible,
  INSTRUCTOR,
  newEmail,
  PASSWORD,
  SEED_PASSWORD,
  serviceDb,
  signIn,
} from "./support";

/**
 * PRD §15 E2E deletion flow (FR-8.1–8.3): a student downloads their data and requests deletion;
 * the instructor completes it with the typed pseudonym; the account is gone and the ledger has it.
 */
test.afterAll(async () => deleteE2eUsers());

test("FR-8.1–8.3 data download, deletion request, completion by the instructor", async ({
  browser,
  baseURL,
}) => {
  const db = serviceDb();
  const email = newEmail("deletion");
  const created = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  // Onboarded as /onboarding would do it (current notice version from the app's env default).
  const { data: profile } = await db
    .from("profiles")
    .update({
      uxie_character: "pip",
      privacy_notice_version: process.env.PRIVACY_NOTICE_VERSION ?? "2026-10-01",
      privacy_ack_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("pseudonym_id")
    .single();
  const pseudonym = profile!.pseudonym_id as string;

  // Student side.
  const student = await (await browser.newContext({ baseURL })).newPage();
  await signIn(student, email, PASSWORD);
  await student.goto("/account");
  const download = student.waitForEvent("download");
  await student.getByRole("link", { name: "Download my data" }).click();
  const json: unknown = JSON.parse(readFileSync(await (await download).path(), "utf8"));
  expect(JSON.stringify(json)).toContain(email);

  await student.getByRole("button", { name: "Delete my account…" }).click();
  await expectAccessible(student, "/account (deletion confirm)");
  await student.getByRole("button", { name: "Request deletion" }).click();
  await expect(student.getByText("Your account is scheduled for deletion")).toBeVisible();

  // Instructor side.
  const instructor = await (await browser.newContext({ baseURL })).newPage();
  await signIn(instructor, INSTRUCTOR, SEED_PASSWORD);
  await instructor.goto("/admin/data-requests");
  const row = instructor
    .locator("li")
    .filter({ hasText: pseudonym })
    .filter({ hasText: "Deletion" });
  await row.getByRole("button", { name: "Delete account…" }).click();
  const dialog = instructor.getByRole("dialog", { name: `Delete the account of ${pseudonym}?` });
  const confirm = dialog.getByRole("button", { name: "Delete permanently" });
  await expect(confirm).toBeDisabled();
  await expectAccessible(instructor, "deletion dialog");
  await dialog.getByLabel(`Type the pseudonym ${pseudonym} to confirm`).fill(pseudonym);
  await confirm.click();
  await expect(
    instructor.getByText("Account deleted and recorded in the deletion register."),
  ).toBeVisible();

  // Verified by query: no profile, ledger row, sign-in refused.
  expect((await db.from("profiles").select("id").eq("id", id)).data).toEqual([]);
  expect(
    (await db.from("deletion_ledger").select("pseudonym_id").eq("pseudonym_id", pseudonym)).data,
  ).toHaveLength(1);
  const again = await (await browser.newContext({ baseURL })).newPage();
  await again.goto("/auth/sign-in");
  await again.getByLabel("University email").fill(email);
  await again.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await again.getByRole("button", { name: "Sign in" }).click();
  await expect(again).toHaveURL(/\/auth\/sign-in/);
  await expect(again.getByRole("button", { name: "Try again" })).toBeVisible();
});
