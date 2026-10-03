/** Rough token estimate used for context budgeting and warnings (PRD §8.2): ceil(chars / 4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
