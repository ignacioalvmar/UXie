import { z } from "zod";
import { ExtractionError, type Extractor, type RawPage } from "./types";

/**
 * Optional extractor (PRD §5, FR-5.5): a `docling-serve` container (OCR, layout analysis) behind
 * the same interface. We ask for the DoclingDocument JSON and rebuild page text in reading order
 * from `body.children`; items docling labels as running headers/footers are dropped.
 */

const Prov = z.object({ page_no: z.number().int().positive() });
const Ref = z.object({ $ref: z.string() });
const Node = z.looseObject({
  self_ref: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  prov: z.array(Prov).optional(),
  children: z.array(Ref).optional(),
  data: z
    .looseObject({ grid: z.array(z.array(z.looseObject({ text: z.string().optional() }))) })
    .optional(),
});
type DoclingNode = z.infer<typeof Node>;

const DoclingDocument = z.looseObject({
  name: z.string().optional(),
  body: Node.optional(),
  texts: z.array(Node).default([]),
  tables: z.array(Node).default([]),
  groups: z.array(Node).default([]),
  pictures: z.array(Node).default([]),
  pages: z.record(z.string(), z.looseObject({ page_no: z.number().int().positive() })).default({}),
});

const ConvertResponse = z.looseObject({
  status: z.string(),
  errors: z.array(z.unknown()).default([]),
  document: z.looseObject({ json_content: DoclingDocument.nullable().optional() }),
});

const SKIP_LABELS = new Set(["page_header", "page_footer"]);

function nodeText(node: DoclingNode): string | undefined {
  if (node.data?.grid) {
    return node.data.grid.map((row) => row.map((c) => c.text ?? "").join(" | ")).join("\n");
  }
  return node.text;
}

/** Page texts from a DoclingDocument; exported for tests. */
export function pagesFromDoclingDocument(doc: z.infer<typeof DoclingDocument>): RawPage[] {
  const collections: Record<string, DoclingNode[]> = {
    texts: doc.texts,
    tables: doc.tables,
    groups: doc.groups,
    pictures: doc.pictures,
  };
  const resolve = (ref: string) => {
    const m = /^#\/(\w+)\/(\d+)$/.exec(ref);
    return m ? collections[m[1]!]?.[Number(m[2])] : undefined;
  };

  const ordered: DoclingNode[] = [];
  const seen = new Set<DoclingNode>();
  const walk = (node: DoclingNode) => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.prov?.length) ordered.push(node);
    for (const child of node.children ?? []) {
      const c = resolve(child.$ref);
      if (c) walk(c);
    }
  };
  if (doc.body) walk(doc.body);
  // Anything not reachable from the body (older outputs) is appended in document order.
  for (const node of [...doc.texts, ...doc.tables])
    if (!seen.has(node) && node.prov?.length) ordered.push(node);

  const declared = Object.values(doc.pages).map((p) => p.page_no);
  const used = ordered.flatMap((n) => n.prov!.map((p) => p.page_no));
  const pageCount = Math.max(0, ...declared, ...used);
  const texts: string[][] = Array.from({ length: pageCount }, () => []);
  for (const node of ordered) {
    if (node.label && SKIP_LABELS.has(node.label)) continue;
    const text = nodeText(node);
    if (text?.trim()) texts[node.prov![0]!.page_no - 1]!.push(text);
  }
  return texts.map((parts, i) => ({ n: i + 1, text: parts.join("\n") }));
}

export function doclingExtractor(opts: {
  url: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): Extractor {
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    name: "docling",
    async extract(pdf, { signal } = {}) {
      const form = new FormData();
      form.append(
        "files",
        new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
        "source.pdf",
      );
      form.append("to_formats", "json");
      form.append("do_ocr", "true");
      form.append("image_export_mode", "placeholder");
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? 600_000);
      let res: Response;
      try {
        res = await doFetch(new URL("/v1/convert/file", opts.url), {
          method: "POST",
          body: form,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (e) {
        throw new ExtractionError("docling", `docling-serve unreachable: ${(e as Error).message}`, {
          cause: e,
        });
      }
      if (!res.ok) {
        throw new ExtractionError("docling", `docling-serve answered HTTP ${res.status}`);
      }
      const parsed = ConvertResponse.safeParse(await res.json().catch(() => null));
      if (!parsed.success) {
        throw new ExtractionError("docling", "docling-serve returned an unexpected response");
      }
      const doc = parsed.data.document.json_content;
      if (parsed.data.status === "failure" || !doc) {
        throw new ExtractionError(
          "docling",
          `docling could not convert the PDF (${parsed.data.status}): ${JSON.stringify(parsed.data.errors).slice(0, 300)}`,
        );
      }
      const pages = pagesFromDoclingDocument(doc);
      if (!pages.length) throw new ExtractionError("docling", "docling found no pages");
      return { pages, meta: { authors: [] } };
    },
  };
}
