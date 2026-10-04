import "server-only";
import type { ExtractionWarning, Mode } from "@uxie/core";
import {
  StudentViewsRepo,
  type ChatMessageRow,
  type ConversationRow,
  type GuideSummary,
} from "@uxie/db";
import { progressDto } from "./chat/turn";
import type { ChatMessageDto, ConversationDto, ProgressDto } from "./chat/types";
import { buildLibrary, recentConversationIds, type LibraryDto } from "./library";
import { serviceDb } from "./supabase/server";

/**
 * Server read models for the student pages and their JSON routes (PRD §11). The secret-key
 * repository applies the §9.2 visibility rules; callers pass the authenticated student id.
 */

export const views = () => new StudentViewsRepo(serviceDb());

/** A lock older than this is stale (same as `acquire_generation_lock`). */
const LOCK_STALE_MS = 2 * 60_000;

/**
 * A version of the paper `slug` that the student may read (PRD §9.3, same rule as
 * `can_read_version()`), or null. Everything else answers 404 (existence not revealed).
 */
export async function readableVersion(studentId: string, slug: string, versionId: string) {
  const repo = views();
  const [found, meta] = await Promise.all([
    repo.visiblePaperBySlug(slug),
    repo.versionMeta(versionId),
  ]);
  if (!found || !meta || meta.paperId !== found.paper.id) return null;
  return (await repo.studentCanReadVersion(studentId, versionId)) ? meta : null;
}

export async function loadLibrary(studentId: string): Promise<LibraryDto> {
  const repo = views();
  const modules = await repo.publishedModules();
  const [papers, conversations] = await Promise.all([
    repo.publishedPapers(modules.map((m) => m.id)),
    repo.conversationsOf(studentId),
  ]);
  const [guides, lastTutorMessages] = await Promise.all([
    repo.guideSummaries([
      ...papers.flatMap((p) => (p.currentVersionId ? [p.currentVersionId] : [])),
      ...conversations.map((c) => c.paperVersionId),
    ]),
    repo.lastTutorMessages(
      recentConversationIds(conversations.map((c) => ({ ...c, objectives: c.state.objectives }))),
    ),
  ]);
  return buildLibrary({
    modules,
    papers,
    guides,
    conversations: conversations.map((c) => ({ ...c, objectives: c.state.objectives })),
    lastTutorMessages,
  });
}

