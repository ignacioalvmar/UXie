"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import type { ExtractionWarning } from "@uxie/core";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  InfoIcon,
  SearchIcon,
  TextIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "../icons";

// Must be set in the module that renders <Document> (react-pdf README).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export interface ReaderController {
  /** Scroll to a page; `cite` highlights it as "Cited in chat" for 4 s (FR-3.4). */
  jumpTo(page: number, opts?: { cite?: boolean }): void;
  focus(): void;
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
// Signed URLs expire after 10 minutes (PRD §9.3): fetch the whole file once, no range requests.
const PDF_OPTIONS = { disableRange: true, disableAutoFetch: true };
const MAX_PAGE_WIDTH = 680;
const HIGHLIGHT_MS = 4000;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The reader pane (FR-3.3, workspace handoff §3): pdf.js pages with a text layer, page
 * navigation, zoom, in-document search over the extracted text, the "Accessible text" view and
 * the per-page extraction warnings banner. Pages render lazily near the viewport.
 */
export default function PdfReader({
  fileUrl,
  pagesUrl,
  pageCount,
  warnings,
  controller,
  onPageChange,
}: {
  fileUrl: string;
  pagesUrl: string;
  pageCount: number;
  warnings: ExtractionWarning[];
  controller: RefObject<ReaderController | null>;
  onPageChange?: (page: number) => void;
}) {
  const [numPages, setNumPages] = useState(pageCount);
  const [current, setCurrent] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(MAX_PAGE_WIDTH);
  const [aspect, setAspect] = useState(1.294); // A4/Letter until the first page reports
  const [near, setNear] = useState<Set<number>>(() => new Set([1, 2]));
  const [accessible, setAccessible] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [pagesText, setPagesText] = useState<{ n: number; text: string }[] | null>(null);
  const [textError, setTextError] = useState(false);
  const [cited, setCited] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const textPane = useRef<HTMLDivElement>(null);
  const holdHighlight = useRef(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  // Page width follows the pane (max 680 px), times the zoom.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry!.contentRect.width - 32;
      setWidth(Math.max(240, Math.min(MAX_PAGE_WIDTH, w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pageWidth = Math.round(width * zoom);

  // Current page and lazy rendering from visibility.
  useEffect(() => {
    if (accessible) return;
    const root = scroller.current;
    if (!root) return;
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page);
          ratios.set(n, e.isIntersecting ? e.intersectionRatio : 0);
        }
        const visible = [...ratios].filter(([, r]) => r > 0).map(([n]) => n);
        if (visible.length) {
          const best = [...ratios].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
          setCurrent(best);
          setNear((prev) => {
            const next = new Set(prev);
            for (const n of visible) for (const d of [-1, 0, 1, 2]) next.add(n + d);
            return next.size === prev.size ? prev : next;
          });
        }
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of pageEls.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [numPages, accessible, loaded]);

  useEffect(() => onPageChange?.(current), [current, onPageChange]);

  const loadText = useCallback(async () => {
    if (pagesText) return pagesText;
    try {
      const res = await fetch(pagesUrl);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { pages: { n: number; text: string }[] };
      setPagesText(body.pages);
      return body.pages;
    } catch {
      setTextError(true);
      return null;
    }
  }, [pagesText, pagesUrl]);

  useEffect(() => {
    if (accessible) void loadText();
  }, [accessible, loadText]);

  // The text view shows one page: start each page at its top.
  useEffect(() => {
    if (accessible) scroller.current?.scrollTo({ top: 0 });
  }, [accessible, current]);

  const scrollToPage = useCallback(
    (n: number, focus = false) => {
      const page = Math.min(Math.max(1, n), numPages || 1);
      setCurrent(page);
      setNear((prev) => new Set([...prev, page - 1, page, page + 1]));
      if (accessible) {
        if (focus) textPane.current?.focus();
        return;
      }
      const el = pageEls.current.get(page);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      if (focus) el?.focus({ preventScroll: true });
    },
    [accessible, numPages],
  );

  useEffect(() => {
    controller.current = {
      jumpTo(page, opts) {
        scrollToPage(page, true);
        if (opts?.cite) {
          setCited(page);
          if (highlightTimer.current) clearTimeout(highlightTimer.current);
          const fade = () => {
            if (holdHighlight.current) highlightTimer.current = setTimeout(fade, 500);
            else setCited(null);
          };
          highlightTimer.current = setTimeout(fade, HIGHLIGHT_MS);
        }
      },
      focus() {
        (accessible ? textPane.current : pageEls.current.get(current))?.focus();
      },
    };
  }, [controller, scrollToPage, accessible, current]);

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  // Search over the extracted text (it is what the text layer shows, minus layout).
  const matches = useMemo(() => {
    const q = submitted.trim().toLowerCase();
    if (!q || !pagesText) return [];
    return pagesText.filter((p) => p.text.toLowerCase().includes(q)).map((p) => p.n);
  }, [submitted, pagesText]);

  const runSearch = async () => {
    const text = await loadText();
    setSubmitted(query);
    const q = query.trim().toLowerCase();
    const first = text?.find((p) => p.text.toLowerCase().includes(q));
    if (q && first) scrollToPage(first.n);
  };
  const stepMatch = (d: 1 | -1) => {
    if (!matches.length) return;
    const after =
      d === 1 ? matches.find((n) => n > current) : [...matches].reverse().find((n) => n < current);
    scrollToPage(after ?? (d === 1 ? matches[0]! : matches.at(-1)!));
  };

  const markRe = useMemo(() => {
    const q = submitted.trim();
    return q ? new RegExp(escapeRegExp(q), "gi") : null;
  }, [submitted]);
  const textRenderer = useCallback(
    ({ str }: { str: string }) => {
      const safe = escapeHtml(str);
      return markRe ? safe.replace(markRe, (m) => `<mark>${m}</mark>`) : safe;
    },
    [markRe],
  );

  const pageWarnings = warnings.filter((w) => w.page === current && w.kind !== "references_start");
  const iconBtn =
    "inline-flex size-11 items-center justify-center rounded-field text-ink hover:bg-panel disabled:text-line disabled:hover:bg-transparent";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="toolbar"
        aria-label="Paper tools"
        className="flex flex-wrap items-center gap-1 border-b-[1.5px] border-line-soft bg-surface px-2 py-1.5"
      >
        <button
          type="button"
          className={iconBtn}
          aria-label="Previous page"
          disabled={current <= 1}
          onClick={() => scrollToPage(current - 1)}
        >
          <ChevronLeftIcon size={22} />
        </button>
        <span className="min-w-[92px] text-center text-[15px] font-bold" aria-live="polite">
          Page {current} of {numPages}
        </span>
        <button
          type="button"
          className={iconBtn}
          aria-label="Next page"
          disabled={current >= numPages}
          onClick={() => scrollToPage(current + 1)}
        >
          <ChevronRightIcon size={22} />
        </button>
        <span aria-hidden="true" className="mx-1 h-6 w-px bg-line-soft" />
        <button
          type="button"
          className={iconBtn}
          aria-label="Zoom out"
          disabled={accessible || zoom <= ZOOMS[0]!}
          onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]!)}
        >
          <ZoomOutIcon size={22} />
        </button>
        <span
          className="w-12 text-center text-[15px]"
          aria-label={`Zoom ${Math.round(zoom * 100)} percent`}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className={iconBtn}
          aria-label="Zoom in"
          disabled={accessible || zoom >= ZOOMS.at(-1)!}
          onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]!)}
        >
          <ZoomInIcon size={22} />
        </button>
        <button
          type="button"
          className={iconBtn}
          aria-label="Search in the paper"
          aria-expanded={searchOpen}
          onClick={() => {
            setSearchOpen((o) => !o);
            setTimeout(() => searchInput.current?.focus(), 0);
          }}
        >
          <SearchIcon size={22} />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={accessible}
          onClick={() => setAccessible((a) => !a)}
          className={`inline-flex min-h-11 items-center gap-2 rounded-field border-[1.5px] px-3 font-bold ${
            accessible ? "border-primary bg-panel text-primary-hover" : "border-line text-ink"
          }`}
        >
          <TextIcon size={18} />
          Accessible text
        </button>
      </div>

      {searchOpen && (
        <form
          role="search"
          className="flex flex-wrap items-center gap-2 border-b-[1.5px] border-line-soft bg-surface px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <label htmlFor="pdf-search" className="sr-only">
            Search in the paper
          </label>
          <input
            ref={searchInput}
            id="pdf-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                setSubmitted("");
              }
            }}
            placeholder="Find a word or phrase"
            className="h-11 min-w-0 flex-1 rounded-field border-[1.5px] border-line px-3"
          />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-field bg-primary px-4 font-bold text-on-primary"
          >
            Find
          </button>
          <button
            type="button"
            className={iconBtn}
            aria-label="Previous match"
            disabled={!matches.length}
            onClick={() => stepMatch(-1)}
          >
            <ChevronLeftIcon size={20} />
          </button>
          <button
            type="button"
            className={iconBtn}
            aria-label="Next match"
            disabled={!matches.length}
            onClick={() => stepMatch(1)}
          >
            <ChevronRightIcon size={20} />
          </button>
          <button
            type="button"
            className={iconBtn}
            aria-label="Close search"
            onClick={() => {
              setSearchOpen(false);
              setSubmitted("");
            }}
          >
            <CloseIcon size={20} />
          </button>
          <p role="status" className="w-full text-sm text-ink-muted">
            {textError
              ? "Search is unavailable right now."
              : submitted.trim()
                ? matches.length
                  ? `Found on ${matches.length === 1 ? "page" : "pages"} ${matches.join(", ")}.`
                  : "No matches in this paper."
                : ""}
          </p>
        </form>
      )}

      {pageWarnings.length > 0 && (
        <div
          role="note"
          className="flex items-start gap-2.5 bg-panel px-4 py-3 text-[15px] text-ink"
        >
          <InfoIcon size={20} className="mt-0.5 shrink-0 text-primary-hover" />
          <div>
            {pageWarnings.map((w, i) => (
              <p key={i}>{w.message}</p>
            ))}
          </div>
        </div>
      )}

      {/* Focusable so keyboard users can scroll the pages with the arrow keys (WCAG 2.1.1). */}
      <div
        ref={scroller}
        role="group"
        aria-label="Paper pages"
        tabIndex={0}
        className="uxie-pdf min-h-0 flex-1 overflow-auto bg-reader-ground px-4 py-7"
      >
        {accessible ? (
          <div
            ref={textPane}
            role="group"
            tabIndex={-1}
            aria-label={`Accessible text, page ${current}`}
            className="mx-auto flex max-w-[680px] flex-col gap-3 rounded-[6px] bg-surface p-7 shadow-sm"
          >
            <h2 className="font-display text-xl font-bold">Page {current}: extracted text</h2>
            <p className="text-sm text-ink-muted">
              Text extracted from the PDF. Figures are not described, and layout such as columns and
              tables may be lost.
            </p>
            {textError ? (
              <p role="alert">The text could not be loaded. Please try again.</p>
            ) : !pagesText ? (
              <p>Loading…</p>
            ) : (
              <div className="whitespace-pre-wrap text-[17px] leading-[1.6]">
                {pagesText.find((p) => p.n === current)?.text ||
                  "No text was extracted from this page."}
              </div>
            )}
          </div>
        ) : loadError ? (
          <div role="alert" className="mx-auto max-w-[680px] rounded-[6px] bg-surface p-7">
            <p className="font-bold">The PDF could not be loaded.</p>
            <p className="text-ink-muted">
              You can still read the extracted text: turn on “Accessible text” above.
            </p>
          </div>
        ) : (
          <Document
            file={fileUrl}
            options={PDF_OPTIONS}
            onLoadSuccess={(doc) => {
              setNumPages(doc.numPages);
              setLoaded(true);
            }}
            onLoadError={() => setLoadError(true)}
            loading={<p className="text-center text-ink-muted">Loading the paper…</p>}
            className="flex flex-col items-center gap-6"
          >
            {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <div
                key={n}
                ref={(el) => {
                  if (el) pageEls.current.set(n, el);
                  else pageEls.current.delete(n);
                }}
                data-page={n}
                role="group"
                tabIndex={-1}
                aria-label={`Page ${n}`}
                onMouseEnter={() => (holdHighlight.current = cited === n)}
                onMouseLeave={() => (holdHighlight.current = false)}
                onFocus={() => (holdHighlight.current = cited === n)}
                onBlur={() => (holdHighlight.current = false)}
                style={{ width: pageWidth, minHeight: Math.round(pageWidth * aspect) }}
                className={`relative scroll-mt-4 overflow-hidden rounded-[6px] bg-surface shadow-[0_2px_12px_rgb(31_26_51/0.12)] outline-none transition-[outline-color] ${
                  cited === n ? "outline-2 outline-offset-2 outline-cite-line" : ""
                }`}
              >
                {near.has(n) && (
                  <Page
                    pageNumber={n}
                    width={pageWidth}
                    customTextRenderer={textRenderer}
                    renderAnnotationLayer
                    onLoadSuccess={(p) => n === 1 && setAspect(p.originalHeight / p.originalWidth)}
                    loading=""
                  />
                )}
                {cited === n && (
                  <>
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 bg-cite-bg/60 mix-blend-multiply"
                    />
                    <span className="absolute right-3 top-3 rounded-[6px] bg-ink px-2.5 py-1 text-[13px] font-bold text-on-primary">
                      Cited in chat · p. {n}
                    </span>
                  </>
                )}
              </div>
            ))}
          </Document>
        )}
      </div>
    </div>
  );
}
