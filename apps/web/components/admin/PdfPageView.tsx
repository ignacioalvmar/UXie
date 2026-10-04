"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

// Must be set in the module that renders <Document> (react-pdf README).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// Signed URLs live 10 minutes (PRD §9.3): fetch the whole file once, no range requests.
const PDF_OPTIONS = { disableRange: true, disableAutoFetch: true };

/** One page of the version's PDF for the extraction preview (FR-6.3). Loaded client-only. */
export default function PdfPageView({ fileUrl, page }: { fileUrl: string; page: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(420);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.max(200, Math.floor(e!.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className="w-full">
      {failed ? (
        <p className="p-4 text-danger-ink">The PDF could not be loaded.</p>
      ) : (
        <Document
          file={fileUrl}
          options={PDF_OPTIONS}
          onLoadError={() => setFailed(true)}
          loading={<p className="p-4 text-ink-muted">Loading the PDF…</p>}
        >
          <Page
            pageNumber={page}
            width={width}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            className="overflow-hidden rounded-field border border-line-soft"
            loading={<div style={{ height: width * 1.294 }} className="bg-reader-ground" />}
          />
        </Document>
      )}
    </div>
  );
}
