import type { LlmGateway } from "@uxie/llm";
import type { MessageRecord } from "./ports";
import type { PromptLoader } from "./promptLoader";

export const MAX_SUMMARY_CHARS = 2000;

/** Messages older than the verbatim window and not yet folded into the summary (FR-4.8). */
export function messagesToFold(
  unsummarized: MessageRecord[],
  historyTurns: number,
): MessageRecord[] {
  const usable = unsummarized.filter((m) => m.role !== "tutor" || m.status === "complete");
  return usable.length > historyTurns ? usable.slice(0, usable.length - historyTurns) : [];
}

/** Fold `messages` into the running summary with the state model. Throws on provider errors. */
export async function foldIntoSummary(
  deps: { llm: LlmGateway; prompts: PromptLoader },
  input: { previousSummary: string; messages: MessageRecord[]; conversationId: string },
): Promise<string> {
  const transcript = input.messages
    .map(
      (m) =>
        `${m.role === "tutor" ? "Tutor" : "Student"}: ${m.role === "event" ? `[${m.content}]` : m.content}`,
    )
    .join("\n");
  const { text } = await deps.llm.stream(
    {
      stablePrefix: deps.prompts.render("summarize_history.md"),
      dynamicSystem: "",
      messages: [
        {
          role: "user",
          content: `Current summary:\n${input.previousSummary || "(empty)"}\n\nDialogue to add:\n${transcript}`,
        },
      ],
    },
    { purpose: "summary", conversationId: input.conversationId },
  ).done;
  return text.trim().slice(0, MAX_SUMMARY_CHARS);
}
