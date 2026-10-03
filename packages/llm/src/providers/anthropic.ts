import { createAnthropic } from "@ai-sdk/anthropic";
import type { SystemModelMessage } from "ai";
import type { LlmSettings, ProviderCredential } from "@uxie/core";
import { acceptsEffort } from "../capabilities";
import type { ProviderAdapter } from "./types";

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1";

/**
 * Anthropic (ADR-012). Two system blocks: the stable prefix carries the cache breakpoint (TTL
 * from settings); the dynamic part follows uncached. Adaptive thinking stays at the model
 * default; `effort` is sent only for tutor replies and only to models that accept it.
 */
export function anthropicAdapter(
  cred: ProviderCredential | undefined,
  settings: LlmSettings,
  fetch?: typeof globalThis.fetch,
): ProviderAdapter {
  // Pin the endpoint: the SDK would otherwise honour an ambient ANTHROPIC_BASE_URL and could
  // silently route student data elsewhere (NFR-1). A different endpoint must be an explicit setting.
  const provider = createAnthropic({
    apiKey: cred?.apiKey,
    baseURL: ANTHROPIC_API_URL,
    // Organization-level keys (not scoped to a workspace) must name a workspace on every request.
    headers: cred?.workspaceId ? { "anthropic-workspace-id": cred.workspaceId } : undefined,
    fetch,
  });
  const cacheControl =
    settings.cacheTtl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
  return {
    name: "anthropic",
    structuredMode: "native",
    model: (id) => provider(id),
    instructions: (p) => {
      const blocks: SystemModelMessage[] = [
        {
          role: "system",
          content: p.stablePrefix,
          providerOptions: { anthropic: { cacheControl } },
        },
      ];
      if (p.dynamicSystem) blocks.push({ role: "system", content: p.dynamicSystem });
      return blocks;
    },
    providerOptions: (modelId, purpose) =>
      purpose === "tutor" && acceptsEffort("anthropic", modelId)
        ? { anthropic: { effort: settings.effort } }
        : undefined,
  };
}
