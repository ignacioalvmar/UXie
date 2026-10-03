import type { TeachingGuide } from "@uxie/core";
import type { Profile } from "./profiles";
import type { AutoChecks, HelpSequenceCheck, TurnRecord } from "./types";

/** Automatic checks without an LLM (PRD §13.3). All pure. */

export const MAX_WORDS = 200;
export const MAX_QUESTION_MARKS = 2;
export const LEAK_NGRAM = 8;

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
export const questionMarks = (text: string) => (text.match(/[?？]/g) ?? []).length;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

function ngrams(text: string, n: number): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/** Share of a guide field a reply must reproduce verbatim to count as leaked. */
export const GUIDE_COVERAGE = 0.4;
/** Hints substantially reproduced in one reply that make it a dump of the guide. */
export const HINT_DUMP = 3;

interface Source {
  words: string[];
  grams: string[];
}

/**
 * Detects verbatim leakage (PRD §13.3) with 8-word overlaps, ignoring n-grams that also occur in
 * public text (the paper, objective statements, ladder questions, the student's own words).
 *
 * - `strictTexts` (base rules): any overlap counts; their wording never belongs in a reply.
 * - `privateTexts` (summary_for_tutor, mastery checks, misconception lists): a reply leaks a field
 *   when it reproduces ≥ 40% of it. A single 8-word overlap is usually a restated paper fact
 *   ("discovery rose from 21 to 58 to 92" is in the summary and is also what the paper says).
 * - `teachingTexts` (hints): the tutor teaches with them (the hint directive hands one over each
 *   turn; an explanation may draw on two), so only ≥ 3 hints reproduced by half in one reply count.
 */
export function createLeakDetector(opts: {
  strictTexts?: string[];
  privateTexts: string[];
  teachingTexts?: string[];
  publicTexts: string[];
  n?: number;
}): (reply: string, extraPublic?: string[]) => string[] {
  const n = opts.n ?? LEAK_NGRAM;
  const allowed = new Set<string>();
  for (const t of opts.publicTexts) for (const g of ngrams(t, n)) allowed.add(g);
  const source = (t: string): Source => {
    const w = words(t);
    return {
      words: w,
      grams: w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n).join(" ")),
    };
  };
  const strict = new Set<string>();
  for (const t of opts.strictTexts ?? [])
    for (const g of ngrams(t, n)) if (!allowed.has(g)) strict.add(g);
  const fields = opts.privateTexts.map(source);
  const hints = (opts.teachingTexts ?? []).map(source);

  /** Matching n-grams of `s` in the reply, and the share of its words they cover. */
  const overlap = (s: Source, reply: Set<string>, skip: Set<string>) => {
    const covered = new Set<number>();
    const hits: string[] = [];
    s.grams.forEach((g, i) => {
      if (!reply.has(g) || allowed.has(g) || skip.has(g)) return;
      hits.push(g);
      for (let k = i; k < i + n; k++) covered.add(k);
    });
    return { hits, coverage: s.words.length ? covered.size / s.words.length : 0 };
  };

  return (reply, extraPublic = []) => {
    const grams = ngrams(reply, n);
    const skip = new Set(extraPublic.flatMap((t) => [...ngrams(t, n)]));
    const out = new Set<string>();
    for (const g of grams) if (strict.has(g) && !skip.has(g)) out.add(g);
    for (const f of fields) {
      const o = overlap(f, grams, skip);
      if (o.coverage >= GUIDE_COVERAGE) o.hits.forEach((g) => out.add(g));
    }
    const dumped = hints.map((h) => overlap(h, grams, skip)).filter((o) => o.coverage >= 0.5);
    if (dumped.length >= HINT_DUMP) dumped.forEach((o) => o.hits.forEach((g) => out.add(g)));
    return [...out];
  };
}

/**
 * Private guide fields: summary_for_tutor (PRD §13.3), mastery checks and the misconception
 * lists. Hints are private too but taught from (see `createLeakDetector`). Evidence limits are
 * left out: stating a limit is good teaching.
 */
export function privateGuideTexts(guide: TeachingGuide): string[] {
  return [
    guide.summary_for_tutor,
    ...guide.objectives.flatMap((o) => [o.mastery_check, ...o.misconceptions]),
  ];
}

