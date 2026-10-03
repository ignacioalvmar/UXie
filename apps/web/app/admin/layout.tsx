import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "../../components/auth/parts";
import { requireInstructor } from "../../lib/auth";

export const dynamic = "force-dynamic";

/** FR-1.6: instructors only; anyone else gets a 404 from requireInstructor(). */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireInstructor();
  const nav =
    "inline-flex min-h-11 items-center rounded-field px-3 font-bold text-ink hover:bg-panel";
  return (
    <div
      className="force-light flex min-h-dvh flex-col bg-ground text-ink"
      style={{ colorScheme: "light" }}
    >
      <header className="border-b border-line-soft bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <span className="inline-flex items-center gap-3">
            <BrandMark href="/" />
            <span className="rounded-chip bg-panel px-2 py-1 text-sm font-bold">Instructor</span>
          </span>
          <nav aria-label="Admin" className="flex flex-wrap gap-1">
            <Link href="/admin" className={nav}>
              Overview
            </Link>
            <Link href="/admin/settings/ai" className={nav}>
              AI provider
            </Link>
            <Link href="/" className={nav}>
              Student view
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
