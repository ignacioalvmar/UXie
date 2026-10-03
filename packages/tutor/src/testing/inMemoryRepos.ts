import {
  initialState,
  type LearnerState,
  type Mode,
  type Page,
  type TeachingGuide,
} from "@uxie/core";
import type {
  ConversationRecord,
  ConversationRepo,
  LlmCallRecord,
  LlmCallRepo,
  MessageRecord,
  PaperForTutor,
  PaperRepo,
  ProfileRepo,
  UsageRepo,
} from "../ports";

/**
 * In-memory implementations of the tutor ports (PRD §4.3) for the CLI, evals and tests.
 * Same semantics as packages/db: idempotent student inserts, chronological history.
 */

const clone = <T>(x: T): T => structuredClone(x);

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export class InMemoryPaperRepo implements PaperRepo {
  private versions = new Map<string, PaperForTutor>();

  add(paper: {
    versionId: string;
    paperId?: string;
    title: string;
    pages: Page[];
    guide: TeachingGuide;
  }): PaperForTutor {
    const record: PaperForTutor = {
      versionId: paper.versionId,
      paperId: paper.paperId ?? paper.versionId,
      title: paper.title,
      pageCount: paper.pages.length,
      pages: paper.pages,
      guide: paper.guide,
      tokenEstimate: Math.ceil(paper.pages.reduce((n, p) => n + p.text.length, 0) / 4),
    };
    this.versions.set(paper.versionId, record);
    return record;
  }

  async getVersionForTutor(versionId: string): Promise<PaperForTutor> {
    const v = this.versions.get(versionId);
    if (!v) throw new NotFoundError(`Paper version ${versionId}`);
    return v;
  }

  /** Simple term-overlap ranking standing in for Postgres FTS. */
  async searchPages(versionId: string, query: string, limit: number): Promise<number[]> {
    const paper = await this.getVersionForTutor(versionId);
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\d]{3,}/gu) ?? [])];
    return paper.pages
      .map((p) => {
        const text = p.text.toLowerCase();
        return { n: p.n, score: terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.n - b.n)
      .slice(0, limit)
      .map((x) => x.n);
  }
}

export class InMemoryConversationRepo implements ConversationRepo {
  readonly conversations = new Map<string, ConversationRecord>();
  readonly messages: MessageRecord[] = [];
  private tick = 0;

  constructor(private readonly newId: () => string = () => crypto.randomUUID()) {}

  create(input: {
    studentId: string;
    paperVersionId: string;
    guide: TeachingGuide;
    mode?: Mode;
    id?: string;
    isTest?: boolean;
  }): ConversationRecord {
    const mode = input.mode ?? "understand";
    const record: ConversationRecord = {
      id: input.id ?? this.newId(),
      studentId: input.studentId,
      paperVersionId: input.paperVersionId,
      mode,
      state: initialState(input.guide, mode),
      status: "active",
      isTest: input.isTest ?? false,
    };
    this.conversations.set(record.id, record);
    return clone(record);
  }

  close(conversationId: string, status: "reset" | "closed" = "reset") {
    const c = this.conversations.get(conversationId);
    if (c) c.status = status;
  }

  async get(conversationId: string): Promise<ConversationRecord> {
    const c = this.conversations.get(conversationId);
    if (!c) throw new NotFoundError(`Conversation ${conversationId}`);
    return clone(c);
  }

  private of(conversationId: string) {
    return this.messages.filter((m) => m.conversationId === conversationId);
  }

  async recentMessages(conversationId: string, limit: number): Promise<MessageRecord[]> {
    return clone(this.of(conversationId).slice(-limit));
  }

  async messagesAfter(
    conversationId: string,
    afterMessageId: string | null,
  ): Promise<MessageRecord[]> {
    const all = this.of(conversationId);
    const i = afterMessageId === null ? -1 : all.findIndex((m) => m.id === afterMessageId);
    return clone(all.slice(i + 1));
  }

  async insertStudentMessage(m: Parameters<ConversationRepo["insertStudentMessage"]>[0]) {
    const existing = this.of(m.conversationId).find((x) => x.clientMessageId === m.clientMessageId);
    if (existing) return { id: existing.id, existed: true };
    const id = this.newId();
    this.messages.push({
      id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      status: "complete",
      event: m.event,
      mode: m.mode,
      helpLevel: null,
      clientMessageId: m.clientMessageId,
      replyTo: null,
      citations: [],
      createdAt: this.now(),
    });
    return { id, existed: false };
  }

  async findReply(studentMessageId: string): Promise<MessageRecord | null> {
    const replies = this.messages.filter((m) => m.replyTo === studentMessageId);
    return replies.length ? clone(replies.at(-1)!) : null;
  }

  async insertTutorMessage(m: Parameters<ConversationRepo["insertTutorMessage"]>[0]) {
    const id = this.newId();
    this.messages.push({
      id,
      conversationId: m.conversationId,
      role: "tutor",
      content: "",
      status: "streaming",
      event: null,
      mode: m.mode,
      helpLevel: m.helpLevel,
      clientMessageId: null,
      replyTo: m.replyTo,
      citations: [],
      createdAt: this.now(),
    });
    return { id };
  }

  /** Extra fields kept for debugging and tests (provider, model, prompt version, generation). */
  readonly completions = new Map<string, Parameters<ConversationRepo["completeTutorMessage"]>[1]>();
  readonly failures = new Map<string, string>();

  async completeTutorMessage(
    id: string,
    patch: Parameters<ConversationRepo["completeTutorMessage"]>[1],
  ) {
    const m = this.messages.find((x) => x.id === id);
    if (!m) throw new NotFoundError(`Message ${id}`);
    m.content = patch.content;
    m.citations = patch.citations;
    m.status = "complete";
    this.completions.set(id, clone(patch));
  }

  async failTutorMessage(id: string, errorCode: string) {
    const m = this.messages.find((x) => x.id === id);
    if (m) m.status = "failed";
    this.failures.set(id, errorCode);
  }

  async saveState(conversationId: string, state: LearnerState, mode: Mode) {
    const c = this.conversations.get(conversationId);
    if (!c) throw new NotFoundError(`Conversation ${conversationId}`);
    c.state = clone(state);
    c.mode = mode;
  }

  async saveSummary(conversationId: string, summary: string, throughMessageId: string) {
    const c = this.conversations.get(conversationId);
    if (!c) throw new NotFoundError(`Conversation ${conversationId}`);
    c.state = {
      ...c.state,
      history_summary: summary,
      summarized_through_message_id: throughMessageId,
    };
  }

  private now() {
    return new Date(Date.UTC(2026, 9, 1) + ++this.tick * 1000);
  }
}

export class InMemoryUsageRepo implements UsageRepo {
  readonly turns = new Map<string, number>();
  async incrementTurn(studentId: string, day: string) {
    const key = `${studentId}:${day}`;
    const n = (this.turns.get(key) ?? 0) + 1;
    this.turns.set(key, n);
    return n;
  }
}

export class InMemoryProfileRepo implements ProfileRepo {
  readonly projects = new Map<string, string>();
  async getTutorContext(studentId: string) {
    return { projectDescription: this.projects.get(studentId) ?? null };
  }
}

export class InMemoryLlmCallRepo implements LlmCallRepo {
  readonly calls: LlmCallRecord[] = [];
  async record(call: LlmCallRecord) {
    this.calls.push(clone(call));
  }
}
