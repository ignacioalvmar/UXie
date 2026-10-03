import Link from "next/link";
import type { ReactNode } from "react";
import { UxieCharacter } from "@uxie/character";
import { BrandMark } from "../../components/auth/parts";
import { requireUser } from "../../lib/auth";
import { signOut } from "../(auth)/auth/actions";

/** App shell for signed-in, verified, onboarded users (FR-1.2, FR-1.3). */
export default async function StudentLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireUser();
  const nav =
    "inline-flex min-h-11 items-center rounded-field px-3 font-bold text-ink hover:bg-panel";
  return (
    <div
      className="force-light flex min-h-dvh flex-col bg-ground text-ink"
      style={{ colorScheme: "light" }}
    >
      <header className="border-b border-line-soft bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <BrandMark href="/" />
          <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
            <Link href="/" className={nav}>
              Library
            </Link>
            <Link href="/account" className={nav}>
              Account
            </Link>
            {profile.role === "instructor" && (
              <Link href="/admin" className={nav}>
                Admin
              </Link>
            )}
            <form action={signOut}>
              <button type="submit" className={nav}>
                Sign out
              </button>
            </form>
            {profile.uxieCharacter && (
              <UxieCharacter
                character={profile.uxieCharacter}
                size={36}
                decorative
                className="ml-1"
              />
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
