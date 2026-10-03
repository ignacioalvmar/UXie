import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ObjectiveKind,
  escapeAttr,
  escapeBlockTags,
  formatGuideIssues,
  promptHash,
  renderTemplate,
  validateGuide,
  type GuideIssue,
  type Page,
  type TeachingGuide,
} from "@uxie/core";
import { LlmError, type LlmGateway, type PromptParts, type Usage } from "@uxie/llm";

/** Prompt files used to draft a guide (PRD §12.6), relative to /prompts. */
export const GUIDE_PROMPT_FILES = [
  "guide_draft.md",
  "guide_draft_request.md",
  "guide_repair.md",
] as const;

export interface GuidePrompts {
  system: string;
  request: string;
  repair: string;
  /** `guide_draft@<hash12>` over all three files (PRD §8.5). */
  version: string;
}

export function guidePrompts(
  files: Record<(typeof GUIDE_PROMPT_FILES)[number], string>,
): GuidePrompts {
  // CRLF checkouts must not change the prompt bytes or the version.
  const [system, request, repair] = GUIDE_PROMPT_FILES.map((f) =>
    files[f].replaceAll("\r\n", "\n"),
  ) as [string, string, string];
  return {
    system,
    request,
    repair,
    version: `guide_draft@${promptHash([system, request, repair])}`,
  };
}

export function loadGuidePrompts(promptsDir: string): GuidePrompts {
  const files = Object.fromEntries(
    GUIDE_PROMPT_FILES.map((f) => [f, readFileSync(join(promptsDir, f), "utf8")]),
  ) as Record<(typeof GUIDE_PROMPT_FILES)[number], string>;
  return guidePrompts(files);
}

/**
 * The shape we ask the model for. It mirrors `TeachingGuideSchema` without counts, patterns and
 * refinements (providers' JSON-schema support for those varies), so a draft that breaks a rule
 * still comes back and can be repaired or saved for the instructor (FR-5.4). `schema_version` is
 * added in code.
 */
const DraftSchema = z.object({
  title: z.string(),
  summary_for_tutor: z.string(),
  starter_questions: z.array(z.string()),
  objectives: z.array(
    z.object({
      id: z.string(),
      kind: ObjectiveKind,
      statement: z.string(),
      refs: z.array(z.object({ page: z.number().int(), label: z.string().optional() })),
      key_concepts: z.array(z.string()),
      question_ladder: z.array(z.string()),
      hints: z.array(z.string()),
      misconceptions: z.array(z.string()),
      mastery_check: z.string(),
    }),
  ),
  ux_scenarios: z.array(z.string()),
  discussion_prompts: z.array(z.string()),
  build_prompts: z.array(z.string()),
  evidence_limits: z.array(z.string()),
});

export interface GuideDraftInput {
  title: string;
  pages: readonly Page[];
  referencesStartPage?: number | null;
}

export interface GuideDraftResult {
  /** True when `guide` passed the schema and the page-range check. */
  ok: boolean;
  /** The validated guide (ok), or null. */
  guide: TeachingGuide | null;
  /** The last draft as returned by the model, with `schema_version`; saved even when invalid. */
  draft: Record<string, unknown> | null;
  issues: GuideIssue[];
  /** Model calls made at this level: 1, or 2 after a repair retry. */
  attempts: 1 | 2;
  /** Issues of the first draft when a repair call was made (useful for prompt tuning). */
  repairedIssues: GuideIssue[];
  promptVersion: string;
  model: string;
  provider: string;
  usage: Usage[];
}

export function renderDraftPaper(input: GuideDraftInput): string {
  const body = input.pages
    .map((p) => `<page n="${p.n}">\n${escapeBlockTags(p.text)}\n</page>`)
    .join("\n");
  return `<paper title="${escapeAttr(input.title)}" pages="${input.pages.length}">\n${body}\n</paper>`;
}

/**
 * FR-5.4: draft a teaching guide with structured output, validate it against
 * `TeachingGuideSchema` and the page count, and on failure make one repair call with the issues.
 * Provider errors (auth, timeout, refusal) propagate as `LlmError`.
 */
export async function draftGuide(
  input: GuideDraftInput,
  deps: { llm: LlmGateway; prompts: GuidePrompts; timeoutMs?: number; signal?: AbortSignal },
): Promise<GuideDraftResult> {
  const { llm, prompts } = deps;
  const pageCount = input.pages.length;
  const request = renderTemplate(prompts.request, {
    title: input.title,
    page_count: pageCount,
    references_start: input.referencesStartPage ?? false,
  });
  const base: PromptParts = {
    stablePrefix: `${prompts.system.trimEnd()}\n\n${renderDraftPaper(input)}`,
    dynamicSystem: "",
    messages: [{ role: "user", content: request }],
  };
  const usage: Usage[] = [];

  const call = async (messages: PromptParts["messages"]) => {
    try {
      const res = await llm.structured({ ...base, messages }, DraftSchema, {
        purpose: "guide_draft",
        timeoutMs: deps.timeoutMs,
        signal: deps.signal,
      });
      usage.push(res.usage);
      const draft: Record<string, unknown> = { schema_version: 1, ...res.value };
      return { draft, validation: validateGuide(draft, pageCount) };
    } catch (e) {
      // The output never matched even the draft shape (the gateway already retried once).
      if (e instanceof LlmError && e.code === "invalid_output") {
        return {
          draft: null,
          validation: {
            ok: false as const,
            guide: null,
            issues: [{ path: "(output)", message: e.message }],
          },
        };
      }
      throw e;
    }
  };

  const { provider, model } = llm.modelFor("guide_draft");
  const result = (
    r: Awaited<ReturnType<typeof call>>,
    attempts: 1 | 2,
    repairedIssues: GuideIssue[] = [],
  ): GuideDraftResult => ({
    ok: r.validation.ok,
    guide: r.validation.ok ? r.validation.guide : null,
    draft: r.draft,
    issues: r.validation.issues,
    attempts,
    repairedIssues,
    promptVersion: prompts.version,
    model,
    provider,
    usage,
  });

  const first = await call(base.messages);
  if (first.validation.ok) return result(first, 1);

  const repairMessages: PromptParts["messages"] = first.draft
    ? [
        ...base.messages,
        { role: "assistant", content: JSON.stringify(first.draft) },
        {
          role: "user",
          content: renderTemplate(prompts.repair, {
            issues: formatGuideIssues(first.validation.issues).split("\n"),
          }),
        },
      ]
    : base.messages; // nothing usable to repair: ask again from scratch
  const second = await call(repairMessages);
  // Keep the better draft to save: a schema-shaped second draft, else the first one.
  return result(second.draft || !first.draft ? second : first, 2, first.validation.issues);
}
