import { doclingExtractor } from "./docling";
import type { Extractor, ExtractorName } from "./types";
import { unpdfExtractor } from "./unpdf";

/** The configured extractor (`EXTRACTOR`, `DOCLING_URL`). */
export function createExtractor(
  name: ExtractorName,
  opts: { doclingUrl?: string; fetch?: typeof globalThis.fetch } = {},
): Extractor {
  if (name === "unpdf") return unpdfExtractor();
  if (!opts.doclingUrl) throw new Error("EXTRACTOR=docling needs DOCLING_URL");
  return doclingExtractor({ url: opts.doclingUrl, fetch: opts.fetch });
}
