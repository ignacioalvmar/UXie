/** One PDF page as the extractor returns it: raw lines, before normalization (FR-5.2). */
export interface RawPage {
  n: number;
  text: string;
}

/** Document metadata the PDF itself declares; used to prefill the paper title and authors. */
export interface PdfMeta {
  title?: string;
  authors: string[];
  year?: number;
}

export interface Extraction {
  pages: RawPage[];
  meta: PdfMeta;
}

export type ExtractorName = "unpdf" | "docling";

/** Text extraction behind one interface, so the worker can switch with `EXTRACTOR` (PRD §5). */
export interface Extractor {
  readonly name: ExtractorName;
  extract(pdf: Uint8Array, opts?: { signal?: AbortSignal }): Promise<Extraction>;
}

/** The PDF could not be read at all (FR-5.5); the version becomes `failed`. */
export class ExtractionError extends Error {
  constructor(
    public readonly extractor: ExtractorName,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ExtractionError";
  }
}
