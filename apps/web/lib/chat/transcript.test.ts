import { describe, expect, it } from "vitest";
import { lastStudentTurn, toTranscript } from "./transcript";
import type { ChatMessageDto } from "./types";

const msg = (
  over: Partial<ChatMessageDto> & Pick<ChatMessageDto, "id" | "role">,
): ChatMessageDto => ({
  content: "",
  status: "complete",
  event: null,
  helpLevel: null,
  clientMessageId: null,
  citations: [],
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
