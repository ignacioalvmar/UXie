"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHARACTERS, type CharacterId } from "@uxie/character";
import type { WorkspaceDto } from "../../lib/views";
import { ChatPane } from "../chat/ChatPane";
import { ArrowLeftIcon, BookIcon, ChatIcon, ChevronLeftIcon, ColumnsIcon } from "../icons";
import type { ReaderController } from "../pdf/PdfReader";

// pdf.js needs the browser (react-pdf README: skip SSR in Next.js).
const PdfReader = dynamic(() => import("../pdf/PdfReader"), {
  ssr: false,
  loading: () => <p className="p-8 text-center text-ink-muted">Loading the reader…</p>,
});

type View = "read" | "chat" | "both";
const VIEW_KEY = "uxie.workspace.view";
const DESKTOP = "(min-width: 1024px)";

function storedView(): View {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return v === "read" || v === "chat" || v === "both" ? v : "both";
  } catch {
    return "both";
  }
}

/**
 * The workspace (FR-3.1, docs/design/workspace-chat/HANDOFF.md): reader and chat side by side
 * on ≥ 1024 px with a Read / Chat / Both switcher (persisted per browser), Read / Chat tabs
 * below. Both panes stay mounted so reading position and the chat survive switching.
 */
export function Workspace({ data, character }: { data: WorkspaceDto; character: CharacterId }) {
  const [view, setView] = useState<View>("both");
  const [tab, setTab] = useState<"read" | "chat">(data.conversation ? "chat" : "read");
  const [citeReturn, setCiteReturn] = useState(false);
  const reader = useRef<ReaderController | null>(null);

  useEffect(() => setView(storedView()), []);
  const chooseView = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private mode or blocked storage: the choice lasts for this page only.
    }
  };

  const showReader = useCallback(
    (then: () => void) => {
      const desktop = window.matchMedia(DESKTOP).matches;
      if (desktop && view === "chat") chooseView("both");
      if (!desktop) setTab("read");
      // Let the pane become visible before scrolling inside it.
      requestAnimationFrame(() => requestAnimationFrame(then));
    },
    [view],
  );

  const onCite = useCallback(
    (page: number) => {
      if (!window.matchMedia(DESKTOP).matches) setCiteReturn(true);
      showReader(() => reader.current?.jumpTo(page, { cite: true }));
    },
    [showReader],
  );
  const onKeepReading = useCallback(() => showReader(() => reader.current?.focus()), [showReader]);

  const { paper, module, version } = data;
  const characterName = CHARACTERS[character].name;
  const eyebrow = [
    module.number ? `Module ${module.number}` : null,
    module.title,
    data.paperNumber ? `Paper ${data.paperNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const base = `/api/papers/${paper.slug}/versions/${version.id}`;

  const readerVisible = `${tab === "read" ? "flex" : "hidden"} ${view === "chat" ? "lg:hidden" : "lg:flex"}`;
  const chatVisible = `${tab === "chat" ? "flex" : "hidden"} ${view === "read" ? "lg:hidden" : "lg:flex"}`;
  const chatWidth =
    view === "both" ? "lg:max-w-[620px] lg:flex-[0_1_620px] lg:border-l-[1.5px]" : "lg:flex-1";

  const segBtn = (active: boolean) =>
    `inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-3.5 font-bold ${
      active ? "bg-surface text-ink shadow-[0_1px_3px_rgb(31_26_51/0.18)]" : "text-ink-muted"
    }`;

  return (
    <div
      className="force-light flex h-dvh min-h-[560px] flex-col bg-ground text-ink lg:min-h-[720px]"
      style={{ colorScheme: "light" }}
    >
      <nav aria-label="Skip links" className="contents">
        <a
          href="#chat-pane"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-field focus:bg-primary focus:px-4 focus:py-3 focus:font-bold focus:text-on-primary"
        >
          Skip to chat
        </a>
        <a
          href="#paper-pane"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-field focus:bg-primary focus:px-4 focus:py-3 focus:font-bold focus:text-on-primary"
        >
          Skip to paper
        </a>
      </nav>

      {/* Desktop top bar */}
      <header className="hidden items-center gap-4 border-b-[1.5px] border-line-soft bg-surface px-6 py-2.5 lg:flex">
        <Link
          href="/"
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-field bg-panel px-3.5 font-bold text-primary-hover"
        >
          <ArrowLeftIcon size={18} />
          Library
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-ink-muted">{eyebrow}</span>
          <h1 className="truncate font-display text-xl font-bold" title={paper.title}>
            {paper.title}
            {!version.isCurrent && (
              <span className="ml-2 text-sm font-normal text-ink-muted">
                (version {version.versionNo})
              </span>
            )}
          </h1>
        </div>
        <div
          role="group"
          aria-label="View"
          className="flex shrink-0 gap-1 rounded-field bg-ground p-1"
        >
          <button
            type="button"
            aria-pressed={view === "read"}
            onClick={() => chooseView("read")}
            className={segBtn(view === "read")}
          >
            <BookIcon size={18} /> Read
          </button>
          <button
            type="button"
            aria-pressed={view === "chat"}
            onClick={() => chooseView("chat")}
            className={segBtn(view === "chat")}
          >
            <ChatIcon size={18} /> Chat
          </button>
          <button
            type="button"
            aria-pressed={view === "both"}
            onClick={() => chooseView("both")}
            className={segBtn(view === "both")}
          >
            <ColumnsIcon size={18} /> Both
          </button>
        </div>
      </header>

      {/* Mobile header with Read / Chat tabs */}
      <header className="flex flex-col gap-3 rounded-b-[24px] bg-panel px-4 pb-3 pt-2 lg:hidden">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            aria-label="Back to library"
            className="-ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-field text-ink hover:bg-surface"
          >
            <ChevronLeftIcon size={24} />
          </Link>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] text-ink-muted">
              {[
                module.number ? `Module ${module.number}` : null,
                data.paperNumber ? `Paper ${data.paperNumber}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <h1 className="truncate font-display text-lg font-bold" title={paper.title}>
              {paper.title}
            </h1>
          </div>
        </div>
        <div
          role="tablist"
          aria-label="Workspace"
          className="flex gap-1 rounded-field bg-surface p-1"
        >
          {(["read", "chat"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              id={`ws-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={t === "read" ? "paper-pane" : "chat-pane"}
              onClick={() => setTab(t)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  const next = t === "read" ? "chat" : "read";
                  setTab(next);
                  document.getElementById(`ws-tab-${next}`)?.focus();
                }
              }}
              tabIndex={tab === t ? 0 : -1}
              className={`min-h-11 flex-1 rounded-[10px] font-bold ${tab === t ? "bg-primary text-on-primary" : "text-primary-hover"}`}
            >
              {t === "read" ? "Read" : "Chat"}
            </button>
          ))}
        </div>
      </header>

      <main id="main" className="flex min-h-0 flex-1">
        <section
          id="paper-pane"
          aria-label="Paper"
          className={`${readerVisible} relative min-w-0 flex-1 flex-col`}
        >
          <PdfReader
            fileUrl={`${base}/pdf`}
            pagesUrl={`${base}/pages`}
            pageCount={version.pageCount}
            warnings={version.warnings}
            controller={reader}
          />
          {citeReturn && tab === "read" && (
            <button
              type="button"
              onClick={() => {
                setTab("chat");
                setCiteReturn(false);
              }}
              className="absolute bottom-5 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-pill bg-ink px-4 font-bold text-on-primary shadow-lg lg:hidden"
            >
              <ArrowLeftIcon size={18} />
              Back to chat
            </button>
          )}
        </section>
        <section
          id="chat-pane"
          aria-label={`Conversation with ${characterName}`}
          className={`${chatVisible} min-w-0 flex-1 flex-col border-line-soft ${chatWidth}`}
        >
          <ChatPane
            paperSlug={paper.slug}
            character={character}
            initialConversation={data.conversation}
            starterQuestions={data.starterQuestions}
            objectives={data.objectives}
            chatOpen={data.chatOpen}
            modes={data.modes}
            projectDescription={data.projectDescription}
            superseded={!!data.conversation && !version.isCurrent && paper.status === "published"}
            onCite={onCite}
            onKeepReading={onKeepReading}
          />
        </section>
      </main>
    </div>
  );
}
