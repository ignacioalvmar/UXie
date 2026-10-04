import { LLM_ROLES, type LlmRole, type LlmSettings } from "@uxie/core";
import { createGateway, toLlmError, type GatewayOptions } from "./gateway";
import type { LlmErrorCode, Purpose } from "./types";

/** One purpose per role, so each role's provider/model and limits are exercised. */
const ROLE_PURPOSE: Record<LlmRole, Purpose> = {
  tutor: "tutor",
  state: "summary",
  judge: "eval_judge",
};

export interface RolePing {
  role: LlmRole;
  provider: string;
  model: string;
  ok: boolean;
  latencyMs: number | null;
  /** First characters of the answer (never the prompt). */
  answer: string | null;
  errorCode: LlmErrorCode | null;
  message: string | null;
}

/**
 * Send one tiny request per distinct provider/model in use (`uxie doctor --ping`, "Test
 * connection" on /admin/settings/ai, FR-9.6). Results are reported for every role.
 */
export async function pingRoles(
  settings: LlmSettings,
  options: GatewayOptions = {},
): Promise<RolePing[]> {
  const llm = createGateway(settings, options);
  const results = new Map<string, Omit<RolePing, "role">>();
  for (const role of LLM_ROLES) {
    const { provider, model } = settings.roles[role];
    const key = `${provider}:${model}`;
    if (results.has(key)) continue;
    try {
      const { text, usage } = await llm.stream(
        {
          stablePrefix: "Reply with the single word OK.",
          dynamicSystem: "",
          messages: [{ role: "user", content: "ping" }],
        },
        { purpose: ROLE_PURPOSE[role], maxTokens: 200 },
      ).done;
      results.set(key, {
        provider,
        model,
        ok: true,
        latencyMs: usage.latencyMs,
        answer: text.trim().slice(0, 20),
        errorCode: null,
        message: null,
      });
    } catch (e) {
      const err = toLlmError(e);
      results.set(key, {
        provider,
        model,
        ok: false,
        latencyMs: null,
        answer: null,
        errorCode: err.code,
        message: err.message,
      });
    }
  }
  return LLM_ROLES.map((role) => {
    const { provider, model } = settings.roles[role];
    return { role, ...results.get(`${provider}:${model}`)! };
  });
}
