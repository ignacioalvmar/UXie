/**
 * Tiny template renderer for /prompts (PRD §8.2). Supported syntax:
 *   {{ path.to.value }}               value (string | number | boolean); unknown or null → TemplateError
 *   {{#if path}} … {{else}} … {{/if}} falsy: false, null, undefined, "", 0, []
 *   {{#each path}} … {{/each}}        inside: {{this}}, {{this.field}}, {{@index}}, {{@number}} (1-based)
 *   {{! comment }}
 * Block tags alone on a line remove that whole line, so templates can be laid out readably.
 * No HTML escaping: output is prompt text, not markup.
 */

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

type Node =
  | { t: "text"; v: string }
  | { t: "var"; path: string }
  | { t: "if"; path: string; then: Node[]; else: Node[] }
  | { t: "each"; path: string; body: Node[] };

type Tag =
  | { k: "var"; path: string }
  | { k: "if" | "each"; path: string }
  | { k: "else" }
  | { k: "/if" | "/each" }
  | { k: "comment" };

const TAG = /\{\{\s*([#/!]?)\s*([^}]*?)\s*\}\}/g;
const PATH = /^(?:@index|@number|this(?:\.[A-Za-z_][\w]*)*|[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)$/;

function classify(sigil: string, body: string): Tag {
  if (sigil === "!") return { k: "comment" };
  if (sigil === "/") {
    if (body === "if" || body === "each") return { k: `/${body}` };
    throw new TemplateError(`Unknown closing tag {{/${body}}}`);
  }
  if (sigil === "#") {
    const [kw, path = "", ...rest] = body.split(/\s+/);
    if ((kw === "if" || kw === "each") && PATH.test(path) && rest.length === 0) {
      return { k: kw, path };
    }
    throw new TemplateError(`Invalid block tag {{#${body}}}`);
  }
  if (body === "else") return { k: "else" };
  if (!PATH.test(body)) throw new TemplateError(`Invalid expression {{${body}}}`);
  return { k: "var", path: body };
}

/** Split into text and tags, removing the line around standalone block tags. */
function tokenize(tpl: string): (string | Tag)[] {
  const out: (string | Tag)[] = [];
  let pos = 0;
  for (const m of tpl.matchAll(TAG)) {
    const tag = classify(m[1] ?? "", m[2] ?? "");
    let before = tpl.slice(pos, m.index);
    let end = m.index + m[0].length;
    if (tag.k !== "var") {
      // Standalone: only whitespace between the line start and the tag (with no other tag on
      // the line, hence lineStart ≥ pos), and only whitespace after it up to the line end.
      const lineStart = tpl.lastIndexOf("\n", m.index - 1) + 1;
      const restOfLine = /^[ \t]*(\r?\n|$)/.exec(tpl.slice(end));
      if (restOfLine && lineStart >= pos && /^[ \t]*$/.test(tpl.slice(lineStart, m.index))) {
        before = tpl.slice(pos, lineStart);
        end += restOfLine[0].length;
      }
    }
    if (before) out.push(before);
    out.push(tag);
    pos = end;
  }
  if (pos < tpl.length) out.push(tpl.slice(pos));
  return out;
}

function parse(tokens: (string | Tag)[]): Node[] {
  let i = 0;
  const block = (closer: "/if" | "/each" | null): { nodes: Node[]; elseNodes?: Node[] } => {
    let nodes: Node[] = [];
    let elseNodes: Node[] | undefined;
    while (i < tokens.length) {
      const tok = tokens[i++]!;
      if (typeof tok === "string") {
        nodes.push({ t: "text", v: tok });
        continue;
      }
      switch (tok.k) {
        case "comment":
          break;
        case "var":
          nodes.push({ t: "var", path: tok.path });
          break;
        case "if": {
          const inner = block("/if");
          nodes.push({ t: "if", path: tok.path, then: inner.nodes, else: inner.elseNodes ?? [] });
          break;
        }
        case "each": {
          const inner = block("/each");
          if (inner.elseNodes)
            throw new TemplateError("{{else}} is not supported inside {{#each}}");
          nodes.push({ t: "each", path: tok.path, body: inner.nodes });
          break;
        }
        case "else":
          if (closer !== "/if" || elseNodes) throw new TemplateError("Unexpected {{else}}");
          elseNodes = nodes;
          nodes = [];
          break;
        case "/if":
        case "/each":
          if (tok.k !== closer) throw new TemplateError(`Unexpected {{${tok.k}}}`);
          return elseNodes ? { nodes: elseNodes, elseNodes: nodes } : { nodes };
      }
    }
    if (closer) throw new TemplateError(`Missing {{${closer}}}`);
    return { nodes };
  };
  return block(null).nodes;
}

interface Frame {
  vars: Record<string, unknown>;
  item?: unknown;
  index?: number;
}

const MISSING = Symbol("missing");

function lookup(path: string, frames: Frame[]): unknown {
  const top = frames[frames.length - 1]!;
  if (path === "@index" || path === "@number") {
    if (top.index === undefined) throw new TemplateError(`{{${path}}} used outside {{#each}}`);
    return path === "@index" ? top.index : top.index + 1;
  }
  const [head, ...rest] = path.split(".");
  let value: unknown = MISSING;
  if (head === "this") {
    if (!("item" in top)) throw new TemplateError("{{this}} used outside {{#each}}");
    value = top.item;
  } else {
    for (let f = frames.length - 1; f >= 0; f--) {
      const vars = frames[f]!.vars;
      if (Object.hasOwn(vars, head!)) {
        value = vars[head!];
        break;
      }
    }
  }
  for (const key of rest) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return MISSING;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function truthy(v: unknown): boolean {
  if (v === MISSING) return false;
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function renderNodes(nodes: Node[], frames: Frame[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.t) {
      case "text":
        out += node.v;
        break;
      case "var": {
        const v = lookup(node.path, frames);
        if (v === MISSING || v === undefined)
          throw new TemplateError(`Unknown variable "${node.path}"`);
        if (v === null)
          throw new TemplateError(`Variable "${node.path}" is null; guard it with {{#if}}`);
        if (typeof v === "object") {
          throw new TemplateError(
            `Variable "${node.path}" is not a scalar; use {{#each}} or a field`,
          );
        }
        out += String(v);
        break;
      }
      case "if":
        out += renderNodes(truthy(lookup(node.path, frames)) ? node.then : node.else, frames);
        break;
      case "each": {
        const list = lookup(node.path, frames);
        if (list === MISSING || list === undefined || list === null) break;
        if (!Array.isArray(list)) throw new TemplateError(`"${node.path}" is not a list`);
        list.forEach((item, index) => {
          out += renderNodes(node.body, [...frames, { vars: {}, item, index }]);
        });
        break;
      }
    }
  }
  return out;
}

export function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  return renderNodes(parse(tokenize(tpl)), [{ vars }]);
}
