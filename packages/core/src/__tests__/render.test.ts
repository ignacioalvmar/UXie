import { describe, expect, it } from "vitest";
import { TemplateError, renderTemplate } from "../index";

describe("renderTemplate", () => {
  it("substitutes variables, with or without spaces, and dotted paths", () => {
    expect(renderTemplate("{{a}} and {{ b.c }}!", { a: "x", b: { c: 2 } })).toBe("x and 2!");
  });

  it("renders booleans and zero", () => {
    expect(renderTemplate("{{a}} {{b}}", { a: false, b: 0 })).toBe("false 0");
  });

  it("throws on unknown, null and non-scalar variables", () => {
    expect(() => renderTemplate("{{missing}}", {})).toThrow(/Unknown variable "missing"/);
    expect(() => renderTemplate("{{a.b}}", { a: {} })).toThrow(TemplateError);
    expect(() => renderTemplate("{{a}}", { a: null })).toThrow(/null/);
    expect(() => renderTemplate("{{a}}", { a: [1] })).toThrow(/scalar/);
  });

  it("supports if / else with falsy values", () => {
    const tpl = "{{#if x}}yes{{else}}no{{/if}}";
    for (const x of [true, "s", 1, ["a"]]) expect(renderTemplate(tpl, { x })).toBe("yes");
    for (const x of [false, "", 0, [], null, undefined])
      expect(renderTemplate(tpl, { x })).toBe("no");
    expect(renderTemplate(tpl, {})).toBe("no");
    expect(renderTemplate("{{#if x}}yes{{/if}}", {})).toBe("");
  });

  it("supports each with this, fields, @index, @number and outer variables", () => {
    const out = renderTemplate("{{#each xs}}{{@number}}.{{this.n}}{{sep}}{{/each}}", {
      xs: [{ n: "a" }, { n: "b" }],
      sep: ";",
    });
    expect(out).toBe("1.a;2.b;");
    expect(renderTemplate("{{#each xs}}[{{@index}}:{{this}}]{{/each}}", { xs: ["p", "q"] })).toBe(
      "[0:p][1:q]",
    );
    expect(renderTemplate("{{#each xs}}x{{/each}}", {})).toBe("");
  });

  it("nests blocks", () => {
    const tpl = "{{#each xs}}{{#if this.on}}{{this.name}} {{/if}}{{/each}}";
    expect(
      renderTemplate(tpl, {
        xs: [
          { on: true, name: "a" },
          { on: false, name: "b" },
          { on: 1, name: "c" },
        ],
      }),
    ).toBe("a c ");
  });

  it("removes lines that hold only a block tag", () => {
    const tpl = "Start\n{{#if x}}\nInside {{x}}\n{{else}}\nOther\n{{/if}}\n  {{! comment }}\nEnd\n";
    expect(renderTemplate(tpl, { x: "v" })).toBe("Start\nInside v\nEnd\n");
    expect(renderTemplate(tpl, { x: "" })).toBe("Start\nOther\nEnd\n");
    const list = "Items:\n{{#each xs}}\n- {{this}}\n{{/each}}\nDone";
    expect(renderTemplate(list, { xs: ["a", "b"] })).toBe("Items:\n- a\n- b\nDone");
  });

  it("keeps inline block tags inline", () => {
    expect(renderTemplate("a {{#if x}}b{{/if}} c", { x: true })).toBe("a b c");
    expect(renderTemplate("{{v}} {{#if x}}\nb\n{{/if}}", { v: "a", x: true })).toBe("a \nb\n");
  });

  it("handles CRLF line endings", () => {
    expect(renderTemplate("A\r\n{{#if x}}\r\nB\r\n{{/if}}\r\nC", { x: 1 })).toBe("A\r\nB\r\nC");
  });

  it.each([
    ["{{#if x}}open", /Missing \{\{\/if\}\}/],
    ["{{/if}}", /Unexpected/],
    ["{{#each xs}}a{{/if}}", /Unexpected/],
    ["{{else}}", /Unexpected \{\{else\}\}/],
    ["{{#if x}}a{{else}}b{{else}}c{{/if}}", /Unexpected \{\{else\}\}/],
    ["{{#each xs}}a{{else}}b{{/each}}", /Unexpected \{\{else\}\}/],
    ["{{#unless x}}{{/unless}}", /Invalid block tag/],
    ["{{/unless}}", /Unknown closing tag/],
    ["{{a + 1}}", /Invalid expression/],
    ["{{this}}", /outside/],
    ["{{@index}}", /outside/],
  ])("rejects %s", (tpl, error) => {
    expect(() => renderTemplate(tpl, { x: true, xs: [1] })).toThrow(error);
  });

  it("rejects each over a non-list", () => {
    expect(() => renderTemplate("{{#each x}}a{{/each}}", { x: "s" })).toThrow(/not a list/);
  });
});
