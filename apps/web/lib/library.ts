import type { Mode, ObjectiveStatus } from "@uxie/core";
import { lastQuestion } from "./chat/text";

/**
 * Library read model (FR-2.1–2.3, library handoff §3–§5). Pure: the page/route loads rows and
 * this assembles statuses, course numbering, "next in order", "continue" and recent conversations.
 */

export type PaperStatusKind =
  "in_conversation" | "all_demonstrated" | "earlier_version" | "not_started";

export interface LibraryPaperDto {
  id: string;
  slug: string;
  title: string;
  authors: string[];
  year: number | null;
  /** "1.3" = module 1, paper 3, in course order. */
  number: string;
  moduleNumber: number;
  paperNumber: number;
  status: PaperStatusKind;
  objectivesDemonstrated: number;
  objectivesTotal: number;
  /** Active conversation on the current version (Continue / Revisit target). */
  conversationId: string | null;
  keyConcepts: string[];
  isNext: boolean;
}

export interface LibraryModuleDto {
  id: string;
  slug: string;
  title: string;
  number: number;
  papers: LibraryPaperDto[];
  discussed: number;
}

export interface RecentConversationDto {
  conversationId: string;
  paperSlug: string;
  paperTitle: string;
  /** "Module 1, paper 2" when the paper is in the library, else the module title at start. */
  label: string;
  mode: Mode;
  lastTutorQuestion: string | null;
  lastMessageAt: string | null;
  isSupersededVersion: boolean;
  canContinue: boolean;
  href: string;
}

export interface ContinueDto {
  conversation: RecentConversationDto;
  paper: LibraryPaperDto;
  objectives: ObjectiveStatus[];
}

export interface LibraryDto {
  modules: LibraryModuleDto[];
  /** Up to four, most recent first (side column). */
  recent: RecentConversationDto[];
  /** All active conversations on library papers (search). */
  conversations: RecentConversationDto[];
  continueCard: ContinueDto | null;
  next: { paper: LibraryPaperDto; module: { number: number; title: string } } | null;
}

export interface LibraryInput {
  modules: { id: string; slug: string; title: string }[];
  /** Published papers, already in position order. */
  papers: {
    id: string;
    moduleId: string;
    slug: string;
    title: string;
    authors: string[];
    year: number | null;
    currentVersionId: string | null;
  }[];
  /** Student-safe guide parts per version id. */
  guides: Map<string, { objectives: { id: string; keyConcepts: string[] }[] }>;
  /** The student's conversations, newest activity first. */
  conversations: {
    id: string;
    paperId: string;
    paperVersionId: string;
    moduleTitleAtStart: string;
    mode: Mode;
    status: "active" | "reset" | "closed";
    objectives: Record<string, ObjectiveStatus>;
    lastMessageAt: Date | null;
    createdAt: Date;
  }[];
  lastTutorMessages: Map<string, string>;
}

export const RECENT_LIMIT = 4;

