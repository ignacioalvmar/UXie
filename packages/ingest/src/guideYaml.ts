import { stringify } from "yaml";
import type { GuideIssue } from "@uxie/core";

/**
 * Human-editable YAML for a guide (CLI `--local`, guide export). An invalid draft gets its
 * validation issues as a comment header, so the instructor sees what to fix (FR-5.4).
 */
export function guideToYaml(
  guide: unknown,
  opts: { issues?: GuideIssue[]; header?: string[] } = {},
): string {
  const lines = [...(opts.header ?? [])];
  if (opts.issues?.length) {
    lines.push("DRAFT DOES NOT VALIDATE. Fix these before approving:");
    for (const i of opts.issues) lines.push(`  - ${i.path}: ${i.message}`);
  }
  const head = lines.map((l) => `# ${l}`.trimEnd()).join("\n");
  const body = stringify(guide ?? {}, { lineWidth: 100 });
  return head ? `${head}\n${body}` : body;
}
