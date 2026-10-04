"use client";

import dynamic from "next/dynamic";
import type { ExtractionWarning } from "@uxie/core";
import { Badge, Button } from "./ui";

const PdfPageView = dynamic(() => import("./PdfPageView"), {
  ssr: false,
  loading: () => <p className="p-4 text-ink-muted">Loading the PDF viewer…</p>,
});

const WARNING_LABEL: Record<string, string> = {
  scanned_or_figure_only: "Little or no text (scanned or figure-only)",
  token_count_high: "Long paper",
  extraction_failed: "Extraction problem",
  references_start: "References start",
};

/**
 * FR-6.3 extraction preview: page by page, side by side — PDF page | extracted text | warnings.
 * Pages with warnings are listed first so problems are quick to find.
 */
export function ExtractionPreview({
  versionId,
  pages,
  warnings,
  tokenEstimate,
  page,
  setPage,
}: {
  page: number;
  setPage: (update: number | ((p: number) => number)) => void;
  versionId: string;
  pages: { n: number; text: string }[];
  warnings: ExtractionWarning[];
  tokenEstimate: number | null;
}) {
  const count = pages.length;
  const current = pages.find((p) => p.n === page);
  const pageWarnings = warnings.filter((w) => w.page === page);
  const paperWarnings = warnings.filter((w) => w.page === undefined);
  const flagged = [
    ...new Set(warnings.filter((w) => w.page && w.kind !== "references_start").map((w) => w.page!)),
  ];

  if (!count) return <p className="text-ink-muted">No extracted pages yet.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          {count} pages · about {tokenEstimate?.toLocaleString("en-GB") ?? "?"} tokens
        </span>
        {paperWarnings.map((w, i) => (
          <Badge key={i} tone="warning">
            {w.message}
          </Badge>
        ))}
        {flagged.length > 0 && (
          <span className="flex flex-wrap items-center gap-1">
            Pages with warnings:
            {flagged.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPage(n)}
                className="min-h-11 min-w-11 rounded-field font-bold text-primary hover:bg-panel"
                aria-label={`Show page ${n}`}
              >
                {n}
              </button>
            ))}
          </span>
        )}
      </div>

      <nav aria-label="Pages" className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
        >
          ← Previous
        </Button>
        <label className="flex items-center gap-2">
          <span>Page</span>
          <select
            className="min-h-11 rounded-field border-[1.5px] border-line bg-surface px-2"
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
          >
            {pages.map((p) => (
              <option key={p.n} value={p.n}>
                {p.n}
              </option>
            ))}
          </select>
          <span>of {count}</span>
        </label>
        <Button
          variant="ghost"
          onClick={() => setPage((p) => Math.min(count, p + 1))}
          disabled={page >= count}
        >
          Next →
        </Button>
      </nav>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
        <section aria-label={`PDF page ${page}`}>
          <h3 className="mb-2 font-bold">PDF</h3>
          <PdfPageView fileUrl={`/api/admin/versions/${versionId}/pdf`} page={page} />
        </section>
        <section aria-label={`Extracted text of page ${page}`}>
          <h3 className="mb-2 font-bold">
            Extracted text{" "}
            <span className="font-normal text-ink-muted">
              ({current?.text.length ?? 0} characters)
            </span>
          </h3>
          <pre className="max-h-[70vh] overflow-auto rounded-field border border-line-soft bg-ground p-3 font-sans text-[15px] leading-relaxed whitespace-pre-wrap">
            {current?.text || "(no text)"}
          </pre>
        </section>
        <section aria-label={`Warnings for page ${page}`}>
          <h3 className="mb-2 font-bold">Warnings</h3>
          {pageWarnings.length ? (
            <ul className="flex flex-col gap-2">
              {pageWarnings.map((w, i) => (
                <li key={i} className="rounded-field bg-cite-bg p-2 text-sm">
                  <span className="font-bold">{WARNING_LABEL[w.kind] ?? w.kind}</span>
                  <br />
                  {w.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">None for this page.</p>
          )}
        </section>
      </div>
    </div>
  );
}
