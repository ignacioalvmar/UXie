import { describe, expect, it } from "vitest";
import { buildLibrary, searchConversations, searchLibrary, type LibraryInput } from "./library";

const guide = (ids: string[], concepts: string[] = []) => ({
  objectives: ids.map((id) => ({ id, keyConcepts: concepts })),
});

function input(conversations: LibraryInput["conversations"] = []): LibraryInput {
  return {
    modules: [
      { id: "m1", slug: "foundations", title: "Foundations" },
      { id: "m2", slug: "perception", title: "Perception" },
    ],
    papers: [
      {
        id: "p1",
        moduleId: "m1",
        slug: "a",
        title: "Affordances",
        authors: ["Gaver"],
        year: 1991,
        currentVersionId: "v1",
      },
      {
        id: "p2",
        moduleId: "m1",
        slug: "b",
        title: "Visible Cues",
        authors: ["Fixture"],
        year: 2026,
        currentVersionId: "v2b",
      },
      {
        id: "p3",
        moduleId: "m2",
        slug: "c",
        title: "Gestalt",
        authors: ["Koffka"],
        year: 1935,
        currentVersionId: "v3",
      },
    ],
    guides: new Map([
      ["v1", guide(["U1", "A1"], ["affordance"])],
      ["v2a", guide(["U1", "A1", "U2"])],
      ["v2b", guide(["U1", "A1", "U2"], ["signifier", "feedback"])],
      ["v3", guide(["U1", "A1"], ["proximity"])],
    ]),
    conversations,
    lastTutorMessages: new Map([["c1", "Good. **What does Gaver mean by a hidden affordance?**"]]),
  };
}

const conv = (
  over: Partial<LibraryInput["conversations"][number]> & {
    id: string;
    paperId: string;
    paperVersionId: string;
  },
): LibraryInput["conversations"][number] => ({
  moduleTitleAtStart: "Foundations",
  mode: "understand",
  status: "active",
  objectives: {},
  lastMessageAt: new Date("2026-10-10T10:00:00Z"),
  createdAt: new Date("2026-10-10T09:00:00Z"),
  ...over,
});

describe("FR-2.1/2.2 library", () => {
  it("numbers papers in course order and marks the first unstarted paper as next", () => {
    const lib = buildLibrary(input());
    expect(lib.modules.map((m) => m.papers.map((p) => p.number))).toEqual([
      ["1.1", "1.2"],
      ["2.1"],
    ]);
    expect(lib.next?.paper.slug).toBe("a");
    expect(lib.continueCard).toBeNull();
    expect(lib.modules[0]!.papers[0]!.status).toBe("not_started");
  });

  it("FR-2.2 Continue: active conversation on the current version, with x of y ideas", () => {
    const lib = buildLibrary(
      input([
        conv({
          id: "c1",
          paperId: "p1",
          paperVersionId: "v1",
          objectives: { U1: "demonstrated", A1: "in_progress" },
        }),
      ]),
    );
    const p1 = lib.modules[0]!.papers[0]!;
    expect(p1).toMatchObject({
      status: "in_conversation",
      objectivesDemonstrated: 1,
      objectivesTotal: 2,
      conversationId: "c1",
    });
    expect(lib.next?.paper.slug).toBe("b");
    expect(lib.continueCard?.conversation).toMatchObject({
      href: "/papers/a?c=c1",
      label: "Module 1, paper 1",
      lastTutorQuestion: "What does Gaver mean by a hidden affordance?",
      canContinue: true,
    });
    expect(lib.continueCard?.objectives).toEqual(["demonstrated", "in_progress"]);
    expect(lib.modules[0]!.discussed).toBe(1);
  });

  it("all objectives demonstrated → all_demonstrated", () => {
    const lib = buildLibrary(
      input([
        conv({
          id: "c1",
          paperId: "p1",
          paperVersionId: "v1",
          objectives: { U1: "demonstrated", A1: "demonstrated" },
        }),
      ]),
    );
    expect(lib.modules[0]!.papers[0]!.status).toBe("all_demonstrated");
  });

  it("FR-2.2 Earlier version discussed: only conversations on superseded versions", () => {
    const lib = buildLibrary(input([conv({ id: "c2", paperId: "p2", paperVersionId: "v2a" })]));
    expect(lib.modules[0]!.papers[1]).toMatchObject({
      status: "earlier_version",
      conversationId: null,
    });
    expect(lib.recent[0]).toMatchObject({ isSupersededVersion: true, canContinue: false });
    expect(lib.continueCard).toBeNull();
  });

  it("FR-2.3 conversations on papers outside the library stay out of the side column", () => {
    const lib = buildLibrary(input([conv({ id: "c9", paperId: "retired", paperVersionId: "vx" })]));
    expect(lib.recent).toEqual([]);
  });

  it("search matches title, author, module and key concepts, in course order", () => {
    const lib = buildLibrary(input([conv({ id: "c1", paperId: "p1", paperVersionId: "v1" })]));
    expect(searchLibrary(lib.modules, "afford").map((h) => [h.paper.slug, h.matched])).toEqual([
      ["a", "title"],
    ]);
    expect(searchLibrary(lib.modules, "koffka")[0]?.matched).toBe("author");
    expect(searchLibrary(lib.modules, "perception")[0]?.matched).toBe("module");
    expect(searchLibrary(lib.modules, "signifier")[0]).toMatchObject({
      matched: "concept",
      paper: { slug: "b" },
    });
    expect(searchLibrary(lib.modules, "   ")).toEqual([]);
    expect(searchConversations(lib.conversations, "hidden").map((c) => c.conversationId)).toEqual([
      "c1",
    ]);
  });
});
