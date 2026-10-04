"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CHARACTERS, UxieCharacter, type CharacterId } from "@uxie/character";
import { MODE_LABEL, plural, relativeTime } from "../../lib/format";
import {
  searchConversations,
  searchLibrary,
  type LibraryDto,
  type LibraryModuleDto,
  type LibraryPaperDto,
  type RecentConversationDto,
} from "../../lib/library";
import { ArrowRightIcon, BookIcon, CloseIcon, SearchIcon } from "../icons";
import {
  NumberBadge,
  outlineButton,
  PaperAction,
  primaryButton,
  Segments,
  segmentOf,
  StatusChip,
} from "./parts";

/**
 * The library (`/`, docs/design/library/HANDOFF.md): resume, go in order, find. Search filters
 * the payload on the client and mirrors the query in `?q=` (replace, not push).
 */
export function LibraryView({
  data,
  character,
  initialQuery,
}: {
  data: LibraryDto;
  character: CharacterId;
  initialQuery: string;
}) {
  const name = CHARACTERS[character].name;
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const searching = query.trim().length > 0;

  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 150);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  }, [query]);

  const hits = useMemo(() => searchLibrary(data.modules, query), [data.modules, query]);
  const convHits = useMemo(
    () => searchConversations(data.conversations, query),
    [data.conversations, query],
  );
  const paperCount = data.modules.reduce((n, m) => n + m.papers.length, 0);

  const greeting = searching
    ? "I'm searching titles, authors, key concepts and our past conversations."
    : data.continueCard
      ? `Welcome back. Shall we pick up “${data.continueCard.paper.title}” where we stopped?`
      : "Welcome back. Which paper are we questioning today?";

  const clear = () => {
    setInput("");
    setQuery("");
  };

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-[1_1_420px] flex-col gap-2">
          <h1 className="font-display text-[32px] font-bold leading-[1.05] tracking-[-0.02em] lg:text-5xl">
            Your library
          </h1>
          {paperCount > 0 && (
            <p className="text-ink-muted lg:hidden">
              {plural(data.modules.length, "module")}, {plural(paperCount, "paper")}.
            </p>
          )}
        </div>
        <div className="hidden flex-[0_1_470px] items-end gap-3 lg:flex">
          <UxieCharacter character={character} size={99} decorative />
          <p className="uxie-bubble mb-3.5 px-4 py-3 text-[17px] leading-[1.4]">{greeting}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="lib-search" className="font-bold">
          Search papers and your conversations
        </label>
        <div className="relative">
          <SearchIcon
            size={22}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-subtle"
          />
          <input
            id="lib-search"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") clear();
            }}
            placeholder="Title, author or concept, for example “feedback”"
            className="h-[50px] w-full rounded-field border-[1.5px] border-line bg-surface pl-[52px] pr-[60px] text-lg text-ink placeholder:text-placeholder lg:h-14 [&::-webkit-search-cancel-button]:hidden"
          />
          {input && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clear}
              className="absolute right-1.5 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-field text-ink-muted hover:bg-panel"
            >
              <CloseIcon size={20} />
            </button>
          )}
        </div>
      </div>

      {!data.modules.length && (
        <p className="text-ink-muted">No papers are published yet. Check back soon.</p>
      )}

      {!searching && (data.continueCard || data.next) && (
        <div className="flex flex-wrap gap-5">
          {data.continueCard && <ContinueCard card={data.continueCard} character={character} />}
          {data.next && (
            <article className="hidden min-w-0 flex-[1_1_320px] flex-col gap-3.5 rounded-hero border-[1.5px] border-line-soft bg-surface p-7 lg:flex">
              <p className="text-[15px] font-bold text-primary-hover">Next in order</p>
              <div className="flex items-center gap-2.5">
                <NumberBadge number={data.next.paper.number} size={40} />
                <span className="text-[15px] text-ink-muted">
                  Module {data.next.module.number} · {data.next.module.title}
                </span>
              </div>
              <h2 className="font-display text-[22px] font-bold leading-[1.2]">
                {data.next.paper.title}
              </h2>
              <p className="text-ink-muted">{byline(data.next.paper)}</p>
              <div className="grow" />
              <Link
                href={`/papers/${data.next.paper.slug}`}
                className={`${outlineButton} self-start`}
              >
                <BookIcon size={18} />
                Open paper
              </Link>
              <p className="text-sm text-ink-subtle">
                Opening a paper doesn’t start a conversation. Read first if you like.
              </p>
            </article>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-start gap-10">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-10">
          {searching ? (
            <SearchResults hits={hits} query={query} onBack={clear} character={character} />
          ) : (
            <>
              <ModulesDesktop modules={data.modules} />
              <ModulesMobile modules={data.modules} />
            </>
          )}
        </div>
        <aside aria-labelledby="conv-h" className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="conv-h" className="font-display text-[22px] font-bold">
              {searching ? "Matching conversations" : "Your conversations"}
            </h2>
            <Link
              href="/conversations"
              className="inline-flex min-h-11 items-center text-[15px] font-bold text-primary hover:text-primary-hover"
            >
              See all
            </Link>
          </div>
          {(searching ? convHits : data.recent).length ? (
            <ul className="flex flex-col gap-2.5">
              {(searching ? convHits : data.recent).map((c) => (
                <ConversationCard key={c.conversationId} c={c} name={name} />
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted">
              {searching
                ? "None of your conversations mention that."
                : "No conversations yet. Open a paper and pick a starter question when you're ready."}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

const byline = (p: LibraryPaperDto) =>
  [p.authors.join(", "), p.year ? String(p.year) : null].filter(Boolean).join(" · ");

function ContinueCard({
  card,
  character,
}: {
  card: NonNullable<LibraryDto["continueCard"]>;
  character: CharacterId;
}) {
  const { conversation: c, paper, objectives } = card;
  const demonstrated = objectives.filter((o) => o === "demonstrated").length;
  return (
    <article className="flex min-w-0 flex-[2_1_520px] flex-col gap-[18px] rounded-hero bg-panel p-5 lg:p-7">
      <p className="text-[15px] font-bold text-primary-hover">Continue where you left off</p>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-2xl font-bold leading-[1.1] tracking-[-0.015em] lg:text-[32px]">
          {paper.title}
        </h2>
        <p className="text-ink-muted">
          {byline(paper)} · {c.label}
        </p>
      </div>
      {c.lastTutorQuestion && (
        <div className="flex items-end gap-2.5">
          <UxieCharacter character={character} size={53} decorative />
          <p className="uxie-bubble mb-1.5 border-0 px-4 py-3 text-[17px] leading-[1.4]">
            <span className="font-bold">{CHARACTERS[character].name} asked:</span>{" "}
            {c.lastTutorQuestion}
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Segments items={objectives.map(segmentOf)} onPanel />
          <p className="text-[15px] text-ink-muted" suppressHydrationWarning>
            {demonstrated} of {objectives.length} ideas demonstrated · {MODE_LABEL[c.mode]} mode ·{" "}
            {relativeTime(c.lastMessageAt)}
          </p>
        </div>
        <Link
          href={c.href}
          className={`${primaryButton} h-[52px] w-full px-[22px] text-[17px] sm:w-auto`}
        >
          Continue conversation
          <ArrowRightIcon size={20} />
        </Link>
      </div>
    </article>
  );
}

function ModuleTiles({ modules }: { modules: LibraryModuleDto[] }) {
  return (
    <nav aria-labelledby="modules-h" className="flex flex-col gap-3.5">
      <h2 id="modules-h" className="font-display text-[26px] font-bold tracking-[-0.01em]">
        Work through the modules in order
      </h2>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {modules.map((m) => (
          <li key={m.id} className="flex">
            <a
              href={`#module-${m.number}`}
              className={`flex flex-1 flex-col gap-2 rounded-card border-[1.5px] bg-surface px-[18px] py-4 text-ink hover:bg-ground ${
                m.papers.some((p) => p.isNext) ? "border-primary" : "border-line-soft"
              }`}
            >
              <span className="text-sm font-bold text-primary-hover">Module {m.number}</span>
              <span className="font-display text-xl font-bold">{m.title}</span>
              <Segments items={m.papers.map((p) => segmentOf(p.status))} height={6} stretch />
              <span className="text-sm text-ink-muted">
                {m.discussed} of {plural(m.papers.length, "paper")} discussed
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function PaperRow({ p }: { p: LibraryPaperDto }) {
  return (
    <li
      className={`flex flex-wrap items-center gap-4 rounded-card border-[1.5px] bg-surface px-5 py-4 ${
        p.isNext ? "border-primary" : "border-line-soft"
      }`}
    >
      <NumberBadge number={p.number} />
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1">
        {p.isNext && <NextTag />}
        <Link
          href={`/papers/${p.slug}`}
          className="text-lg font-bold leading-[1.3] text-ink hover:underline"
        >
          {p.title}
        </Link>
        <span className="text-[15px] text-ink-muted">{byline(p)}</span>
      </div>
      <StatusChip
        status={p.status}
        demonstrated={p.objectivesDemonstrated}
        total={p.objectivesTotal}
      />
      <PaperAction status={p.status} slug={p.slug} conversationId={p.conversationId} />
    </li>
  );
}

const NextTag = () => (
  <span className="self-start rounded-[6px] bg-panel px-2 py-0.5 text-[13px] font-bold text-primary-hover">
    Next in order
  </span>
);

function ModuleHeader({ m, headingId }: { m: LibraryModuleDto; headingId: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex max-w-[640px] flex-col gap-1">
        <p className="text-[15px] font-bold text-primary-hover">Module {m.number}</p>
        <h2
          id={headingId}
          className="font-display text-[26px] font-bold tracking-[-0.015em] lg:text-[30px]"
        >
          {m.title}
        </h2>
      </div>
      <span className="text-[15px] text-ink-muted">
        {m.discussed} of {plural(m.papers.length, "paper")} discussed
      </span>
    </div>
  );
}

function ModulesDesktop({ modules }: { modules: LibraryModuleDto[] }) {
  if (!modules.length) return null;
  return (
    <div className="hidden flex-col gap-11 lg:flex">
      <ModuleTiles modules={modules} />
      {modules.map((m) => (
        <section
          key={m.id}
          id={`module-${m.number}`}
          aria-labelledby={`module-h-${m.number}`}
          className="flex scroll-mt-6 flex-col gap-4"
        >
          <ModuleHeader m={m} headingId={`module-h-${m.number}`} />
          <ol className="flex flex-col gap-2.5">
            {m.papers.map((p) => (
              <PaperRow key={p.id} p={p} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** < 1024 px: module tabs, whole-row paper links (library handoff §6). */
function ModulesMobile({ modules }: { modules: LibraryModuleDto[] }) {
  const initial = Math.max(
    0,
    modules.findIndex((m) => m.papers.some((p) => p.isNext)),
  );
  const [selected, setSelected] = useState(initial);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const m = modules[selected];
  if (!m) return null;
  return (
    <section aria-labelledby="mobile-modules-h" className="flex flex-col gap-4 lg:hidden">
      <h2 id="mobile-modules-h" className="font-display text-[22px] font-bold">
        Work through in order
      </h2>
      <div
        role="tablist"
        aria-label="Modules"
        className="flex gap-1 overflow-x-auto rounded-chip bg-panel p-1"
      >
        {modules.map((mod, i) => (
          <button
            key={mod.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            role="tab"
            id={`mtab-${i}`}
            aria-selected={i === selected}
            aria-controls="mtab-panel"
            tabIndex={i === selected ? 0 : -1}
            onClick={() => setSelected(i)}
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!d) return;
              const next = (i + d + modules.length) % modules.length;
              setSelected(next);
              tabs.current[next]?.focus();
            }}
            className={`min-h-11 flex-1 whitespace-nowrap rounded-field px-3 font-bold ${
              i === selected ? "bg-primary text-on-primary" : "text-primary-hover"
            }`}
          >
            Module {mod.number}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="mtab-panel"
        aria-labelledby={`mtab-${selected}`}
        className="flex flex-col gap-3"
      >
        <ModuleHeader m={m} headingId={`mobile-module-h-${m.number}`} />
        <ol className="flex flex-col gap-2.5">
          {m.papers.map((p) => (
            <li key={p.id}>
              <Link
                href={
                  p.conversationId ? `/papers/${p.slug}?c=${p.conversationId}` : `/papers/${p.slug}`
                }
                className={`flex items-start gap-3 rounded-card border-[1.5px] bg-surface p-4 text-ink ${
                  p.isNext ? "border-primary" : "border-line-soft"
                }`}
              >
                <NumberBadge number={p.number} size={40} />
                <span className="flex min-w-0 flex-col items-start gap-1.5">
                  {p.isNext && <NextTag />}
                  <span className="font-bold leading-[1.3]">{p.title}</span>
                  <span className="text-[15px] text-ink-muted">{byline(p)}</span>
                  <StatusChip
                    status={p.status}
                    demonstrated={p.objectivesDemonstrated}
                    total={p.objectivesTotal}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const i = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (i < 0 || !query.trim()) return text;
  const end = i + query.trim().length;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-highlight text-ink">{text.slice(i, end)}</mark>
      {text.slice(end)}
    </>
  );
}

function SearchResults({
  hits,
  query,
  onBack,
  character,
}: {
  hits: ReturnType<typeof searchLibrary>;
  query: string;
  onBack: () => void;
  character: CharacterId;
}) {
  return (
    <section aria-labelledby="results-h" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="results-h" aria-live="polite" className="font-display text-[26px] font-bold">
          {plural(hits.length, "paper")} match{hits.length === 1 ? "es" : ""} “{query.trim()}”
        </h2>
        <button type="button" onClick={onBack} className={outlineButton}>
          Back to all modules
        </button>
      </div>
      {hits.length ? (
        <ol className="flex flex-col gap-2.5">
          {hits.map(({ paper: p, module, matched }) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-4 rounded-card border-[1.5px] border-line-soft bg-surface px-5 py-4"
            >
              <NumberBadge number={p.number} />
              <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1">
                <span className="text-sm font-bold text-primary-hover">
                  Module {module.number} · {module.title} · Paper {p.paperNumber}
                </span>
                <Link
                  href={`/papers/${p.slug}`}
                  className="text-lg font-bold leading-[1.3] text-ink hover:underline"
                >
                  <Highlight text={p.title} query={query} />
                </Link>
                <span className="text-[15px] text-ink-muted">{byline(p)}</span>
                {matched !== "title" && (
                  <span className="text-sm text-ink-subtle">
                    {matched === "author"
                      ? "Matches an author"
                      : matched === "module"
                        ? "Matches the module"
                        : "Matches a key concept in this paper"}
                  </span>
                )}
              </div>
              <StatusChip
                status={p.status}
                demonstrated={p.objectivesDemonstrated}
                total={p.objectivesTotal}
              />
              <PaperAction status={p.status} slug={p.slug} conversationId={p.conversationId} />
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex items-end gap-3">
          <UxieCharacter character={character} state="puzzled" size={80} decorative />
          <p className="uxie-bubble mb-3 px-4 py-3 text-[17px]">
            Nothing in this course matches that yet. Try an author’s surname or a concept, like
            “mapping” or “memory”.
          </p>
        </div>
      )}
    </section>
  );
}

function ConversationCard({ c, name }: { c: RecentConversationDto; name: string }) {
  return (
    <li className="flex flex-col gap-2.5 rounded-card border-[1.5px] border-line-soft bg-surface p-[18px]">
      <div className="flex justify-between gap-2 text-sm text-ink-subtle">
        <span>{c.label}</span>
        <span suppressHydrationWarning>{relativeTime(c.lastMessageAt)}</span>
      </div>
      <Link href={c.href} className="text-[17px] font-bold leading-[1.3] text-ink hover:underline">
        {c.paperTitle}
      </Link>
      {c.lastTutorQuestion && (
        <p className="text-[15px] leading-[1.45] text-ink-muted">
          <span className="font-bold text-ink">{name} asked:</span> {c.lastTutorQuestion}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-pill border border-line-soft bg-ground px-2.5 py-1 text-[13px] font-bold text-ink-muted">
            {MODE_LABEL[c.mode]}
          </span>
          {c.isSupersededVersion && (
            <span className="rounded-pill border border-line px-2.5 py-1 text-[13px] font-bold text-ink-muted">
              Earlier version
            </span>
          )}
        </div>
        <Link
          href={c.href}
          className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-bold text-primary hover:text-primary-hover"
        >
          {c.canContinue ? "Continue" : "Open"}
          <ArrowRightIcon size={18} />
        </Link>
      </div>
    </li>
  );
}
