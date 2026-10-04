"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  boldFinalQuestion,
  linkCitations,
  parseCiteHref,
  splitIllustrations,
} from "../../lib/chat/text";
import { LightbulbIcon } from "../icons";

/**
 * A tutor message (workspace handoff §4.2): Markdown without raw HTML (NFR-9), `[p. N]` as
 * citation chips that open the page, `💡 Illustrative example:` paragraphs as labelled blocks,
 * and the turn's final question in bold.
 */
export function TutorMarkdown({
  text,
  onCite,
  final = true,
}: {
  text: string;
  onCite: (page: number) => void;
  /** Bold the closing question only once the message is complete. */
  final?: boolean;
}) {
  const components: Components = {
    a({ href, children }) {
      const cite = parseCiteHref(href);
      if (cite) {
        const label = cite.from === cite.to ? `${cite.from}` : `${cite.from}–${cite.to}`;
        return (
          <button
            type="button"
            onClick={() => onCite(cite.from)}
            aria-label={`Open page ${label} in the paper`}
            className="mx-0.5 inline-flex min-h-6 items-center rounded-pill bg-panel px-[9px] py-px align-baseline text-sm font-bold text-primary-hover hover:bg-progress-empty"
          >
            p. {label}
          </button>
        );
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="font-bold text-primary underline"
        >
          {children}
        </a>
      );
    },
    img: () => null,
  };
  const prose =
    "flex flex-col gap-2.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_code]:rounded [&_code]:bg-ground [&_code]:px-1 [&_strong]:font-bold";
  const segments = splitIllustrations(final ? boldFinalQuestion(text) : text);
  return (
    <div className="flex flex-col gap-3">
      {segments.map((s, i) =>
        s.kind === "illustration" ? (
          <div
            key={i}
            className="flex flex-col gap-1.5 rounded-field bg-illustration-bg px-3.5 py-3"
          >
            <p className="flex items-center gap-1.5 text-sm font-bold text-success-ink">
              <LightbulbIcon size={18} />
              Illustrative example, not from the paper
            </p>
            <div className={`${prose} text-base`}>
              <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
                {linkCitations(s.markdown)}
              </Markdown>
            </div>
          </div>
        ) : (
          <div key={i} className={prose}>
            <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
              {linkCitations(s.markdown)}
            </Markdown>
          </div>
        ),
      )}
    </div>
  );
}
