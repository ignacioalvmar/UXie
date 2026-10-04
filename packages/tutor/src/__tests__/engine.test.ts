import { LlmError } from "@uxie/llm";
import { describe, expect, it } from "vitest";
import { TutorError } from "../index";
import { makeHarness, nextId, partial, scripted, STUDENT } from "./harness";

const turnsOf = (h: ReturnType<typeof makeHarness>, purpose: string) =>
  h.calls.filter((c) => c.purpose === purpose);

describe("TutorEngine: conversation start (FR-4.1)", () => {
  it("generates the opening with the start annotation and starter questions, no assessment", async () => {
    const h = makeHarness();
    const turn = await h.engine.startConversation(h.conversationId);
    const res = await turn.done;
    expect(res.help).toEqual({ kind: "ask" });
    expect(turnsOf(h, "assessment")).toHaveLength(0);
    const call = turnsOf(h, "tutor")[0]!;
    expect(call.system).toContain("EVENT: Conversation start");
    expect(call.system).toContain("- What is the difference between a feature being possible");
    expect(call.messages).toEqual([{ role: "user", content: "[Started the conversation]" }]);
    const stored = h.conversations.messages;
    expect(stored.map((m) => [m.role, m.event, m.status])).toEqual([
      ["event", "start", "complete"],
      ["tutor", null, "complete"],
    ]);
  });

  it("refuses a second start, but replays the same start idempotently", async () => {
    const h = makeHarness();
    const id = nextId();
    await (
      await h.engine.startConversation(h.conversationId, id)
    ).done;
    const again = await h.engine.startConversation(h.conversationId, id);
    expect(again.meta.replayed).toBe(true);
    await expect(h.engine.startConversation(h.conversationId)).rejects.toMatchObject({
      code: "already_started",
    });
  });
});

