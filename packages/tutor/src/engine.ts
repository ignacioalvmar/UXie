import {
  activeObjective,
  applyAssessment,
  estimateTokens,
  toYaml,
  validateCitations,
  type Assessment,
  type BaseEnv,
  type Citation,
  type HelpLevel,
  type LearnerState,
  type LlmSettings,
  type Mode,
  type TurnEvent,
  type TurnFlags,
} from "@uxie/core";
import { LlmError, type LlmGateway, type Usage } from "@uxie/llm";
import { runAssessment } from "./assessment";
import {
  chooseContextStrategy,
  selectRetrievalPages,
  type ContextStrategy,
  type ContextStrategySetting,
} from "./contextStrategy";
import { foldIntoSummary, messagesToFold } from "./historySummarizer";
import {
  silentLogger,
  type ConversationRecord,
  type ConversationRepo,
  type Logger,
  type MessageRecord,
  type NewStudentMessage,
  type PaperRepo,
  type ProfileRepo,
  type UsageRepo,
} from "./ports";
import { buildTutorPrompt, MODE_LABEL } from "./promptBuilder";
import type { PromptLoader } from "./promptLoader";

export interface TutorConfig {
  stuckThreshold: number;
  /** Verbatim messages kept in the prompt (HISTORY_TURNS). */
  historyTurns: number;
  tutorLanguage: "mirror" | "en";
  contextStrategy: ContextStrategySetting;
  contextWindow: number;
  retrievalMaxPages: number;
  assessmentTimeoutMs: number;
  maxOutputTokens: number;
  temperature?: number;
}

/** Tutor behaviour from env; model-dependent values (context window, output budget) from the LLM settings. */
export function tutorConfig(env: BaseEnv, llm: LlmSettings): TutorConfig {
  return {
    stuckThreshold: env.STUCK_THRESHOLD,
    historyTurns: env.HISTORY_TURNS,
    tutorLanguage: env.TUTOR_LANGUAGE,
    contextStrategy: env.CONTEXT_STRATEGY,
    contextWindow: llm.contextWindow,
    retrievalMaxPages: env.RETRIEVAL_MAX_PAGES,
    assessmentTimeoutMs: env.ASSESSMENT_TIMEOUT_MS,
    maxOutputTokens: llm.maxOutputTokens,
    temperature: llm.temperature,
  };
}

export type TutorErrorCode =
  | "forbidden"
  | "conversation_closed"
  | "already_started"
  | "invalid_input"
  | "internal_error"
  | LlmError["code"];

export class TutorError extends Error {
  constructor(
    public readonly code: TutorErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TutorError";
  }
}

export const MAX_STUDENT_TEXT = 4000;

/** UI labels stored as the content of event messages (shown in transcripts, bracketed for the model). */
const EVENT_LABEL = {
  start: () => "Started the conversation",
  stuck: () => "Explain it to me",
  mode_switch: (mode: Mode) => `Switched to ${MODE_LABEL[mode]} mode`,
};

export const helpLabel = (h: HelpLevel) => (h.kind === "hint" ? `hint:${h.index}` : h.kind);

export function parseHelpLabel(label: string | null): HelpLevel {
  if (label?.startsWith("hint:")) return { kind: "hint", index: Number(label.slice(5)) || 0 };
  if (label === "explain" || label === "check") return { kind: label };
  return { kind: "ask" };
}

export interface TurnDebug {
  assessment: Assessment | null;
  assessmentFailure: string | null;
  assessmentUsage: Usage | null;
  previousState: LearnerState;
  promptVersion: string;
  contextStrategy: ContextStrategy;
  pagesIncluded: number[] | "all";
}

export interface TurnResult {
  tutorMessageId: string;
  /** Final text with invalid citations removed (may differ from the streamed text). */
  text: string;
  citations: Citation[];
  state: LearnerState;
  help: HelpLevel;
  flags: TurnFlags;
  /** null when an already completed reply was replayed. */
  usage: Usage | null;
  debug: TurnDebug | null;
}

