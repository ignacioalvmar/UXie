import "server-only";
import { join } from "node:path";
import {
  SupabaseConversationRepo,
  SupabaseLlmCallRepo,
  SupabasePaperRepo,
  SupabaseProfileRepo,
  SupabaseUsageRepo,
} from "@uxie/db";
import { createGateway } from "@uxie/llm";
import {
  loadPromptDir,
  TutorEngine,
  tutorConfig,
  type ConversationRepo,
  type LlmCallRepo,
  type PaperRepo,
  type ProfileRepo,
  type PromptLoader,
  type UsageRepo,
} from "@uxie/tutor";
import { serverEnv } from "./env";
import { effectiveSettings } from "./llmSettings";
import { serviceDb } from "./supabase/server";

/**
 * Wires the TutorEngine to Supabase (PRD §4.3: only apps/* wire concrete implementations). The
 * annotations below are the compile-time proof that packages/db satisfies the tutor ports, which
 * it implements structurally because it may not import packages/tutor. The chat routes use this
 * from M6 on.
 */
let prompts: PromptLoader | undefined;
const promptDir = () => join(process.cwd(), "../../prompts");

export async function createEngine() {
  const env = serverEnv();
  const db = serviceDb();
  const { settings } = await effectiveSettings();
  const papers: PaperRepo = new SupabasePaperRepo(db);
  const conversations: ConversationRepo = new SupabaseConversationRepo(db);
  const usage: UsageRepo = new SupabaseUsageRepo(db);
  const profiles: ProfileRepo = new SupabaseProfileRepo(db);
  const llmCalls: LlmCallRepo = new SupabaseLlmCallRepo(db);
  const llm = createGateway(settings, {
    onUsage: (e) => {
      void llmCalls
        .record({
          conversationId: e.conversationId ?? null,
          purpose: e.purpose,
          provider: e.usage.provider,
          model: e.usage.model,
          inputTokens: e.usage.inputTokens,
          outputTokens: e.usage.outputTokens,
          cachedInputTokens: e.usage.cachedInputTokens,
          cacheWriteInputTokens: e.usage.cacheWriteInputTokens,
          costEur: e.usage.costEur,
          latencyMs: e.usage.latencyMs,
          ttftMs: e.usage.ttftMs ?? null,
          ok: e.ok,
          errorCode: e.errorCode ?? null,
          meta: e.meta,
        })
        .catch(() => {});
    },
  });
  prompts ??= loadPromptDir(promptDir());
  return new TutorEngine({
    llm,
    papers,
    conversations,
    profiles,
    usage,
    prompts,
    config: tutorConfig(env, settings),
  });
}
