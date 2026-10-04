import {
  BaseEnvSchema,
  LLM_ROLES,
  PROVIDER_LABEL,
  describeLlmSettings,
  llmSettingsFromEnv,
  llmSettingsProblems,
  parseEnv,
  SupabaseEnvSchema,
  type BaseEnv,
} from "@uxie/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AccountsRepo,
  createServiceClient,
  loadEffectiveSettings,
  pingDb,
  ReviewRepo,
  type Db,
} from "@uxie/db";
import { catalogEntry, pingRoles } from "@uxie/llm";
import { BASE_PROMPT_FILES, loadPromptDir } from "@uxie/tutor";
import { promptsDir, repoRoot } from "../paths";
import { launchChecks, MANUAL_LAUNCH_ITEMS } from "./launch";

const REQUIRED_PROMPTS = [
  ...BASE_PROMPT_FILES,
  ...["understand", "apply", "critique", "build"].map((m) => `tutor/modes/${m}.md`),
  ...["ask", "hint", "explain", "check"].map((h) => `tutor/help/${h}.md`),
  "assess.md",
  "assess_context.md",
  "summarize_history.md",
  "guide_draft.md",
];

/** `pnpm uxie doctor` (PRD §10.10). Exit code 1 if anything is wrong. */
export async function doctorCommand(opts: { ping?: boolean; launch?: boolean }): Promise<void> {
  if (opts.launch) return launchCommand();
  let ok = true;
  const fail = (what: string, why: string) => {
    ok = false;
    console.log(`✗ ${what.padEnd(9)} ${why}`);
  };

  const env = parseEnv(BaseEnvSchema, process.env); // throws EnvError → reported by the caller
  const settings = llmSettingsFromEnv(env);
  console.log(`✓ env       ${JSON.stringify(describeLlmSettings(settings))}`);
  for (const p of llmSettingsProblems(settings)) fail("llm", p);

  try {
    const prompts = loadPromptDir(promptsDir);
    for (const name of REQUIRED_PROMPTS) prompts.get(name);
    console.log(
      `✓ prompts   ${REQUIRED_PROMPTS.length} required files, base version ${prompts.hash(BASE_PROMPT_FILES)}`,
    );
  } catch (e) {
    fail("prompts", (e as Error).message);
  }

  for (const role of LLM_ROLES) {
    const { provider, model } = settings.roles[role];
    if (provider === "mock" || settings.prices[model]) continue;
    const known = catalogEntry(provider, model)?.price;
    console.log(
      known
        ? `! prices    ${model} (${role}) has no LLM_PRICES_JSON entry; catalog price would be ${JSON.stringify(known)}`
        : `! prices    ${model} (${role}) has no price; costs will show as €0 until one is set`,
    );
  }

  if (opts.ping) {
    for (const r of await pingRoles(settings)) {
      if (r.ok)
        console.log(
          `✓ ${r.role.padEnd(9)} ${PROVIDER_LABEL[r.provider as keyof typeof PROVIDER_LABEL]} ${r.model} answered "${r.answer}" in ${r.latencyMs}ms`,
        );
      else fail(r.role, `${r.provider} ${r.model}: ${r.errorCode}: ${r.message}`);
    }
  } else
    console.log("- provider  skipped (add --ping to send one tiny request per provider/model)");

  await checkDatabase(env, fail);
  if (!ok) process.exitCode = 1;
}

/** Database, storage bucket and the sign-up domain allow-list (FR-1.1) in sync with env. */
async function checkDatabase(env: BaseEnv, fail: (what: string, why: string) => void) {
  const supa = SupabaseEnvSchema.safeParse(process.env);
  if (!supa.success) {
    console.log("- database  skipped (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY not set)");
    return;
  }
  const db = createServiceClient(supa.data.NEXT_PUBLIC_SUPABASE_URL, supa.data.SUPABASE_SECRET_KEY);
  try {
    if (!(await pingDb(db))) return fail("database", "not reachable or migrations missing");
    console.log(`✓ database  ${supa.data.NEXT_PUBLIC_SUPABASE_URL}`);
    const bucket = await db.storage.getBucket("papers");
    if (bucket.error) fail("storage", `bucket "papers": ${bucket.error.message}`);
    else console.log(`✓ storage   bucket "papers" (private: ${!bucket.data.public})`);
    const inDb = await new AccountsRepo(db).allowedDomainsInDb();
    const inEnv = [...env.ALLOWED_EMAIL_DOMAINS].sort();
    if (JSON.stringify(inDb) !== JSON.stringify(inEnv)) {
      fail(
        "domains",
        `ALLOWED_EMAIL_DOMAINS (${inEnv.join(", ") || "any"}) differs from auth_allowed_domains used by the sign-up hook (${inDb.join(", ") || "any"})`,
      );
    } else
      console.log(`✓ domains   ${inEnv.join(", ") || "any"} (server action and Auth hook agree)`);
  } catch (e) {
    fail("database", (e as Error).message);
  }
}

/**
 * `pnpm uxie doctor --launch` (PRD §17.3, M10): run with the production env exported. Fails on
 * anything that blocks the pilot, warns on what should be set, then lists the manual items.
 */
async function launchCommand(): Promise<void> {
  const env = parseEnv(BaseEnvSchema, process.env);
  const supa = SupabaseEnvSchema.safeParse(process.env);
  let settings = llmSettingsFromEnv(env);
  let readyPapers: number | null = null;
  let heartbeatAgeMs: number | null = null;
  if (supa.success) {
    const db = createServiceClient(
      supa.data.NEXT_PUBLIC_SUPABASE_URL,
      supa.data.SUPABASE_SECRET_KEY,
    );
    settings = (await loadEffectiveSettings(db, settings, env.SETTINGS_ENCRYPTION_KEY)).settings;
    readyPapers = await countReadyPapers(db);
    const beats = await new ReviewRepo(db).workerHeartbeats();
    const newest = Math.max(...beats.map((b) => Date.parse(b.lastSeenAt)));
    heartbeatAgeMs = beats.length ? Date.now() - newest : null;
  }
  const checks = launchChecks({
    env,
    supabaseUrl: supa.success ? supa.data.NEXT_PUBLIC_SUPABASE_URL : null,
    settings,
    privacyNotice: readFileSync(resolve(repoRoot, "apps/web/content/privacy-notice.md"), "utf8"),
    readyPapers,
    heartbeatAgeMs,
  });
  const mark = { ok: "✓", warn: "!", fail: "✗" } as const;
  for (const c of checks) console.log(`${mark[c.level]} ${c.what.padEnd(9)} ${c.detail}`);
  console.log("\nManual (PRD §17.3; tick them in docs/launch-checklist.md):");
  for (const item of MANUAL_LAUNCH_ITEMS) console.log(`  [ ] ${item}`);
  if (checks.some((c) => c.level === "fail")) process.exitCode = 1;
}

/** Published papers whose current version is published and has an approved guide. */
async function countReadyPapers(db: Db): Promise<number> {
  const papers = await db
    .from("papers")
    .select("current_version_id")
    .eq("status", "published")
    .not("current_version_id", "is", null);
  if (papers.error) throw new Error(`papers: ${papers.error.message}`);
  const ids = (papers.data as { current_version_id: string }[]).map((p) => p.current_version_id);
  if (!ids.length) return 0;
  const guides = await db
    .from("teaching_guides")
    .select("version_id")
    .in("version_id", ids)
    .eq("status", "approved");
  if (guides.error) throw new Error(`guides: ${guides.error.message}`);
  return guides.data.length;
}