export interface TurnStream {
  /** Known before the first token: lets the UI show the help level and character state. */
  meta: {
    tutorMessageId: string;
    studentMessageId: string;
    help: HelpLevel;
    flags: TurnFlags;
    replayed: boolean;
  };
  textStream: AsyncIterable<string>;
  /** Rejects with TutorError; the tutor message is then `failed` and the state is unchanged. */
  done: Promise<TurnResult>;
}

export interface TutorEngineDeps {
  llm: LlmGateway;
  papers: PaperRepo;
  conversations: ConversationRepo;
  profiles: ProfileRepo;
  usage: UsageRepo;
  prompts: PromptLoader;
  config: TutorConfig;
  clock?: () => Date;
  logger?: Logger;
  newId?: () => string;
}

async function* once(text: string): AsyncIterable<string> {
  yield text;
}

/**
 * The tutor turn loop (PRD §4.4 step 5, §3.5): assess → pure transition → streamed reply.
 * Channel- and framework-agnostic; storage only through ports. Locks, auth and limits are the
 * adapter's job.
 */
export class TutorEngine {
  private readonly clock: () => Date;
  private readonly logger: Logger;
  private readonly newId: () => string;

  constructor(private readonly deps: TutorEngineDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.logger = deps.logger ?? silentLogger;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  /** Opening message (FR-4.1). */
  async startConversation(
    conversationId: string,
    clientMessageId = this.newId(),
  ): Promise<TurnStream> {
    const conv = await this.deps.conversations.get(conversationId);
    return this.runTurn({
      conversationId,
      studentId: conv.studentId,
      clientMessageId,
      event: { type: "start" },
    });
  }

  /** Handover line + continuation in the new mode (FR-4.7). */
  async switchMode(
    conversationId: string,
    mode: Mode,
    clientMessageId = this.newId(),
  ): Promise<TurnStream> {
    const conv = await this.deps.conversations.get(conversationId);
    return this.runTurn({
      conversationId,
      studentId: conv.studentId,
      clientMessageId,
      event: { type: "mode_switch", mode },
    });
  }

  async runTurn(input: {
    conversationId: string;
    studentId: string;
    clientMessageId: string;
    text?: string;
    event: TurnEvent;
    signal?: AbortSignal;
  }): Promise<TurnStream> {
    const { deps } = this;
    const { conversationId, event } = input;
    const conv = await deps.conversations.get(conversationId);
    if (conv.studentId !== input.studentId)
      throw new TutorError("forbidden", "Not your conversation");
    if (conv.status !== "active")
      throw new TutorError("conversation_closed", "This conversation is closed");

    const studentMessage = await this.studentMessageFor(conv, input);
    const { id: studentMessageId, existed } =
      await deps.conversations.insertStudentMessage(studentMessage);
    if (existed) {
      // Idempotent retry (NFR-14): return the completed reply, or regenerate a failed one.
      const reply = await deps.conversations.findReply(studentMessageId);
      if (reply?.status === "complete") return this.replay(conv, studentMessageId, reply);
    }

    const paper = await deps.papers.getVersionForTutor(conv.paperVersionId);
    const window = await deps.conversations.recentMessages(
      conversationId,
      deps.config.historyTurns + 4,
    );
    const currentIndex = window.findIndex((m) => m.id === studentMessageId);
    if (currentIndex < 0)
      throw new TutorError("invalid_input", "Only the latest message can be retried");
    const upToCurrent = window.slice(0, currentIndex + 1);
    const history = upToCurrent
      .filter((m) => m.role !== "tutor" || m.status === "complete")
      .slice(-deps.config.historyTurns);
    const lastTutor = [...history].reverse().find((m) => m.role === "tutor");

    const assessed =
      event.type === "message"
        ? await runAssessment(
            {
              llm: deps.llm,
              prompts: deps.prompts,
              logger: this.logger,
              timeoutMs: deps.config.assessmentTimeoutMs,
            },
            {
              guide: paper.guide,
              state: conv.state,
              lastTutorMessage: lastTutor?.content ?? null,
              studentText: studentMessage.content,
              conversationId,
              signal: input.signal,
            },
          )
        : { assessment: null, usage: null, failure: null };

    const { state, help, flags } = applyAssessment({
      state: conv.state,
      guide: paper.guide,
      assessment: assessed.assessment,
      event,
      config: { stuckThreshold: deps.config.stuckThreshold },
    });

    const projectDescription =
      state.mode === "apply"
        ? (await deps.profiles.getTutorContext(conv.studentId)).projectDescription
        : null;
    const strategy = chooseContextStrategy(
      deps.config.contextStrategy,
      paper.tokenEstimate,
      estimateTokens(toYaml(paper.guide)),
      deps.config.contextWindow,
    );
    const retrievedPages =
      strategy === "retrieval"
        ? await selectRetrievalPages({
            papers: deps.papers,
            paper,
            studentText: input.text ?? "",
            objective: activeObjective(state, paper.guide),
            maxPages: deps.config.retrievalMaxPages,
          })
        : undefined;

    const built = buildTutorPrompt(deps.prompts, {
      paper,
      state,
      help,
      flags,
      event,
      history,
      projectDescription,
      tutorLanguage: deps.config.tutorLanguage,
      strategy,
      retrievedPages,
    });

    const { id: tutorMessageId } = await deps.conversations.insertTutorMessage({
      conversationId,
      replyTo: studentMessageId,
      mode: state.mode,
      helpLevel: helpLabel(help),
    });

    const llmStream = deps.llm.stream(built.parts, {
      purpose: "tutor",
      maxTokens: deps.config.maxOutputTokens,
      temperature: deps.config.temperature,
      conversationId,
      signal: input.signal,
      annotate: (text) => ({
        citation_invalid: validateCitations(text, paper.pageCount).invalid.length,
        prompt_version: built.promptVersion,
        help_level: helpLabel(help),
      }),
    });

    const done = (async (): Promise<TurnResult> => {
      try {
        const { text, usage } = await llmStream.done;
        const checked = validateCitations(text, paper.pageCount);
        await deps.conversations.completeTutorMessage(tutorMessageId, {
          content: checked.text,
          citations: checked.valid,
          provider: usage.provider,
          model: usage.model,
          promptVersion: built.promptVersion,
          generation: {
            max_tokens: deps.config.maxOutputTokens,
            temperature: deps.config.temperature ?? null,
            context_strategy: strategy,
            pages_included: built.pagesIncluded,
            learner: {
              mode: state.mode,
              active_objective: state.active_objective,
              objectives: state.objectives,
              attempts: state.attempts,
              stuck_requests: state.stuck_requests,
              assessment_failed: assessed.failure !== null,
            },
          },
        });
        // Keep summary fields the summarizer may have written meanwhile (see ConversationRepo.saveSummary).
        const fresh = await deps.conversations.get(conversationId);
        const toSave: LearnerState = {
          ...state,
          history_summary: fresh.state.history_summary,
          summarized_through_message_id: fresh.state.summarized_through_message_id,
        };
        await deps.conversations.saveState(conversationId, toSave, toSave.mode);
        await deps.usage.incrementTurn(conv.studentId, this.clock().toISOString().slice(0, 10));
        return {
          tutorMessageId,
          text: checked.text,
          citations: checked.valid,
          state: toSave,
          help,
          flags,
          usage,
          debug: {
            assessment: assessed.assessment,
            assessmentFailure: assessed.failure,
            assessmentUsage: assessed.usage,
            previousState: conv.state,
            promptVersion: built.promptVersion,
            contextStrategy: strategy,
            pagesIncluded: built.pagesIncluded,
          },
        };
      } catch (e) {
        // Failed generation: mark the message failed and do NOT save the new state (PRD §4.4).
        const code: TutorErrorCode = e instanceof LlmError ? e.code : "internal_error";
        this.logger.error({ conversationId, errorCode: code }, "reply_failed");
        await deps.conversations.failTutorMessage(tutorMessageId, code).catch(() => {});
        throw new TutorError(code, e instanceof Error ? e.message : "Reply failed", { cause: e });
      }
    })();
    done.catch(() => {});

    return {
      meta: { tutorMessageId, studentMessageId, help, flags, replayed: false },
      textStream: llmStream.textStream,
      done,
    };
  }

  /** Fold old turns into `history_summary` (FR-4.8). Call after a turn (Next.js `after()`). */
  async maybeSummarizeHistory(conversationId: string): Promise<boolean> {
    const { deps } = this;
    const conv = await deps.conversations.get(conversationId);
    const unsummarized = await deps.conversations.messagesAfter(
      conversationId,
      conv.state.summarized_through_message_id,
    );
    const fold = messagesToFold(unsummarized, deps.config.historyTurns);
    if (!fold.length) return false;
    try {
      const summary = await foldIntoSummary(
        { llm: deps.llm, prompts: deps.prompts },
        { previousSummary: conv.state.history_summary, messages: fold, conversationId },
      );
      await deps.conversations.saveSummary(conversationId, summary, fold.at(-1)!.id);
      return true;
    } catch (e) {
      // Retried on the next turn; the verbatim window still carries the recent dialogue.
      this.logger.warn(
        { conversationId, errorCode: e instanceof LlmError ? e.code : "internal_error" },
        "summary_failed",
      );
      return false;
    }
  }

  private async studentMessageFor(
    conv: ConversationRecord,
    input: { conversationId: string; clientMessageId: string; text?: string; event: TurnEvent },
  ): Promise<NewStudentMessage> {
    const base = { conversationId: input.conversationId, clientMessageId: input.clientMessageId };
    switch (input.event.type) {
      case "message": {
        const text = input.text?.trim() ?? "";
        if (!text) throw new TutorError("invalid_input", "Message is empty");
        if (text.length > MAX_STUDENT_TEXT)
          throw new TutorError(
            "invalid_input",
            `Message is longer than ${MAX_STUDENT_TEXT} characters`,
          );
        return { ...base, role: "student", event: null, content: text, mode: conv.mode };
      }
      case "start": {
        const first = (await this.deps.conversations.messagesAfter(conv.id, null))[0];
        if (first && first.clientMessageId !== input.clientMessageId) {
          throw new TutorError("already_started", "The conversation has already started");
        }
        return {
          ...base,
          role: "event",
          event: "start",
          content: EVENT_LABEL.start(),
          mode: conv.mode,
        };
      }
      case "stuck":
        return {
          ...base,
          role: "event",
          event: "stuck",
          content: EVENT_LABEL.stuck(),
          mode: conv.mode,
        };
      case "mode_switch":
        return {
          ...base,
          role: "event",
          event: "mode_switch",
          content: EVENT_LABEL.mode_switch(input.event.mode),
          mode: input.event.mode,
        };
      case "reset":
        throw new TutorError(
          "invalid_input",
          "Start over creates a new conversation; it is not a turn",
        );
    }
  }

  private replay(
    conv: ConversationRecord,
    studentMessageId: string,
    reply: MessageRecord,
  ): TurnStream {
    const help = parseHelpLabel(reply.helpLevel);
    const flags = { shortcutRequest: false, offTopic: false };
    return {
      meta: { tutorMessageId: reply.id, studentMessageId, help, flags, replayed: true },
      textStream: once(reply.content),
      done: Promise.resolve({
        tutorMessageId: reply.id,
        text: reply.content,
        citations: reply.citations,
        state: conv.state,
        help,
        flags,
        usage: null,
        debug: null,
      }),
    };
  }
}
