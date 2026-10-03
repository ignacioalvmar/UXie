import type { LlmGateway, Usage } from "@uxie/llm";
import {
  renderGuideBlock,
  renderPaperBlock,
  type PaperForTutor,
  type PromptLoader,
} from "@uxie/tutor";
import { JudgeOutputSchema, normalizeJudge, type JudgeVerdict } from "./judgeSchema";
import type { Profile } from "./profiles";
import type { TurnRecord } from "./types";

export const JUDGE_TIMEOUT_MS = 180_000;
export const JUDGE_MAX_TOKENS = 12_000;

export function helpText(help: string): string {
  return help.startsWith("hint:") ? `hint ${Number(help.slice(5)) + 1}` : help;
}

/** Transcript as the judge sees it: numbered turns, help level and shortcut flag per reply. */
export function formatTranscript(turns: TurnRecord[]): string {
  const lines: string[] = [];
  for (const t of turns) {
    lines.push(
      t.turn === 0
        ? `[turn 0] STUDENT: [Started the conversation]`
        : `[turn ${t.turn}] STUDENT: ${t.student ?? ""}`,
    );
    const tags = [`help: ${helpText(t.help)}`, `mode: ${t.mode}`];
    if (t.shortcutRequest) tags.push("shortcut request");
    lines.push(
      t.reply === null
        ? `[turn ${t.turn}] TUTOR (${tags.join(", ")}): (reply failed: ${t.error ?? "error"})`
        : `[turn ${t.turn}] TUTOR (${tags.join(", ")}): ${t.reply}`,
    );
  }
  return `<transcript>\n${lines.join("\n\n")}\n</transcript>`;
}

/** Judge prefix: rubric, tutor base rules, paper, guide. Byte-stable per paper, so it is cached. */
export function judgePrefix(prompts: PromptLoader, paper: PaperForTutor): string {
  return [
    prompts.render("eval/judge.md"),
    `<tutor_base_rules>\n${prompts.render("tutor/base_rules.md")}\n</tutor_base_rules>`,
    renderPaperBlock(paper),
    renderGuideBlock(paper),
  ].join("\n\n");
}

export async function judgeRun(
  deps: { llm: LlmGateway; prompts: PromptLoader },
  input: {
    paper: PaperForTutor;
    profile: Profile;
    turns: TurnRecord[];
    tutorLanguage: string;
    conversationId?: string;
  },
): Promise<{ verdict: JudgeVerdict; usage: Usage }> {
  const { profile } = input;
  const dynamicSystem = [
    `STUDENT PROFILE: ${profile.label}. ${profile.behaviour}`,
    `PASS CONDITION: ${profile.passCondition}`,
    `TUTOR LANGUAGE SETTING: ${input.tutorLanguage === "en" ? "always English" : "mirror the student's language"}`,
  ].join("\n");
  const { value, usage } = await deps.llm.structured(
    {
      stablePrefix: judgePrefix(deps.prompts, input.paper),
      dynamicSystem,
      messages: [{ role: "user", content: formatTranscript(input.turns) }],
    },
    JudgeOutputSchema,
    {
      purpose: "eval_judge",
      timeoutMs: JUDGE_TIMEOUT_MS,
      maxTokens: JUDGE_MAX_TOKENS,
      conversationId: input.conversationId,
    },
  );
  return { verdict: { ...normalizeJudge(value), model: usage.model }, usage };
}
