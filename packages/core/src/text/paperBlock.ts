/** Escape an XML-ish attribute value (`<paper title="…">`). */
export const escapeAttr = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/** Neutralise tags that could close our data blocks from inside the paper text (NFR-8). */
export const escapeBlockTags = (s: string) =>
  s.replace(/<(\/?)(paper|page|teaching_guide)\b/gi, "&lt;$1$2");
