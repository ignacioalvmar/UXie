import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const promptsDir = resolve(repoRoot, "prompts");

/** A fixture slug (`visible-cues`) or a path to a folder with pages.json + guide.yaml. */
export function resolveFixtureDir(target: string): string | null {
  const candidates = [
    isAbsolute(target) ? target : resolve(invocationDir(), target),
    resolve(repoRoot, target),
    resolve(repoRoot, "fixtures/papers", target),
  ];
  return candidates.find((dir) => existsSync(resolve(dir, "pages.json"))) ?? null;
}

/** Where the user ran `pnpm uxie` (pnpm runs the CLI from apps/cli and sets INIT_CWD). */
export const invocationDir = () => process.env.INIT_CWD ?? process.cwd();

/** Resolve a path the user typed, relative to where they invoked the command. */
export const userPath = (p: string) => resolve(invocationDir(), p);
