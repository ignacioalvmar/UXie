import { BaseEnvSchema, describeEnv, parseEnv, resolveModels } from "@uxie/core";
import { createGateway } from "@uxie/llm";
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

/** `pnpm uxie doctor` (PRD §10.10). Exit code 1 if anything is wrong. */
export async function doctorCommand(opts: { ping?: boolean }): Promise<void> {
  let ok = true;
  const fail = (what: string, why: string) => {
    ok = false;
    console.log(`✗ ${what.padEnd(9)} ${why}`);
  };

  const env = parseEnv(BaseEnvSchema, process.env); // throws EnvError → reported by the caller
  console.log(`✓ env       ${JSON.stringify(describeEnv(env))}`);

  try {
    const prompts = loadPromptDir(promptsDir);
    for (const name of REQUIRED_PROMPTS) prompts.get(name);
    console.log(
      `✓ prompts   ${REQUIRED_PROMPTS.length} required files, base version ${prompts.hash(BASE_PROMPT_FILES)}`,
    );
  } catch (e) {
    fail("prompts", (e as Error).message);
  }

  const models = resolveModels(env);
  const unpriced = [...new Set([models.tutor, models.state])].filter(
    (m) => !env.LLM_PRICES_JSON[m],
  );
  if (env.LLM_PROVIDER !== "mock" && unpriced.length) {
    console.log(
      `! prices    no LLM_PRICES_JSON entry for ${unpriced.join(", ")}; costs will show as €0`,
    );
  } else console.log("✓ prices    configured");

  if (opts.ping) {
    try {
      const llm = createGateway(env);
      const { text, usage } = await llm.stream(
        {
          stablePrefix: "Reply with the single word OK.",
          dynamicSystem: "",
          messages: [{ role: "user", content: "ping" }],
        },
        { purpose: "summary", maxTokens: 50 },
      ).done;
      console.log(
        `✓ provider  ${usage.provider}/${usage.model} answered "${text.trim().slice(0, 20)}" in ${usage.latencyMs}ms`,
      );
    } catch (e) {
      fail("provider", `${(e as { code?: string }).code ?? "error"}: ${(e as Error).message}`);
    }
  } else console.log("- provider  skipped (add --ping to send one tiny request)");

  console.log("- database  checked from M5");
  if (!ok) process.exitCode = 1;
}