export const guideHints = (guide: TeachingGuide): string[] =>
  guide.objectives.flatMap((o) => o.hints);

/** Guide text the tutor may say verbatim. */
export function publicGuideTexts(guide: TeachingGuide): string[] {
  return [
    ...guide.objectives.flatMap((o) => [o.statement, ...o.question_ladder]),
    ...guide.starter_questions,
    ...guide.ux_scenarios,
    ...guide.discussion_prompts,
    ...guide.build_prompts,
  ];
}

const GERMAN = new Set(
  "der die das und nicht ist ein eine einen du sie wie was mit auf für zu den dem sich auch es ich wir oder aber wenn dass im sind hast hat kannst warum welche welcher deine dein diese dieser bei von".split(
    " ",
  ),
);
const ENGLISH = new Set(
  "the and is you what of to in that it this with for are how do your can which why does on be was they their".split(
    " ",
  ),
);

/** Function-word heuristic; good enough to tell German from English replies. */
export function looksGerman(text: string): boolean {
  let de = 0;
  let en = 0;
  for (const w of words(text)) {
    if (GERMAN.has(w)) de++;
    if (ENGLISH.has(w)) en++;
  }
  return de > en;
}

/** `ask` < `hint:0` < `hint:1` < … < `explain` < `check`. */
function rank(help: string): number {
  if (help === "ask") return 0;
  if (help.startsWith("hint:")) return 1 + Number(help.slice(5));
  if (help === "explain") return 100;
  return 101;
}

export function helpSequenceCheck(turns: TurnRecord[], stuckThreshold: number): HelpSequenceCheck {
  const replies = turns.filter((t) => t.turn > 0);
  const sequence = replies.map((t) => t.help);
  const explainAt = replies.findIndex((t) => t.help === "explain");
  const explainTurn = explainAt >= 0 ? replies[explainAt]!.turn : null;
  const before = (explainAt >= 0 ? replies.slice(0, explainAt) : replies).map((t) => rank(t.help));
  const escalates = before.every((r, i) => i === 0 || r >= before[i - 1]!);
  const explainedInTime = explainTurn !== null && explainTurn <= stuckThreshold;
  const explainReply = explainAt >= 0 ? replies[explainAt] : undefined;
  const next = explainAt >= 0 ? replies[explainAt + 1] : undefined;
  const checkFollows =
    explainReply !== undefined &&
    questionMarks(explainReply.reply ?? "") > 0 &&
    (next === undefined || next.help === "check");
  return {
    sequence,
    explainTurn,
    escalates,
    explainedInTime,
    checkFollows,
    pass: escalates && explainedInTime && checkFollows,
  };
}

export function runAutoChecks(input: {
  turns: TurnRecord[];
  profile: Profile;
  detectLeak: (reply: string, extraPublic?: string[]) => string[];
  stuckThreshold: number;
}): AutoChecks {
  const { turns, profile } = input;
  const replied = turns.filter((t) => t.reply !== null);
  const understand = replied.filter((t) => t.mode === "understand");
  const afterFirstMessage = replied.filter((t) => t.turn > 0);
  const studentTexts = turns.map((t) => t.student ?? "");
  return {
    longReplies: replied.filter((t) => wordCount(t.reply!) > MAX_WORDS).map((t) => t.turn),
    manyQuestions: replied
      .filter((t) => questionMarks(t.reply!) > MAX_QUESTION_MARKS)
      .map((t) => t.turn),
    citationsInvalid: turns.reduce((n, t) => n + t.citationsInvalid, 0),
    understandCitationRate: understand.length
      ? understand.filter((t) => /\[pp?\.\s*\d/.test(t.reply!)).length / understand.length
      : null,
    // Echoing the student's own words (e.g. a misconception they stated) is not leakage.
    leakedPhrases: replied.flatMap((t) =>
      input.detectLeak(t.reply!, studentTexts).map((phrase) => ({ turn: t.turn, phrase })),
    ),
    helpSequence: profile.id === "confused" ? helpSequenceCheck(turns, input.stuckThreshold) : null,
    germanReplyRate:
      profile.id === "german" && afterFirstMessage.length
        ? afterFirstMessage.filter((t) => looksGerman(t.reply!)).length / afterFirstMessage.length
        : null,
  };
}
