import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServiceClient } from "../src/client";
import { SEED_PAPER_ID, SEED_VERSION_ID } from "./seedData";

/**
 * Uploads the seeded paper's PDF to the local Storage bucket (`supabase/seed.sql` only seeds
 * rows). Local stack only: URL and secret key come from `supabase status`. Re-runnable.
 *   pnpm db:seed-storage
 */
const out = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  stdio: ["ignore", "pipe", "inherit"],
});
const status = JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string>;
const url = status.API_URL;
const secret = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
if (!url || !secret) throw new Error("Start the local stack first: pnpm exec supabase start");
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url))
  throw new Error(`Refusing to seed a non-local project (${url})`);

const pdf = readFileSync(
  fileURLToPath(new URL("../../../fixtures/papers/visible-cues/source.pdf", import.meta.url)),
);
const path = `${SEED_PAPER_ID}/${SEED_VERSION_ID}.pdf`;
const db = createServiceClient(url, secret);
const { error } = await db.storage
  .from("papers")
  .upload(path, pdf, { contentType: "application/pdf", upsert: true });
if (error) throw new Error(`upload failed: ${error.message}`);
console.log(`Uploaded fixtures/papers/visible-cues/source.pdf → papers/${path}`);