export function buildLibrary(input: LibraryInput): LibraryDto {
  const byPaper = new Map<string, LibraryInput["conversations"]>();
  for (const c of input.conversations) {
    byPaper.set(c.paperId, [...(byPaper.get(c.paperId) ?? []), c]);
  }

  const papersById = new Map<string, LibraryPaperDto>();
  const modules: LibraryModuleDto[] = input.modules.map((m, mi) => {
    const papers = input.papers
      .filter((p) => p.moduleId === m.id)
      .map((p, pi): LibraryPaperDto => {
        const guide = p.currentVersionId ? input.guides.get(p.currentVersionId) : undefined;
        const objectiveIds = guide?.objectives.map((o) => o.id) ?? [];
        const convs = byPaper.get(p.id) ?? [];
        const active = convs.find(
          (c) => c.status === "active" && c.paperVersionId === p.currentVersionId,
        );
        const demonstrated = active
          ? objectiveIds.filter((id) => active.objectives[id] === "demonstrated").length
          : 0;
        const status: PaperStatusKind = active
          ? objectiveIds.length > 0 && demonstrated === objectiveIds.length
            ? "all_demonstrated"
            : "in_conversation"
          : convs.some((c) => c.paperVersionId !== p.currentVersionId)
            ? "earlier_version"
            : "not_started";
        const dto: LibraryPaperDto = {
          id: p.id,
          slug: p.slug,
          title: p.title,
          authors: p.authors,
          year: p.year,
          number: `${mi + 1}.${pi + 1}`,
          moduleNumber: mi + 1,
          paperNumber: pi + 1,
          status,
          objectivesDemonstrated: demonstrated,
          objectivesTotal: objectiveIds.length,
          conversationId: active?.id ?? null,
          keyConcepts: [...new Set(guide?.objectives.flatMap((o) => o.keyConcepts) ?? [])],
          isNext: false,
        };
        papersById.set(p.id, dto);
        return dto;
      });
    return {
      id: m.id,
      slug: m.slug,
      title: m.title,
      number: mi + 1,
      papers,
      discussed: papers.filter((p) => p.status !== "not_started").length,
    };
  });

  let next: LibraryDto["next"] = null;
  for (const m of modules) {
    const p = m.papers.find((x) => x.status === "not_started");
    if (p) {
      p.isNext = true;
      next = { paper: p, module: { number: m.number, title: m.title } };
      break;
    }
  }

  const recentFor = (c: LibraryInput["conversations"][number]): RecentConversationDto | null => {
    const paper = papersById.get(c.paperId);
    if (!paper) return null; // retired or moved out of the library: reachable from /conversations
    const current = input.papers.find((p) => p.id === c.paperId)?.currentVersionId;
    const isSuperseded = c.paperVersionId !== current;
    const last = input.lastTutorMessages.get(c.id);
    return {
      conversationId: c.id,
      paperSlug: paper.slug,
      paperTitle: paper.title,
      label: `Module ${paper.moduleNumber}, paper ${paper.paperNumber}`,
      mode: c.mode,
      lastTutorQuestion: last ? lastQuestion(last) : null,
      lastMessageAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
      isSupersededVersion: isSuperseded,
      canContinue: c.status === "active" && !isSuperseded,
      href: `/papers/${paper.slug}?c=${c.id}`,
    };
  };

  const conversations = input.conversations
    .filter((c) => c.status === "active")
    .map(recentFor)
    .filter((c): c is RecentConversationDto => c !== null);
  const recent = conversations.slice(0, RECENT_LIMIT);

  const first = recent.find((r) => r.canContinue);
  let continueCard: ContinueDto | null = null;
  if (first) {
    const conv = input.conversations.find((c) => c.id === first.conversationId)!;
    const paper = papersById.get(conv.paperId)!;
    const ids = input.guides.get(conv.paperVersionId)?.objectives.map((o) => o.id) ?? [];
    continueCard = {
      conversation: first,
      paper,
      objectives: ids.map((id) => conv.objectives[id] ?? "not_started"),
    };
  }

  return { modules, recent, conversations, continueCard, next };
}

/** Conversation ids whose last tutor message the library needs. */
export function recentConversationIds(conversations: LibraryInput["conversations"]): string[] {
  return conversations
    .filter((c) => c.status === "active")
    .slice(0, RECENT_LIMIT * 2)
    .map((c) => c.id);
}

export interface SearchHit {
  paper: LibraryPaperDto;
  module: { number: number; title: string };
  /** Where the query matched, for the hint line when it is not the title. */
  matched: "title" | "author" | "module" | "concept";
}

/** Client-side search over the library payload (library handoff §5). Keeps course order. */
export function searchLibrary(modules: LibraryModuleDto[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const m of modules) {
    for (const p of m.papers) {
      const matched: SearchHit["matched"] | null = p.title.toLowerCase().includes(q)
        ? "title"
        : p.authors.some((a) => a.toLowerCase().includes(q))
          ? "author"
          : m.title.toLowerCase().includes(q)
            ? "module"
            : p.keyConcepts.some((k) => k.toLowerCase().includes(q))
              ? "concept"
              : null;
      if (matched) hits.push({ paper: p, module: { number: m.number, title: m.title }, matched });
    }
  }
  return hits;
}

export function searchConversations(recent: RecentConversationDto[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return recent.filter(
    (r) =>
      r.paperTitle.toLowerCase().includes(q) ||
      (r.lastTutorQuestion ?? "").toLowerCase().includes(q),
  );
}
