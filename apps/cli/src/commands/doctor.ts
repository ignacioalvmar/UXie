import {
  BaseEnvSchema,
  LLM_ROLES,
  PROVIDER_LABEL,
  describeLlmSettings,
  llmSettingsFromEnv,
  llmSettingsProblems,
  parseEnv,
} from "@uxie/core";
import { catalogEntry, createGateway, type Purpose } from "@uxie/llm";
import { BASE_PROMPT_FILES, loadPromptDir } from "@uxie/tutor";
import { promptsDir } from "../paths";

const REQUIRED_PROMPTS = [
  ...BASE_PROMPT_FILES,
  ...["understand", "apply", "critique", "build"].map((m) => `tutor/modes/${m}.md`),
  ...["ask", "hint", "explain", "check"].map((h) => `tutor/help/${h}.md`),
  "assess.md",
  "assess_context.md",
  "summarize_history.md",
  "guide_draft.md",
];

/** One purpose per role, for pinging each configured provider/model. */
const ROLE_PURPOSE: Record<(typeof LLM_ROLES)[number], Purpose> = {
  tutor: "tutor",
  state: "summary",
  judge: "eval_judge",
};

/** `pnpm uxie doctor` (PRD §10.10). Exit code 1 if anything is wrong. */
export async function doctorCommand(opts: { ping?: boolean }): Promise<void> {
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
    const llm = createGateway(settings);
    const seen = new Set<string>();
    for (const role of LLM_ROLES) {
      const { provider, model } = settings.roles[role];
      if (seen.has(`${provider}:${model}`)) continue;
      seen.add(`${provider}:${model}`);
      try {
        const { text, usage } = await llm.stream(
          {
            stablePrefix: "Reply with the single word OK.",
            dynamicSystem: "",
            messages: [{ role: "user", content: "ping" }],
          },
          { purpose: ROLE_PURPOSE[role], maxTokens: 200 },
        ).done;
        console.log(
          `✓ ${role.padEnd(9)} ${PROVIDER_LABEL[provider]} ${model} answered "${text.trim().slice(0, 20)}" in ${usage.latencyMs}ms`,
        );
      } catch (e) {
        fail(
          role,
          `${PROVIDER_LABEL[provider]} ${model}: ${(e as { code?: string }).code ?? "error"}: ${(e as Error).message}`,
        );
      }
    }
  } else
    console.log("- provider  skipped (add --ping to send one tiny request per provider/model)");

  console.log("- database  checked from M5");
  if (!ok) process.exitCode = 1;
}
