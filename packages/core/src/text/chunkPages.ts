import type { Page } from "../schemas/paper";
import { estimateTokens } from "./tokens";

/**
 * Group consecutive pages into chunks of at most `maxTokens` (estimated). A page larger than the
 * budget becomes a chunk on its own; pages are never split, so citations stay page-accurate.
 */
export function chunkPages(pages: readonly Page[], maxTokens: number): Page[][] {
  const chunks: Page[][] = [];
  let current: Page[] = [];
  let used = 0;
  for (const page of pages) {
    const cost = estimateTokens(page.text);
    if (current.length && used + cost > maxTokens) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(page);
    used += cost;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
