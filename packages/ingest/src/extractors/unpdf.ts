import { extractTextItems, getDocumentProxy, getMeta } from "unpdf";
import { ExtractionError, type Extraction, type Extractor, type PdfMeta } from "./types";

type TextItem = Awaited<ReturnType<typeof extractTextItems>>["items"][number][number];

/**
 * Rebuild reading lines from positioned text items. pdf.js marks most line ends with `hasEOL`;
 * a jump in the baseline also starts a new line, and a jump of about two lines or more becomes a
 * blank line (paragraph break). Items on the same line are joined with a space when there is a
 * visible gap between them.
 */
export function itemsToText(items: readonly TextItem[]): string {
  let out = "";
  let prev: TextItem | undefined;
  for (const item of items) {
    if (item.str) {
      if (prev) {
        const size = Math.min(prev.fontSize, item.fontSize) || 10;
        const jump = Math.abs(item.y - prev.y);
        if (jump > size * 0.5) {
          if (!out.endsWith("\n")) out += "\n";
          if (jump > size * 2 && !out.endsWith("\n\n")) out += "\n";
        } else if (!out.endsWith("\n")) {
          const gap = item.x - (prev.x + prev.width);
          if (gap > item.fontSize * 0.15 && !/\s$/.test(out) && !/^\s/.test(item.str)) out += " ";
        }
      }
      out += item.str;
      prev = item;
    }
    if (item.hasEOL && !out.endsWith("\n")) out += "\n";
  }
  return out;
}

/**
 * Title and authors from the PDF info dictionary. CreationDate is the file's date, not the
 * publication year, so no year is derived.
 */
export function metaFromInfo(info: Record<string, unknown>): PdfMeta {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const title = str(info.Title);
  const author = str(info.Author);
  return {
    ...(title && !/^untitled|\.(pdf|docx?|tex)$/i.test(title) ? { title } : {}),
    authors: author
      ? author
          .split(/\s*(?:;|,(?=\s*\S+\s+\S)|\band\b|&)\s*/)
          .map((a) => a.trim())
          .filter(Boolean)
      : [],
  };
}

/** Default extractor (PRD §5): pdf.js text per page via `unpdf`, no OCR. */
export function unpdfExtractor(): Extractor {
  return {
    name: "unpdf",
    async extract(pdf) {
      let doc;
      try {
        // pdf.js may detach the buffer it is given; keep the caller's bytes intact.
        doc = await getDocumentProxy(new Uint8Array(pdf));
      } catch (e) {
        throw new ExtractionError("unpdf", `Not a readable PDF: ${(e as Error).message}`, {
          cause: e,
        });
      }
      try {
        const { items } = await extractTextItems(doc);
        const meta = await getMeta(doc)
          .then((m) => metaFromInfo(m.info))
          .catch(() => ({ authors: [] }));
        const result: Extraction = {
          pages: items.map((pageItems, i) => ({ n: i + 1, text: itemsToText(pageItems) })),
          meta,
        };
        return result;
      } catch (e) {
        throw new ExtractionError("unpdf", `Text extraction failed: ${(e as Error).message}`, {
          cause: e,
        });
      } finally {
        // Free the document and its worker; the Render worker ingests many PDFs per process.
        await doc.loadingTask.destroy();
      }
    },
  };
}
