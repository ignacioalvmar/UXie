import { describe, expect, it } from "vitest";
import { lastStudentTurn, requestFor, toTranscript } from "./transcript";
import type { ChatMessageDto } from "./types";

const msg = (
  over: Partial<ChatMessageDto> & Pick<ChatMessageDto, "id" | "role">,
): ChatMessageDto => ({
  content: "",
  status: "complete",
  event: null,
  mode: null,
  helpLevel: null,
  clientMessageId: null,
  citations: [],
  feedback: null,
  createdAt: "2026-10-15T10:00:00Z",
  ...over,
});

describe("FR-3.4 / NFR-14 resume transcript", () => {
  it("keeps student keys, drops failed replies that were regenerated, carries help levels", () => {
    const t = toTranscript(
      [
        msg({
          id: "s1",
          role: "event",
          event: "start",
          clientMessageId: "k0",
          content: "Started the conversation",
        }),
        msg({ id: "t1", role: "tutor", content: "Welcome [p. 1]. What first?" }),
        msg({ id: "s2", role: "student", clientMessageId: "k1", content: "Signifiers?" }),
        msg({ id: "t2", role: "tutor", status: "failed" }),
        msg({ id: "t3", role: "tutor", content: "Hint…", helpLevel: "hint:1" }),
      ],
      false,
    );
    expect(t.messages.map((m) => [m.role, m.id])).toEqual([
      ["user", "k0"],
      ["assistant", "t1"],
      ["user", "k1"],
      ["assistant", "t3"],
    ]);
    expect(t.messages[3]!.metadata?.help).toEqual({ kind: "hint", index: 1 });
    expect(t.lastReplyFailed).toBe(false);
  });

  it("a trailing failed reply offers Try again with the same clientMessageId", () => {
    const t = toTranscript(
      [
        msg({ id: "s2", role: "student", clientMessageId: "k1", content: "My answer" }),
        msg({ id: "t2", role: "tutor", status: "failed" }),
      ],
      false,
    );
    expect(t.lastReplyFailed).toBe(true);
    expect(lastStudentTurn(t.messages)).toEqual({
      clientMessageId: "k1",
      text: "My answer",
      event: null,
      switchTo: null,
    });
  });

  it("a reply still streaming elsewhere is pending, not failed", () => {
    const t = toTranscript(
      [
        msg({ id: "s2", role: "student", clientMessageId: "k1" }),
        msg({ id: "t2", role: "tutor", status: "streaming" }),
      ],
      true,
    );
    expect(t).toMatchObject({ pending: true, lastReplyFailed: false });
  });
});

describe("PRD §11 request routing per student turn", () => {
  const turn = (over: Partial<NonNullable<ReturnType<typeof lastStudentTurn>>> = {}) => ({
    clientMessageId: "k1",
    text: "Hi",
    event: null,
    switchTo: null,
    ...over,
  });

  it("FR-3.2 the first action creates the conversation, with the chosen mode", () => {
    expect(requestFor(turn(), null, "visible-cues")).toEqual({
      api: "/api/conversations",
      body: { paperSlug: "visible-cues", clientMessageId: "k1", text: "Hi" },
    });
    expect(requestFor(turn({ event: "start", switchTo: "apply" }), null, "visible-cues")).toEqual({
      api: "/api/conversations",
      body: { paperSlug: "visible-cues", clientMessageId: "k1", mode: "apply" },
    });
  });

  it("FR-3.5 Explain it to me → stuck event; mode switch → /mode; text → /messages", () => {
    expect(requestFor(turn({ event: "stuck" }), "c1", "p")).toEqual({
      api: "/api/conversations/c1/messages",
      body: { clientMessageId: "k1", event: "stuck" },
    });
    expect(requestFor(turn({ event: "mode_switch", switchTo: "apply" }), "c1", "p")).toEqual({
      api: "/api/conversations/c1/mode",
      body: { clientMessageId: "k1", mode: "apply" },
    });
    expect(requestFor(turn(), "c1", "p")).toEqual({
      api: "/api/conversations/c1/messages",
      body: { clientMessageId: "k1", text: "Hi" },
    });
  });

  it("a resumed mode-switch event keeps its target mode for Retry", () => {
    const t = toTranscript(
      [
        msg({
          id: "e1",
          role: "event",
          event: "mode_switch",
          mode: "apply",
          clientMessageId: "k9",
        }),
        msg({ id: "t1", role: "tutor", status: "failed" }),
      ],
      false,
    );
    expect(lastStudentTurn(t.messages)).toMatchObject({ event: "mode_switch", switchTo: "apply" });
  });
});
