import Link from "next/link";
import { notFound } from "next/navigation";
import { userClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/** Placeholder until the workspace lands in M6 (FR-3.x). Visibility already follows RLS. */
export default async function PaperPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await userClient();
  const { data } = await supabase
    .from("papers")
    .select("title, authors, year, status")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) notFound();
  const paper = data as { title: string; authors: string[]; year: number | null; status: string };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">{paper.title}</h1>
      <p className="text-ink-muted">
        {paper.authors.join(", ")}
        {paper.year ? ` · ${paper.year}` : ""}
      </p>
      {paper.status === "retired" ? (
        <p>This paper is no longer available for new conversations.</p>
      ) : (
        <p>The reading and chat workspace for this paper is coming soon.</p>
      )}
      <Link href="/" className="font-bold text-primary hover:underline">
        Back to the library
      </Link>
    </div>
  );
}
