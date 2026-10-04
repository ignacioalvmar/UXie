import { describe, expect, it } from "vitest";
import {
  boldFinalQuestion,
  lastQuestion,
  linkCitations,
  parseCiteHref,
  splitIllustrations,
} from "./text";

describe("FR-3.4 tutor message rendering helpers", () => {
  it("turns citations into chip links, ranges included", () => {
    expect(linkCitations("See [p. 4] and [p. 4–5].")).toBe(
      "See [p. 4](#cite-4-4) and [p. 4–5](#cite-4-5).",
    );
    expect(parseCiteHref("#cite-4-5")).toEqual({ from: 4, to: 5 });
    expect(parseCiteHref("https://example.com")).toBeNull();
  });

  it("leaves citations inside code alone", () => {
    expect(linkCitations("Use `[p. 4]` literally")).toBe("Use `[p. 4]` literally");
  });

  it("splits a 💡 Illustrative example paragraph into its own block", () => {
    const md =
      "The paper shows X [p. 2].\n\n💡 Illustrative example: A thermostat app…\n\nWhat do you think?";
    expect(splitIllustrations(md)).toEqual([
      { kind: "text", markdown: "The paper shows X [p. 2]." },
      { kind: "illustration", markdown: "A thermostat app…" },
      { kind: "text", markdown: "What do you think?" },
    ]);
  });

  it("bolds the final question of the turn", () => {
    expect(boldFinalQuestion("Good point [p. 2]. What changed between the versions?")).toBe(
      "Good point [p. 2]. **What changed between the versions?**",
    );
    expect(boldFinalQuestion("Intro.\n\nFirst? Then, what does it mean for you?")).toBe(
      "Intro.\n\nFirst? **Then, what does it mean for you?**",
    );
  });

  it("does not bold when the turn ends without a question or is already bold", () => {
    expect(boldFinalQuestion("A statement.")).toBe("A statement.");
    expect(boldFinalQuestion("**Already bold?**")).toBe("**Already bold?**");
    expect(boldFinalQuestion("A question? Then a statement.")).toBe(
      "A question? Then a statement.",
    );
  });

  it("extracts the last question as plain text for the library cards", () => {
    expect(
      lastQuestion("Nice. The study used a lab [p. 3]. **What would a field study add?**"),
    ).toBe("What would a field study add?");
    expect(lastQuestion("No question here.")).toBe("No question here.");
  });
});
