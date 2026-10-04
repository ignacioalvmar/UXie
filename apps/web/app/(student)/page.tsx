import type { Metadata } from "next";
import { LibraryView } from "../../components/library/LibraryView";
import { requireUser } from "../../lib/auth";
import { loadLibrary } from "../../lib/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Library" };

/** Library (FR-2.1–2.3, docs/design/library/HANDOFF.md). */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { user, profile } = await requireUser();
  const { q } = await searchParams;
  const data = await loadLibrary(user.id);
  return (
    <LibraryView
      data={data}
      character={profile.uxieCharacter ?? "pip"}
      initialQuery={typeof q === "string" ? q.slice(0, 200) : ""}
    />
  );
}
