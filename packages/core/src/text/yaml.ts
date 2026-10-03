/**
 * Minimal deterministic YAML emitter for prompts (the `<teaching_guide>` block, PRD §8.4).
 * Strings are always emitted as JSON strings, which are valid double-quoted YAML scalars, so no
 * quoting rules can be got wrong. Output depends only on the value (key order is preserved), which
 * keeps the cached prompt prefix byte-stable. Parsing YAML happens outside core (the `yaml` package).
 */

const PLAIN_KEY = /^[A-Za-z_][\w-]*$/;

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new TypeError(`toYaml: unsupported value of type ${typeof v}`);
}

const key = (k: string) => (PLAIN_KEY.test(k) ? k : JSON.stringify(k));
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function emit(v: unknown, indent: string): string[] {
  if (Array.isArray(v)) {
    if (v.length === 0) return ["[]"];
    return v.flatMap((item) => {
      if (isObject(item) || Array.isArray(item)) {
        const [first, ...rest] = emit(item, `${indent}  `);
        return [`${indent}- ${first!.trimStart()}`, ...rest];
      }
      return [`${indent}- ${scalar(item)}`];
    });
  }
  if (isObject(v)) {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    if (entries.length === 0) return ["{}"];
    return entries.flatMap(([k, x]) => {
      if ((Array.isArray(x) && x.length) || (isObject(x) && Object.keys(x).length)) {
        return [`${indent}${key(k)}:`, ...emit(x, `${indent}  `)];
      }
      const inline = Array.isArray(x) ? "[]" : isObject(x) ? "{}" : scalar(x);
      return [`${indent}${key(k)}: ${inline}`];
    });
  }
  return [scalar(v)];
}

export function toYaml(value: unknown): string {
  return `${emit(value, "").join("\n")}\n`;
}
