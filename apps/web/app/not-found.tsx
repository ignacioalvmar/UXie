import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { StackedShell } from "../components/auth/parts";

export const metadata: Metadata = { title: "Not found" };

/**
 * 404 page. Rendered per request (not prerendered) so its scripts carry the CSP nonce (NFR-9).
 */
export default async function NotFound() {
  await connection();
  return (
    <StackedShell>
      <div>
        <h1 className="font-display text-[32px] font-bold leading-[1.1] tracking-[-0.02em]">
          Page not found
        </h1>
        <p className="mt-2 text-[17px] text-ink-muted">
          This page doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
      </div>
      <Link href="/" className="font-bold underline underline-offset-4">
        Go to your library
      </Link>
    </StackedShell>
  );
}
