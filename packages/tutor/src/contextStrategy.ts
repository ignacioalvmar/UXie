import type { Objective } from "@uxie/core";
import type { PaperForTutor, PaperRepo } from "./ports";

export type ContextStrategySetting = "auto" | "full" | "retrieval";
export type ContextStrategy = "full" | "retrieval";

/** Room reserved for rules, dynamic part, history and the reply (PRD §8.6). */
export const CONTEXT_OVERHEAD_TOKENS = 6000;

/** `auto` → full if paper + guide + overhead fits in 60% of the context window, else retrieval. */
export function chooseContextStrategy(
  setting: ContextStrategySetting,
  paperTokens: number,
  guideTokens: number,
  contextWindow: number,
): ContextStrategy {
  if (setting !== "auto") return setting;
  return paperTokens + guideTokens + CONTEXT_OVERHEAD_TOKENS <= 0.6 * contextWindow
    ? "full"
    : "retrieval";
}

/**
 * Pages for the retrieval strategy (P1): FTS hits for the student's message plus the active
 * objective's key concepts, always the objective's ref pages and page 1, capped, in page order.
 */
export async function selectRetrievalPages(input: {
  papers: PaperRepo;
  paper: PaperForTutor;
  studentText: string;
  objective: Objective | null;
  maxPages: number;
}): Promise<number[]> {
  const { paper, objective, maxPages } = input;
  const required = [1, ...(objective?.refs.map((r) => r.page) ?? [])].filter(
    (n) => n <= paper.pageCount,
  );
  const query = [input.studentText, ...(objective?.key_concepts ?? [])].join(" ").trim();
  const hits = query ? await input.papers.searchPages(paper.versionId, query, maxPages) : [];
  const chosen: number[] = [];
  for (const n of [...required, ...hits]) {
    if (!chosen.includes(n) && chosen.length < maxPages) chosen.push(n);
  }
  return chosen.sort((a, b) => a - b);
}
