import Link from "next/link";
import { userClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

interface PaperRow {
  id: string;
  slug: string;
  title: string;
  authors: string[];
  year: number | null;
  position: number;
  status: string;
}
interface ModuleRow {
  id: string;
  title: string;
  description: string | null;
  position: number;
  papers: PaperRow[];
}

/**
 * Library shell (FR-2.1): published modules and their published papers, read with the user's
 * session so RLS decides what is visible (PRD §9.2). Continue badges arrive with M6.
 */
export default async function LibraryPage() {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("modules")
    .select(
      "id, title, description, position, papers(id, slug, title, authors, year, position, status)",
    )
    .eq("status", "published")
    .order("position");
  const modules = ((data ?? []) as ModuleRow[]).map((m) => ({
    ...m,
    papers: m.papers
      .filter((p) => p.status === "published")
      .sort((a, b) => a.position - b.position),
  }));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Library</h1>
      {error && <p role="alert">The library could not be loaded. Please try again in a moment.</p>}
      {!error && !modules.length && (
        <p className="text-ink-muted">No papers are published yet. Check back soon.</p>
      )}
      {modules.map((m) => (
        <section key={m.id} aria-labelledby={`module-${m.id}`} className="flex flex-col gap-3">
          <div>
            <h2 id={`module-${m.id}`} className="font-display text-2xl font-bold">
              {m.title}
            </h2>
            {m.description && <p className="text-ink-muted">{m.description}</p>}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {m.papers.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/papers/${p.slug}`}
                  className="flex h-full flex-col gap-1 rounded-chip border-[1.5px] border-line-soft bg-surface p-4 hover:border-primary"
                >
                  <span className="font-bold text-ink">{p.title}</span>
                  <span className="text-sm text-ink-subtle">
                    {p.authors.join(", ")}
                    {p.year ? ` · ${p.year}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
