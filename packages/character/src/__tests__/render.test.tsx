import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UxieCharacter } from "../UxieCharacter";
import { CHARACTER_IDS, CHARACTER_STATES } from "../types";

describe("UxieCharacter", () => {
  it.each(CHARACTER_IDS)("renders %s in every state", (character) => {
    for (const state of CHARACTER_STATES) {
      const html = renderToStaticMarkup(<UxieCharacter character={character} state={state} />);
      expect(html).toContain(`class="uxie s-${state} t-normal"`);
      expect(html).toContain("<svg");
      expect(html).not.toContain("{{");
      expect(html).not.toContain("undefined");
    }
  });

  it("gives each instance unique gradient ids", () => {
    const html = renderToStaticMarkup(
      <>
        <UxieCharacter character="pip" />
        <UxieCharacter character="pip" />
      </>,
    );
    const ids = [...html.matchAll(/id="(pb-[^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("applies custom colors and size", () => {
    const html = renderToStaticMarkup(
      <UxieCharacter character="luma" size={150} colors={{ body: "#9FD8CE" }} paused />,
    );
    expect(html).toContain("#9fd8ce");
    expect(html).toContain("width:150px;height:170px");
    expect(html).toContain("ux-still");
    expect(html).toContain('aria-label="UXie as Luma, idle"');
  });

  it("can be decorative", () => {
    const html = renderToStaticMarkup(<UxieCharacter character="miso" decorative />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
  });
});
