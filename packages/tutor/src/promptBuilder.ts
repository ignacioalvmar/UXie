import {
  activeObjective,
  escapeAttr,
  escapeBlockTags,
  toYaml,
  type HelpLevel,
  type LearnerState,
  type Mode,
  type TurnEvent,
  type TurnFlags,
} from "@uxie/core";
import type { PromptParts } from "@uxie/llm";
import type { ContextStrategy } from "./contextStrategy";
import type { MessageRecord, PaperForTutor } from "./ports";
import type { PromptLoader } from "./promptLoader";

export const MODE_LABEL: Record<Mode, string> = {
  understand: "Understand",
  apply: "Apply to UX",
  critique: "Critique",
  build: "Build",
};

/** Files in the version-stable "base" part of every tutor prompt. */
export const BASE_PROMPT_FILES = [
  "tutor/base_rules.md",
  "tutor/state.md",
  "tutor/language/mirror.md",
  "tutor/language/en.md",
  "tutor/events/start.md",
  "tutor/events/stuck.md",
  "tutor/events/mode_switch.md",
  "tutor/help/shortcut.md",
  "tutor/help/off_topic.md",
];

/** `<paper …><page n="1">…</page>…</paper>`, all pages or only `pageNumbers`. */
export function renderPaperBlock(paper: PaperForTutor, pageNumbers?: number[]): string {
  const pages = pageNumbers ? paper.pages.filter((p) => pageNumbers.includes(p.n)) : paper.pages;
  const body = pages
    .map((p) => `<page n="${p.n}">\n${escapeBlockTags(p.text)}\n</page>`)
    .join("\n");
  const scope = pageNumbers ? ` included="${pageNumbers.join(",")}"` : "";
  return `<paper title="${escapeAttr(paper.title)}" version="${paper.versionId}" pages="${paper.pageCount}"${scope}>\n${body}\n</paper>`;
}

export function renderGuideBlock(paper: PaperForTutor): string {
  return `<teaching_guide>\n${toYaml(paper.guide)}</teaching_guide>`;
}

/**
 * The cached prefix (PRD §8.4 items 1–3): base rules, paper (full strategy only), guide.
 * Depends only on the prompt files and the paper version, so it is byte-identical every turn.
 */
export function buildStablePrefix(
  prompts: PromptLoader,
  paper: PaperForTutor,
  strategy: ContextStrategy,
): string {
  const blocks = [prompts.render("tutor/base_rules.md")];
  if (strategy === "full") blocks.push(renderPaperBlock(paper));
  blocks.push(renderGuideBlock(paper));
  return blocks.join("\n\n");
}

/** History records → model messages. Events become bracketed user turns; failed replies are dropped. */
export function toModelMessages(history: MessageRecord[]): PromptParts["messages"] {
  const out: PromptParts["messages"] = [];
  for (const m of history) {
    if (m.role === "tutor") {
      if (m.status === "complete") out.push({ role: "assistant", content: m.content });
    } else {
      out.push({ role: "user", content: m.role === "event" ? `[${m.content}]` : m.content });
    }
  }
  while (out[0]?.role === "assistant") out.shift(); // the dialogue must open with a user turn
  return out;
}

export interface TutorPromptInput {
  paper: PaperForTutor;
  /** State after this turn's transition. */
  state: LearnerState;
  help: HelpLevel;
  flags: TurnFlags;
  event: TurnEvent;
  /** Windowed history, oldest first, ending with the current student/event message. */
  history: MessageRecord[];
  projectDescription: string | null;
  tutorLanguage: "mirror" | "en";
  strategy: ContextStrategy;
  /** Pages for the retrieval strategy. */
  retrievedPages?: number[];
}

export interface BuiltPrompt {
  parts: PromptParts;
  promptVersion: string;
  pagesIncluded: number[] | "all";
}

export function buildTutorPrompt(prompts: PromptLoader, input: TutorPromptInput): BuiltPrompt {
  const { paper, state, help, flags, event } = input;
  const guide = paper.guide;
  const objective = activeObjective(state, guide);
  const ladder = objective?.question_ladder ?? [];
  const qIndex = Math.min(state.active_question_index, Math.max(ladder.length - 1, 0));
  const modeFile = `tutor/modes/${state.mode}.md`;
  const helpFile = `tutor/help/${help.kind}.md`;

  const dynamic: string[] = [];
  // 2. (retrieval only) the selected pages change per turn, so they live in the dynamic part.
  if (input.strategy === "retrieval")
    dynamic.push(renderPaperBlock(paper, input.retrievedPages ?? [1]));
  // 4. Mode instructions.
  dynamic.push(
    prompts.render(modeFile, {
      objective_id: objective?.id ?? null,
      objective_statement: objective?.statement ?? "",
      question_number: qIndex + 1,
      question_total: ladder.length,
      question: ladder[qIndex] ?? "",
      project_description: input.projectDescription,
      ux_scenarios: guide.ux_scenarios,
      discussion_prompts: guide.discussion_prompts,
      build_prompts: guide.build_prompts,
    }),
  );
  // 5. Learner-state digest.
  dynamic.push(
    prompts.render("tutor/state.md", {
      objectives: guide.objectives.map((o) => ({
        id: o.id,
        kind: o.kind,
        statement: o.statement,
        status: (state.objectives[o.id] ?? "not_started").replace("_", " "),
        active: o.id === state.active_objective,
      })),
      misconceptions: state.misconceptions_seen.filter((m) => !m.resolved),
      history_summary: state.history_summary,
    }),
  );
  // 6. Help directive, with the exact hint text for hints.
  const hints = objective?.hints ?? [];
  dynamic.push(
    prompts.render(helpFile, {
      hint_number: help.kind === "hint" ? help.index + 1 : 0,
      hint_total: hints.length,
      hint: help.kind === "hint" ? (hints[help.index] ?? "") : "",
    }),
  );
  // 7. Flags.
  if (flags.shortcutRequest) dynamic.push(prompts.render("tutor/help/shortcut.md"));
  if (flags.offTopic) dynamic.push(prompts.render("tutor/help/off_topic.md"));
  // 8. Project context is part of the Apply template above.
  // 9. Language directive and event annotation.
  dynamic.push(
    input.tutorLanguage === "en"
      ? prompts.render("tutor/language/en.md")
      : prompts.render("tutor/language/mirror.md", { language: state.language }),
  );
  if (event.type === "start") {
    dynamic.push(
      prompts.render("tutor/events/start.md", { starter_questions: guide.starter_questions }),
    );
  } else if (event.type === "stuck") {
    dynamic.push(prompts.render("tutor/events/stuck.md"));
  } else if (event.type === "mode_switch") {
    dynamic.push(
      prompts.render("tutor/events/mode_switch.md", { mode_label: MODE_LABEL[event.mode] }),
    );
  }

  const promptVersion = [
    `base@${prompts.hash(BASE_PROMPT_FILES)}`,
    `${state.mode}@${prompts.hash([modeFile])}`,
    `${help.kind}@${prompts.hash([helpFile])}`,
  ].join("+");

  return {
    parts: {
      stablePrefix: buildStablePrefix(prompts, paper, input.strategy),
      dynamicSystem: dynamic.map((s) => s.trimEnd()).join("\n\n"),
      // 10. History + current message; student text never appears in system content.
      messages: toModelMessages(input.history),
    },
    promptVersion,
    pagesIncluded: input.strategy === "full" ? "all" : (input.retrievedPages ?? [1]),
  };
}
