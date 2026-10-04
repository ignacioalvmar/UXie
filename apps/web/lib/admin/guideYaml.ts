import { parseDocument, stringify } from "yaml";
import { validateGuide, type GuideIssue } from "@uxie/core";

/**
 * YAML for the guide editor (FR-6.4). Used in the browser for live validation and on the server
 * before saving, so both report the same issues. Pure: no IO.
 */

export type ParsedGuideYaml =
  { ok: true; value: unknown } | { ok: false; error: string; line: number | null };

export function parseGuideYaml(text: string): ParsedGuideYaml {
  const doc = parseDocument(text, { prettyErrors: true, uniqueKeys: true });
  const err = doc.errors[0];
  if (err) {
    const line = err.linePos?.[0]?.line ?? null;
    return { ok: false, error: err.message.split("\n")[0]!, line };
  }
  return { ok: true, value: doc.toJS({ maxAliasCount: 50 }) };
}

/** Parse + schema + page refs, as the editor's issue list shows them. */
export function checkGuideYaml(
  text: string,
  pageCount: number | null,
): { value: unknown; issues: GuideIssue[]; syntax: boolean } {
  const parsed = parseGuideYaml(text);
  if (!parsed.ok)
    return {
      value: null,
      syntax: true,
      issues: [
        { path: parsed.line ? `line ${parsed.line}` : "(yaml)", message: `YAML: ${parsed.error}` },
      ],
    };
  return {
    value: parsed.value,
    syntax: false,
    issues: validateGuide(parsed.value, pageCount ?? undefined).issues,
  };
}

export function guideToEditorYaml(guide: unknown): string {
  if (!guide || (typeof guide === "object" && !Object.keys(guide).length)) return "";
  return stringify(guide, { lineWidth: 100 });
}
