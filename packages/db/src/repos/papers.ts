import { TeachingGuideSchema, type TeachingGuide } from "@uxie/core";
import { must, type Db } from "../client";

/** Shape of PaperForTutor (packages/tutor/ports.ts), matched structurally (PRD §4.3). */
export interface DbPaperForTutor {
  versionId: string;
  paperId: string;
  title: string;
  pageCount: number;
  pages: { n: number; text: string }[];
  guide: TeachingGuide;
  tokenEstimate: number;
}

/**
 * PaperRepo port on Supabase. Loaded versions are immutable (ADR-009), so they are cached per
 * process; a new guide approval creates a new cache key only via a new version, and an edited
 * draft guide is re-read after `ttlMs` (instructor test chats).
 */
export class SupabasePaperRepo {
  private cache = new Map<string, { at: number; paper: DbPaperForTutor }>();

  constructor(
    private readonly db: Db,
    private readonly opts: { ttlMs?: number; now?: () => number } = {},
  ) {}

  async getVersionForTutor(versionId: string): Promise<DbPaperForTutor> {
    const now = this.opts.now?.() ?? Date.now();
    const hit = this.cache.get(versionId);
    if (hit && now - hit.at < (this.opts.ttlMs ?? 60_000)) return hit.paper;

    const version = must(
      await this.db
        .from("paper_versions")
        .select(
          "id, paper_id, page_count, token_estimate, papers!paper_versions_paper_id_fkey(title)",
        )
        .eq("id", versionId)
        .maybeSingle(),
      `paper version ${versionId}`,
    ) as unknown as {
      id: string;
      paper_id: string;
      page_count: number | null;
      token_estimate: number | null;
      papers: { title: string } | null;
    };
    const pages = must(
      await this.db
        .from("paper_pages")
        .select("page_no, text")
        .eq("version_id", versionId)
        .order("page_no"),
      `pages of ${versionId}`,
    ) as { page_no: number; text: string }[];
    const guideRow = must(
      await this.db
        .from("teaching_guides")
        .select("guide")
        .eq("version_id", versionId)
        .maybeSingle(),
      `teaching guide of ${versionId}`,
    ) as { guide: unknown };

    const paper: DbPaperForTutor = {
      versionId: version.id,
      paperId: version.paper_id,
      title: version.papers?.title ?? "",
      pageCount: version.page_count ?? pages.length,
      pages: pages.map((p) => ({ n: p.page_no, text: p.text })),
      guide: TeachingGuideSchema.parse(guideRow.guide),
      tokenEstimate:
        version.token_estimate ?? Math.ceil(pages.reduce((n, p) => n + p.text.length, 0) / 4),
    };
    this.cache.set(versionId, { at: now, paper });
    return paper;
  }

  async searchPages(versionId: string, query: string, limit: number): Promise<number[]> {
    if (!query.trim()) return [];
    const rows = must(
      await this.db.rpc("search_pages", { p_version: versionId, p_query: query, p_limit: limit }),
      "search pages",
    ) as unknown as number[];
    return rows;
  }
}
