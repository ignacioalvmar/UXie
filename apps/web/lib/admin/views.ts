import "server-only";
import { validateGuide, type ExtractionWarning, type GuideIssue } from "@uxie/core";
import {
  guideEditable,
  type AdminModule,
  type AdminPaper,
  type AdminRepo,
  type AdminVersion,
  type GuideStatus,
  type IngestJob,
} from "@uxie/db";
import { guideToEditorYaml } from "./guideYaml";

/** Read models for the instructor pages (FR-6.1–6.5). Instructors may see guides in full. */

export interface VersionRow extends AdminVersion {
  latestJob: IngestJob | null;
  conversations: number;
  isCurrent: boolean;
}

export interface PaperAdminView {
  paper: AdminPaper;
  module: AdminModule | null;
  modules: AdminModule[];
  versions: VersionRow[];
}

export async function loadPaperAdmin(
  repo: AdminRepo,
  paperId: string,
): Promise<PaperAdminView | null> {
  const paper = await repo.paper(paperId);
  if (!paper) return null;
  const [modules, versions] = await Promise.all([repo.modules(), repo.versions(paperId)]);
  const ids = versions.map((v) => v.id);
  const [jobs, counts] = await Promise.all([repo.latestJobs(ids), repo.conversationCounts(ids)]);
  return {
    paper,
    module: modules.find((m) => m.id === paper.moduleId) ?? null,
    modules,
    versions: versions.map((v) => ({
      ...v,
      latestJob: jobs.get(v.id) ?? null,
      conversations: counts.get(v.id) ?? 0,
      isCurrent: paper.currentVersionId === v.id,
    })),
  };
}

export interface GuideView {
  yaml: string;
  status: GuideStatus | null;
  guideHash: string | null;
  issues: GuideIssue[];
  /** Issues the model's draft had (FR-5.4), as stored with the draft. */
  draftIssues: GuideIssue[];
  source: string | null;
  promptVersion: string | null;
  model: string | null;
  updatedAt: string | null;
  approvedAt: string | null;
  editable: boolean;
}

export interface VersionAdminView {
  paper: AdminPaper;
  version: AdminVersion;
  isCurrent: boolean;
  latestJob: IngestJob | null;
  pages: { n: number; text: string }[];
  warnings: ExtractionWarning[];
  guide: GuideView;
  conversations: number;
}

export async function loadVersionAdmin(
  repo: AdminRepo,
  versionId: string,
): Promise<VersionAdminView | null> {
  const version = await repo.version(versionId);
  if (!version) return null;
  const [paper, latestJob, pages, record, counts] = await Promise.all([
    repo.paper(version.paperId),
    repo.latestJob(versionId),
    repo.pages(versionId),
    repo.guide(versionId),
    repo.conversationCounts([versionId]),
  ]);
  if (!paper) return null;
  const issues = record ? validateGuide(record.guide, version.pageCount ?? undefined).issues : [];
  return {
    paper,
    version,
    isCurrent: paper.currentVersionId === version.id,
    latestJob,
    pages,
    warnings: version.warnings,
    conversations: counts.get(versionId) ?? 0,
    guide: {
      yaml: record ? guideToEditorYaml(record.guide) : "",
      status: record?.status ?? null,
      guideHash: record?.guideHash ?? null,
      issues,
      draftIssues: record?.draftMeta.issues ?? [],
      source: record?.draftMeta.source ?? null,
      promptVersion: record?.draftMeta.prompt_version ?? null,
      model: record?.draftMeta.model ?? null,
      updatedAt: record?.updatedAt ?? null,
      approvedAt: record?.approvedAt ?? null,
      editable: guideEditable(version),
    },
  };
}

export interface ContentModuleView extends AdminModule {
  papers: {
    id: string;
    slug: string;
    title: string;
    status: AdminPaper["status"];
    currentVersionNo: number | null;
    latestVersionStatus: string | null;
  }[];
}

/** /admin/content: every module (any status) with its papers in order (FR-6.1, FR-6.2). */
export async function loadContent(repo: AdminRepo): Promise<ContentModuleView[]> {
  const [modules, papers, versions] = await Promise.all([
    repo.modules(),
    repo.papers(),
    repo.versionSummaries(),
  ]);
  return modules.map((m) => ({
    ...m,
    papers: papers
      .filter((p) => p.moduleId === m.id)
      .map((p) => {
        const mine = versions.filter((v) => v.paperId === p.id);
        return {
          id: p.id,
          slug: p.slug,
          title: p.title,
          status: p.status,
          currentVersionNo: mine.find((v) => v.id === p.currentVersionId)?.versionNo ?? null,
          latestVersionStatus: mine[0]?.status ?? null,
        };
      }),
  }));
}
