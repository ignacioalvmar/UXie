import { execFileSync } from "node:child_process";
import { deleteE2ePapers, deleteE2eUsers, REPO, serviceDb } from "./support";

/**
 * Before the suite: refuse anything but the local stack with the mock model, make sure the seeded
 * paper's PDF is in Storage, and remove synthetic accounts left by an interrupted run.
 */
export default async function globalSetup() {
  const db = serviceDb();

  // Saved AI settings (FR-9.6) override the env: never let the suite call a paid provider.
  const saved = await db.from("llm_settings").select("*").maybeSingle();
  if (saved.error) throw new Error(`llm_settings: ${saved.error.message}`);
  const providers = JSON.stringify(saved.data ?? {}).match(/"provider":"([a-z_]+)"/g) ?? [];
  if (providers.some((p) => !p.includes('"mock"')))
    throw new Error(
      "Saved AI settings use a real provider. Reset them on /admin/settings/ai (or delete the llm_settings row) before running e2e.",
    );

  const pdf = await db.storage
    .from("papers")
    .list("00000000-0000-4000-c000-000000000001", { limit: 10 });
  if (!pdf.data?.length)
    execFileSync("pnpm", ["db:seed-storage"], {
      cwd: REPO,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

  await deleteE2eUsers(db);
  await deleteE2ePapers(db);
}