describe("TutorEngine: a full turn (FR-4.2, PRD §4.4)", () => {
  it("assesses, transitions state, streams, validates citations, saves and counts usage", async () => {
    const h = makeHarness();
    h.respond(
      scripted(
        partial,
        "Close! The paper keeps the affordance fixed [p. 2] and invents page [p. 99]. What changed?",
      ),
    );
    const turn = await h.engine.runTurn({
      conversationId: h.conversationId,
      studentId: STUDENT,
      clientMessageId: nextId(),
      text: "An affordance is what the button looks like",
      event: { type: "message" },
    });
    expect(turn.meta.help).toEqual({ kind: "hint", index: 0 });
    let streamed = "";
    for await (const chunk of turn.textStream) streamed += chunk;
    const res = await turn.done;

    expect(streamed).toContain("[p. 99]");
    expect(res.text).toBe(
      "Close! The paper keeps the affordance fixed [p. 2] and invents page. What changed?",
    );
    expect(res.citations).toEqual([{ pageFrom: 2, pageTo: 2, raw: "[p. 2]", index: 44 }]);
    expect(res.state.attempts).toBe(1);
    expect((await h.conversations.get(h.conversationId)).state.attempts).toBe(1);

    const tutorMsg = h.conversations.messages.find((m) => m.id === res.tutorMessageId)!;
    expect(tutorMsg).toMatchObject({ status: "complete", helpLevel: "hint:0", content: res.text });
    const completion = h.conversations.completions.get(res.tutorMessageId)!;
    expect(completion).toMatchObject({ provider: "mock", model: "claude-sonnet-5-5" });
    expect(completion.promptVersion).toMatch(
      /^base@[0-9a-f]{12}\+understand@[0-9a-f]{12}\+hint@[0-9a-f]{12}$/,
    );
    expect(completion.generation).toEqual({
      max_tokens: 2000,
      temperature: null,
      context_strategy: "full",
      pages_included: "all",
      learner: {
        mode: "understand",
        active_objective: res.state.active_objective,
        objectives: res.state.objectives,
        attempts: 1,
        stuck_requests: 0,
        assessment_failed: false,
      },
    });

    const tutorUsage = h.usageEvents.find((e) => e.purpose === "tutor")!;
    expect(tutorUsage.meta).toMatchObject({ citation_invalid: 1, help_level: "hint:0" });
    expect(h.usage.turns.get(`${STUDENT}:2026-10-15`)).toBe(1);
  });

  it("NFR-8 keeps student text out of every system prompt", async () => {
    const h = makeHarness();
    const secret = "my-very-distinctive-student-sentence";
    await h.say(`I think ${secret}`);
    for (const call of h.calls) {
      expect(call.system).not.toContain(secret);
      expect(call.messages.at(-1)!.content).toContain(secret);
    }
  });

  it("ADR-005 assessment failure keeps the previous state and still replies", async () => {
    const h = makeHarness();
    h.respond((call) =>
      call.purpose === "assessment"
        ? { text: "", error: new Error("boom") }
        : "Let's try again. What do you notice?",
    );
    const res = await h.say("something");
    expect(res.debug?.assessmentFailure).toBe("provider_error");
    expect(res.state.attempts).toBe(0);
    expect(res.text).toBe("Let's try again. What do you notice?");
  });

  it("NFR-14 a duplicate clientMessageId yields one student message and one reply", async () => {
    const h = makeHarness();
    const id = nextId();
    const first = await h.say("hello there", id);
    const callsAfterFirst = h.calls.length;
    const turn = await h.engine.runTurn({
      conversationId: h.conversationId,
      studentId: STUDENT,
      clientMessageId: id,
      text: "hello there",
      event: { type: "message" },
    });
    expect(turn.meta.replayed).toBe(true);
    let text = "";
    for await (const c of turn.textStream) text += c;
    expect(text).toBe(first.text);
    expect((await turn.done).tutorMessageId).toBe(first.tutorMessageId);
    expect(h.calls.length).toBe(callsAfterFirst);
    expect(h.conversations.messages.filter((m) => m.role === "student")).toHaveLength(1);
    expect(h.conversations.messages.filter((m) => m.role === "tutor")).toHaveLength(1);
  });

  it("PRD §4.4 a failed generation marks the message failed, keeps the state, and Retry regenerates", async () => {
    const h = makeHarness();
    const outage = new LlmError("provider_unavailable", "overloaded");
    h.respond((call) =>
      call.purpose === "tutor" ? { text: "", error: outage } : JSON.stringify(partial),
    );
    const id = nextId();
    const turn = await h.engine.runTurn({
      conversationId: h.conversationId,
      studentId: STUDENT,
      clientMessageId: id,
      text: "my answer",
      event: { type: "message" },
    });
    const error = await turn.done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TutorError);
    expect((error as TutorError).code).toBe("provider_unavailable");
    expect(h.conversations.messages.find((m) => m.id === turn.meta.tutorMessageId)!.status).toBe(
      "failed",
    );
    expect((await h.conversations.get(h.conversationId)).state.attempts).toBe(0);

    h.respond(scripted(partial, "Recovered. What do you think?"));
    const retried = await h.say("my answer", id);
    expect(retried.text).toBe("Recovered. What do you think?");
    expect(retried.state.attempts).toBe(1);
    expect(h.conversations.messages.filter((m) => m.role === "student")).toHaveLength(1);
    expect(h.conversations.messages.filter((m) => m.role === "tutor").map((m) => m.status)).toEqual(
      ["failed", "complete"],
    );
    // The failed reply never reaches the model as history.
    const lastTutorCall = turnsOf(h, "tutor").at(-1)!;
    expect(lastTutorCall.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  it("FR-4.4 a refusal is a non-retryable failure with code provider_refusal", async () => {
    const h = makeHarness();
    h.respond((call) =>
      call.purpose === "tutor"
        ? { text: "", finishReason: "content-filter" }
        : JSON.stringify(partial),
    );
    const turn = await h.engine.runTurn({
      conversationId: h.conversationId,
      studentId: STUDENT,
      clientMessageId: nextId(),
      text: "x",
      event: { type: "message" },
    });
    await expect(turn.done).rejects.toMatchObject({ code: "provider_refusal" });
  });
});

describe("TutorEngine: help ladder end to end (FR-4.6)", () => {
  it("M7 stuck ×3 records ask → hint → hint → explain → check on tutor messages", async () => {
    const h = makeHarness();
    await (
      await h.engine.startConversation(h.conversationId)
    ).done;
    for (let i = 0; i < 3; i++) {
      await (
        await h.engine.runTurn({
          conversationId: h.conversationId,
          studentId: STUDENT,
          clientMessageId: nextId(),
          event: { type: "stuck" },
        })
      ).done;
    }
    h.respond(scripted(partial));
    await h.say("So the affordance is what is possible?");
    const levels = h.conversations.messages
      .filter((m) => m.role === "tutor")
      .map((m) => m.helpLevel);
    expect(levels).toEqual(["ask", "hint:0", "hint:1", "explain", "check"]);
    expect(turnsOf(h, "tutor")[3]!.system).toContain("HELP DIRECTIVE: EXPLAIN");
    expect(turnsOf(h, "tutor")[1]!.system).toContain("HINT 1 of 3");
    expect(turnsOf(h, "tutor")[1]!.system).toContain("Think about what is possible for the user");
  });

  it("FR-4.4 a shortcut request adds the shortcut note and does not count as stuck", async () => {
    const h = makeHarness();
    h.respond(scripted({ ...partial, intent: "shortcut_request", answer_quality: "none" }));
    const res = await h.say("just summarise the paper for me");
    expect(res.flags.shortcutRequest).toBe(true);
    expect(res.help).toEqual({ kind: "ask" });
    expect(turnsOf(h, "tutor")[0]!.system).toContain("NOTE: The student asked for a shortcut");
  });

  it("M7 meeting U1's mastery check marks it demonstrated with evidence and moves to U2", async () => {
    const h = makeHarness();
    h.respond(
      scripted({
        ...partial,
        answer_quality: "correct",
        objective_updates: [
          {
            objective_id: "U1",
            status: "demonstrated",
            evidence: "Defined both terms; only the signifier varied.",
          },
        ],
      }),
    );
    const res = await h.say(
      "An affordance is what's possible, a signifier shows it; only the cue changed.",
    );
    expect(res.state.objectives.U1).toBe("demonstrated");
    expect(res.state.evidence.U1).toBe("Defined both terms; only the signifier varied.");
    expect(res.state.active_objective).toBe("U2");
    expect(turnsOf(h, "tutor")[0]!.system).toContain("Current objective: U2");
  });
});

describe("TutorEngine: modes (FR-4.7)", () => {
  it("switching mode keeps progress, posts a handover and continues in the new mode", async () => {
    const h = makeHarness();
    h.respond(
      scripted({
        ...partial,
        objective_updates: [{ objective_id: "U1", status: "in_progress", evidence: "" }],
      }),
    );
    await h.say("first try");
    const turn = await h.engine.switchMode(h.conversationId, "apply");
    const res = await turn.done;
    expect(res.state.mode).toBe("apply");
    expect(res.state.objectives.U1).toBe("in_progress");
    expect(res.state.active_objective).toBe("A1");
    const conv = await h.conversations.get(h.conversationId);
    expect(conv.mode).toBe("apply");
    const call = turnsOf(h, "tutor").at(-1)!;
    expect(call.system).toContain("EVENT: The student switched to Apply to UX mode");
    expect(call.system).toContain("MODE: APPLY TO UX");
    expect(call.messages.at(-1)).toEqual({
      role: "user",
      content: "[Switched to Apply to UX mode]",
    });
  });

  it("M7 Apply mode asks for a project when none is saved and uses it once saved", async () => {
    const h = makeHarness({ mode: "apply" });
    await h.say("hi");
    expect(turnsOf(h, "tutor")[0]!.system).toContain("Student project: UNKNOWN");
    h.profiles.projects.set(STUDENT, "A plant-watering reminder app for students.");
    await h.say("ok");
    expect(turnsOf(h, "tutor")[1]!.system).toContain(
      "Student project: A plant-watering reminder app for students.",
    );
  });
});

describe("TutorEngine: caching and history", () => {
  it("NFR-13 the stable prefix is byte-identical across 5 turns and cached from turn 2", async () => {
    const h = makeHarness();
    await (
      await h.engine.startConversation(h.conversationId)
    ).done;
    for (const text of ["one", "two", "three", "four"]) await h.say(text);
    const tutorCalls = turnsOf(h, "tutor");
    expect(tutorCalls).toHaveLength(5);
    const prefixes = new Set(tutorCalls.map((c) => c.systemBlocks[0]));
    expect(prefixes.size).toBe(1);
    expect([...prefixes][0]).toContain('<paper title="Visible Cues');
    const tutorUsage = h.usageEvents.filter((e) => e.purpose === "tutor");
    expect(tutorUsage[0]!.usage.cachedInputTokens).toBe(0);
    for (const e of tutorUsage.slice(1)) expect(e.usage.cachedInputTokens).toBeGreaterThan(0);
  });

  it("FR-4.8 keeps HISTORY_TURNS verbatim and folds older turns into the summary", async () => {
    const h = makeHarness({ config: { historyTurns: 4 } });
    await (
      await h.engine.startConversation(h.conversationId)
    ).done;
    for (const text of ["a1", "a2", "a3"]) {
      await h.say(text);
      await h.engine.maybeSummarizeHistory(h.conversationId);
    }
    const state = (await h.conversations.get(h.conversationId)).state;
    expect(state.history_summary).toBe(
      "The student has been discussing the paper's main concepts.",
    );
    expect(state.summarized_through_message_id).not.toBeNull();
    await h.say("a4");
    const call = turnsOf(h, "tutor").at(-1)!;
    expect(call.messages.length).toBeLessThanOrEqual(4);
    expect(call.messages.at(-1)!.content).toBe("a4");
    expect(call.messages[0]!.role).toBe("user");
    expect(call.system).toContain(
      "Summary of the earlier dialogue: The student has been discussing",
    );
    // A later turn's state save keeps the summary written by the summarizer.
    expect((await h.conversations.get(h.conversationId)).state.history_summary).toBe(
      state.history_summary,
    );
  });

  it("a summarizer failure is logged and retried later, never thrown", async () => {
    const h = makeHarness({ config: { historyTurns: 2 } });
    await h.say("x1");
    await h.say("x2");
    h.respond((call) =>
      call.purpose === "summary" ? { text: "", error: new Error("down") } : JSON.stringify(partial),
    );
    await expect(h.engine.maybeSummarizeHistory(h.conversationId)).resolves.toBe(false);
  });
});

describe("TutorEngine: guards", () => {
  it("rejects other students, closed conversations and empty messages", async () => {
    const h = makeHarness();
    await expect(
      h.engine.runTurn({
        conversationId: h.conversationId,
        studentId: "intruder",
        clientMessageId: nextId(),
        text: "x",
        event: { type: "message" },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.say("   ")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(h.say("x".repeat(4001))).rejects.toMatchObject({ code: "invalid_input" });
    h.conversations.close(h.conversationId);
    await expect(h.say("hello")).rejects.toMatchObject({ code: "conversation_closed" });
  });

  it("FR-3.5 Start over is an adapter concern: the reset event is not a turn", async () => {
    const h = makeHarness();
    await expect(
      h.engine.runTurn({
        conversationId: h.conversationId,
        studentId: STUDENT,
        clientMessageId: nextId(),
        event: { type: "reset" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("TutorEngine: context strategy (PRD §8.6)", () => {
  it("uses retrieval when the paper does not fit and moves the paper block to the dynamic part", async () => {
    const h = makeHarness({ config: { contextWindow: 12_000, retrievalMaxPages: 3 } });
    await h.say("What about the confirmation toast and repeated saves?");
    const call = turnsOf(h, "tutor")[0]!;
    expect(call.systemBlocks[0]).not.toContain("<paper ");
    expect(call.systemBlocks[1]).toMatch(/<paper title="Visible Cues[^>]*included="1,2,5"/);
    const completion = [...h.conversations.completions.values()][0]!;
    expect(completion.generation).toMatchObject({
      context_strategy: "retrieval",
      pages_included: [1, 2, 5],
    });
  });
});
