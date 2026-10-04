import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UxieCharacter } from "@uxie/character";
import { Workspace } from "../../../../components/workspace/Workspace";
import { requireUser } from "../../../../lib/auth";
import { enabledModes } from "../../../../lib/chat/store";
import { isUuid } from "../../../../lib/http";
import { loadWorkspace } from "../../../../lib/views";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ c?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug.replace(/-/g, " ") };
}

/**
 * Workspace (FR-3.1–3.4, FR-3.7): `/papers/[slug]` opens the current published version, or the
 * conversation's version with `?c=`. Reading never creates a conversation (FR-3.2).
 */
export default async function PaperPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { c } = await searchParams;
  const { user, profile } = await requireUser({ next: `/papers/${slug}` });
  const conversationId = typeof c === "string" && isUuid(c) ? c : null;
  const result = await loadWorkspace(user.id, slug, conversationId, {
    modes: enabledModes(),
    projectDescription: profile.projectDescription,
  });
  if (result.kind === "not_found") notFound();
  const character = profile.uxieCharacter ?? "pip";

  if (result.kind === "unavailable")
    return (
      <main
        id="main"
        className="force-light flex min-h-dvh items-center justify-center bg-ground p-6 text-ink"
        style={{ colorScheme: "light" }}
      >
        <div className="flex max-w-lg flex-col items-start gap-4">
          <UxieCharacter character={character} size={96} decorative className="uxie-resting" />
          <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">{result.title}</h1>
          <p className="text-lg">
            This paper is no longer available in the library. Your earlier conversations about it
            are still in “My conversations”.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/conversations"
              className="inline-flex min-h-11 items-center rounded-field bg-primary px-4 font-bold text-on-primary"
            >
              My conversations
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-field border-[1.5px] border-primary px-4 font-bold text-primary"
            >
              Back to the library
            </Link>
          </div>
        </div>
      </main>
    );

  // Keyed by conversation: Start over and "new conversation" links remount the chat state.
  return (
    <Workspace
      key={result.workspace.conversation?.id ?? "new"}
      data={result.workspace}
      character={character}
    />
  );
}
