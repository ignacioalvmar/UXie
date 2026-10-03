import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Markdown source of the privacy notice (docs/privacy-notice.md explains the process). */
let cached: string | undefined;
export function privacyNoticeMarkdown(): string {
  cached ??= readFileSync(join(process.cwd(), "content/privacy-notice.md"), "utf8");
  return cached;
}
