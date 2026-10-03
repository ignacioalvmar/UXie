import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { promptHash, renderTemplate } from "@uxie/core";

/**
 * Prompt files from /prompts (PRD §8.5). Loaded once; keys are paths relative to the prompts
 * directory with forward slashes, e.g. `tutor/modes/apply.md`.
 */
export interface PromptLoader {
  get(name: string): string;
  render(name: string, vars?: Record<string, unknown>): string;
  /** Content hash of the named files, 12 hex chars. */
  hash(names: string[]): string;
}

export class MissingPromptError extends Error {
  constructor(name: string) {
    super(`Prompt file not found: prompts/${name}`);
    this.name = "MissingPromptError";
  }
}

export function createPromptLoader(files: Record<string, string>): PromptLoader {
  const normalized = Object.fromEntries(
    // CRLF checkouts must not change the prompt bytes or the prompt version.
    Object.entries(files).map(([k, v]) => [k.replaceAll("\\", "/"), v.replaceAll("\r\n", "\n")]),
  );
  const get = (name: string) => {
    const content = normalized[name];
    if (content === undefined) throw new MissingPromptError(name);
    return content;
  };
  return {
    get,
    render: (name, vars = {}) => renderTemplate(get(name), vars),
    hash: (names) => promptHash(names.map(get)),
  };
}

/** Read every `.md` file under `dir` (sync; called once at boot). */
export function loadPromptDir(dir: string): PromptLoader {
  const files: Record<string, string> = {};
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) files[relative(dir, full)] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return createPromptLoader(files);
}
