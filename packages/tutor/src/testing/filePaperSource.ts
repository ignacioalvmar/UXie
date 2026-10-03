import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PagesFileSchema,
  formatGuideIssues,
  validateGuide,
  type PagesFile,
  type TeachingGuide,
} from "@uxie/core";

export interface FixturePaper {
  slug: string;
  pagesFile: PagesFile;
  guide: TeachingGuide;
}

/**
 * Load `fixtures/papers/<slug>/{pages.json, guide.yaml}` (PRD §13.5). YAML parsing is injected so
 * this package needs no YAML dependency; `guide.json` is accepted as well.
 */
export function loadFixturePaper(
  dir: string,
  opts: { parseYaml: (text: string) => unknown },
): FixturePaper {
  const slug = dir.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? dir;
  const pagesFile = PagesFileSchema.parse(
    JSON.parse(readFileSync(join(dir, "pages.json"), "utf8")),
  );
  const yamlPath = join(dir, "guide.yaml");
  const raw = existsSync(yamlPath)
    ? opts.parseYaml(readFileSync(yamlPath, "utf8"))
    : JSON.parse(readFileSync(join(dir, "guide.json"), "utf8"));
  const result = validateGuide(raw, pagesFile.pages.length);
  if (!result.ok)
    throw new Error(`Invalid guide for ${slug}:\n${formatGuideIssues(result.issues)}`);
  return { slug, pagesFile, guide: result.guide };
}
