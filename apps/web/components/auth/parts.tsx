import Link from "next/link";
import type { ReactNode } from "react";
import { UxieCharacter, type CharacterId, type CharacterState } from "@uxie/character";

/** Presentational auth parts (docs/design/login/HANDOFF.md §4). Server-renderable. */

export function BrandMark({ size = "md", href }: { size?: "md" | "lg"; href?: string }) {
  const tile = size === "lg" ? "size-[38px] rounded-[12px]" : "size-8 rounded-[10px]";
  const word = size === "lg" ? "text-[28px]" : "text-2xl";
  const inner = (
    <span className="inline-flex items-center gap-2.5">
      <span className={`${tile} inline-flex items-center justify-center bg-primary`}>
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 5h16v11H9l-5 4z" />
          <path d="M10 9.2a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2" />
        </svg>
      </span>
      <span className={`font-display ${word} font-bold tracking-[-0.02em] text-ink`}>UXie</span>
    </span>
  );
  return href ? (
    <Link href={href} className="rounded-field">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function SpeechBubble({
  from = "left",
  children,
  className = "",
}: {
  from?: "left" | "right";
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`uxie-bubble ${from === "right" ? "uxie-bubble--from-right" : ""} px-4 py-3 text-[17px] leading-[1.45] ${className}`}
    >
      {children}
    </p>
  );
}

/** Pip, Miso and Luma bottom-aligned and overlapping; Miso slightly taller in the middle. */
export function CharacterTrio({ size, className = "" }: { size: number; className?: string }) {
  const overlap = Math.round(size * 0.12);
  return (
    <div className={`flex items-end justify-center ${className}`} aria-hidden="true">
      <UxieCharacter character="pip" size={size} decorative />
      <span style={{ marginLeft: -overlap, marginRight: -overlap }} className="relative z-10">
        <UxieCharacter character="miso" size={Math.round(size * 1.07)} decorative tempo="slow" />
      </span>
      <UxieCharacter character="luma" size={size} decorative tempo="fast" />
    </div>
  );
}

export function CharacterLine({
  character,
  state = "idle",
  size = 64,
  children,
}: {
  character: CharacterId;
  state?: CharacterState;
  size?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex items-end gap-3">
      <UxieCharacter character={character} state={state} size={size} decorative />
      <SpeechBubble className="mb-2">{children}</SpeechBubble>
    </div>
  );
}

export function AuthFooter() {
  return (
    <p className="text-sm text-ink-subtle">
      Data hosted in the EU ·{" "}
      <Link
        href="/privacy"
        className="inline-block py-3 font-bold text-primary hover:text-primary-hover hover:underline"
      >
        Privacy notice
      </Link>
    </p>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-block py-2.5 font-bold text-primary hover:text-primary-hover hover:underline"
    >
      {children}
    </Link>
  );
}

/** Stacked shell used by every auth screen except sign-in on wide screens (HANDOFF §5). */
export function StackedShell({ children, back }: { children: ReactNode; back?: string }) {
  return (
    <div className="force-light min-h-dvh bg-ground" style={{ colorScheme: "light" }}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col px-6 py-6">
        <header className="flex items-center gap-2">
          {back && (
            <Link
              href={back}
              aria-label="Back to sign in"
              className="-ml-2 inline-flex size-11 items-center justify-center rounded-field text-ink hover:bg-panel"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
          )}
          <BrandMark />
        </header>
        <main id="main" className="flex flex-1 flex-col gap-[18px] pt-8 text-ink">
          {children}
        </main>
        <footer className="pt-8">
          <AuthFooter />
        </footer>
      </div>
    </div>
  );
}
