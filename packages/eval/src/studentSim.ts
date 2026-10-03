import { renderTemplate } from "@uxie/core";
import type { LlmGateway, PromptParts } from "@uxie/llm";
import { renderPaperBlock, type PaperForTutor, type PromptLoader } from "@uxie/tutor";
import type { Profile, ProfileId } from "./profiles";
import type { TurnRecord } from "./types";

export const STUDENT_PROMPT = "eval/student_profiles.md";
export const STUDENT_MAX_WORDS = 80;

/** `prompts/eval/student_profiles.md`: a shared frame, then one `## <profile-id>` section per profile. */
export function parseStudentProfiles(text: string): {
  frame: string;
  sections: Map<string, string>;
} {
  const parts = text.split(/^## ([\w-]+)[ \t]*$/m);
  const sections = new Map<string, string>();
  for (let i = 1; i < parts.length; i += 2) sections.set(parts[i]!, parts[i + 1]!.trim());
  return { frame: parts[0]!.trim(), sections };
}

export interface StudentVars {
  misconception: string;
  project: string;
}

/** Remove what a role-playing model sometimes adds around the message. */
export function cleanStudentMessage(text: string): string {
  let t = text.trim().replace(/^(student|you|me)\s*[:›>]\s*/i, "");
  if (/^["„“].*["”“]$/s.test(t)) t = t.slice(1, -1).trim();
  return t || "I'm not sure.";
}

/**
 * The simulated student sees the paper and the dialogue from its own side: tutor replies are
 * `user` turns, its own messages `assistant` turns, so the request always ends with the tutor.
 */
export function studentPromptParts(
  prompts: PromptLoader,
  input: {
    paper: PaperForTutor;
    profile: Profile;
    vars: StudentVars;
    turns: TurnRecord[];
    turnNumber: number;
    totalTurns: number;
  },
): PromptParts {
  const { frame, sections } = parseStudentProfiles(prompts.get(STUDENT_PROMPT));
  const section = sections.get(input.profile.id as ProfileId);
  if (!section)
    throw new Error(`prompts/${STUDENT_PROMPT} has no "## ${input.profile.id}" section`);
  const messages: PromptParts["messages"] = [];
  for (const t of input.turns) {
    if (t.student !== null) messages.push({ role: "assistant", content: t.student });
    messages.push({
      role: "user",
      content: t.reply ?? "(UXie could not reply. Continue the conversation.)",
    });
  }
  return {
    stablePrefix: `${renderTemplate(frame, { max_words: STUDENT_MAX_WORDS })}\n\n${renderPaperBlock(input.paper)}`,
    dynamicSystem: `${renderTemplate(section, { ...input.vars })}\n\nThis is your message ${input.turnNumber} of ${input.totalTurns}. Reply with the student's next message only.`,
    messages,
  };
}

export async function simulateStudent(
  deps: { llm: LlmGateway; prompts: PromptLoader },
  input: Parameters<typeof studentPromptParts>[1] & { conversationId: string },
): Promise<string> {
  const stream = deps.llm.stream(studentPromptParts(deps.prompts, input), {
    purpose: "eval_student",
    conversationId: input.conversationId,
  });
  const { text } = await stream.done;
  return cleanStudentMessage(text);
}