export function messageDto(m: ChatMessageRow): ChatMessageDto {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    status: m.status,
    event: m.event,
    helpLevel: m.helpLevel,
    clientMessageId: m.clientMessageId,
    citations: m.citations,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function conversationDto(
  conv: ConversationRow,
  guide: GuideSummary,
  currentVersionId: string | null,
): Promise<ConversationDto> {
  const messages = await views().messages(conv.id);
  const generating =
    conv.generatingSince !== null && Date.now() - conv.generatingSince.getTime() < LOCK_STALE_MS;
  return {
    id: conv.id,
    mode: conv.mode,
    status: conv.status,
    paperVersionId: conv.paperVersionId,
    isCurrentVersion: conv.paperVersionId === currentVersionId,
    generating,
    messages: messages.map(messageDto),
    progress: progressDto(conv.state, guide),
  };
}

export interface WorkspaceDto {
  paper: {
    id: string;
    slug: string;
    title: string;
    authors: string[];
    year: number | null;
    status: "published" | "retired";
  };
  module: { title: string; number: number | null };
  paperNumber: number | null;
  version: {
    id: string;
    versionNo: number;
    pageCount: number;
    warnings: ExtractionWarning[];
    isCurrent: boolean;
  };
  starterQuestions: string[];
  /** Progress with every objective "not started" until a conversation exists. */
  objectives: ProgressDto[];
  conversation: ConversationDto | null;
  /** New turns allowed: paper published and the conversation (if any) active. */
  chatOpen: boolean;
  defaultMode: Mode;
}

export type WorkspaceResult =
  | { kind: "ok"; workspace: WorkspaceDto }
  | { kind: "not_found" }
  | { kind: "unavailable"; title: string };

/**
 * FR-3.1: the current published version, or the conversation's version with `?c=`. Without
 * `?c=`, the student's active conversation on the current version is resumed (it already exists;
 * reading alone never creates one, FR-3.2).
 */
export async function loadWorkspace(
  studentId: string,
  slug: string,
  conversationId?: string | null,
): Promise<WorkspaceResult> {
  const repo = views();
  const found = await repo.visiblePaperBySlug(slug);
  if (!found) return { kind: "not_found" };
  const { paper, module } = found;

  let conv: ConversationRow | null = null;
  if (conversationId) {
    const own = await repo.ownConversation(studentId, conversationId);
    if (own && own.paperId === paper.id) conv = own;
  }
  if (!conv && paper.status === "published" && paper.currentVersionId)
    conv = await repo.activeConversation(studentId, paper.currentVersionId);

  const versionId =
    conv?.paperVersionId ?? (paper.status === "published" ? paper.currentVersionId : null);
  const version = versionId ? await repo.versionMeta(versionId) : null;
  if (!version || (!conv && version.status !== "published"))
    return { kind: "unavailable", title: paper.title };

  const [guide, modules] = await Promise.all([
    repo.guideSummary(version.id),
    repo.publishedModules(),
  ]);
  const moduleIndex = modules.findIndex((m) => m.id === module.id);
  const siblings = moduleIndex >= 0 ? await repo.publishedPapers([module.id]) : [];
  const paperIndex = siblings.findIndex((p) => p.id === paper.id);

  const conversation = conv ? await conversationDto(conv, guide, paper.currentVersionId) : null;
  const objectives =
    conversation?.progress ??
    guide.objectives.map((o, i) => ({
      id: o.id,
      kind: o.kind,
      statement: o.statement,
      status: "not_started" as const,
      evidence: null,
      active: i === 0,
      refs: o.refs,
    }));

  return {
    kind: "ok",
    workspace: {
      paper: {
        id: paper.id,
        slug: paper.slug,
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
        status: paper.status === "retired" ? "retired" : "published",
      },
      module: { title: module.title, number: moduleIndex >= 0 ? moduleIndex + 1 : null },
      paperNumber: paperIndex >= 0 ? paperIndex + 1 : null,
      version: {
        id: version.id,
        versionNo: version.versionNo,
        pageCount: version.pageCount,
        warnings: version.warnings,
        isCurrent: version.id === paper.currentVersionId,
      },
      starterQuestions: guide.starterQuestions,
      objectives,
      conversation,
      chatOpen:
        paper.status === "published" &&
        guide.objectives.length > 0 &&
        (conversation ? conversation.status === "active" : version.status === "published"),
      defaultMode: "understand",
    },
  };
}

export interface ConversationListItem {
  id: string;
  paperSlug: string;
  paperTitle: string;
  moduleTitle: string;
  mode: Mode;
  status: "active" | "reset" | "closed";
  versionNo: number | null;
  isSupersededVersion: boolean;
  isRetired: boolean;
  lastActivity: string;
  objectivesDemonstrated: number;
  objectivesTotal: number;
}

/** FR-3.9: the student's conversations grouped by paper (most recent paper first). */
export async function loadConversationList(studentId: string) {
  const repo = views();
  const conversations = await repo.conversationsOf(studentId);
  const [papers, versions, guides] = await Promise.all([
    repo.papersById(conversations.map((c) => c.paperId)),
    repo.versionNumbers(conversations.map((c) => c.paperVersionId)),
    repo.guideSummaries(conversations.map((c) => c.paperVersionId)),
  ]);
  const groups = new Map<
    string,
    { paperSlug: string; paperTitle: string; items: ConversationListItem[] }
  >();
  for (const c of conversations) {
    const paper = papers.get(c.paperId);
    if (!paper) continue;
    const ids = guides.get(c.paperVersionId)?.objectives.map((o) => o.id) ?? [];
    const item: ConversationListItem = {
      id: c.id,
      paperSlug: paper.slug,
      paperTitle: paper.title,
      moduleTitle: c.moduleTitleAtStart,
      mode: c.mode,
      status: c.status,
      versionNo: versions.get(c.paperVersionId) ?? null,
      isSupersededVersion: c.paperVersionId !== paper.currentVersionId,
      isRetired: paper.status === "retired",
      lastActivity: (c.lastMessageAt ?? c.createdAt).toISOString(),
      objectivesDemonstrated: ids.filter((id) => c.state.objectives[id] === "demonstrated").length,
      objectivesTotal: ids.length,
    };
    const group = groups.get(paper.id) ?? {
      paperSlug: paper.slug,
      paperTitle: paper.title,
      items: [],
    };
    group.items.push(item);
    groups.set(paper.id, group);
  }
  return [...groups.values()];
}
