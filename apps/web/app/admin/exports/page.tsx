import type { Metadata } from "next";
import { AdminRepo, ReviewRepo } from "@uxie/db";
import { ExportForm } from "../../../components/admin/review/ExportForm";
import { Badge, Card } from "../../../components/admin/ui";
import { dateTime } from "../../../lib/admin/format";
import { serviceDb } from "../../../lib/supabase/server";

export const metadata: Metadata = { title: "Exports" };

/** FR-7.3 conversation exports and the export log. */
export default async function ExportsPage() {
  const db = serviceDb();
  const admin = new AdminRepo(db);
  const [modules, papers, log] = await Promise.all([
    admin.modules(),
    admin.papers(),
    new ReviewRepo(db).exportLog(),
  ]);
  const titles = new Map<string, string>([
    ...modules.map((m) => [m.id, m.title] as const),
    ...papers.map((p) => [p.id, p.title] as const),
  ]);
  const describe = (f: Record<string, string | undefined>) =>
    [
      f.moduleId && `module ${titles.get(f.moduleId) ?? "(deleted)"}`,
      f.paperId && `paper ${titles.get(f.paperId) ?? "(deleted)"}`,
      f.versionId && "one version",
      f.from && `from ${f.from}`,
      f.to && `until ${f.to}`,
    ]
      .filter(Boolean)
      .join(", ") || "everything";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Exports</h1>
        <p className="text-ink-muted">
          One row per message, with pseudonym, paper version, mode, help level, model and feedback.
        </p>
      </div>
      <Card title="New export" id="export-h">
        <ExportForm
          modules={modules.map((m) => ({ id: m.id, title: m.title }))}
          papers={papers.map((p) => ({ id: p.id, title: p.title, moduleId: p.moduleId }))}
        />
      </Card>
      <Card title="Export log" id="log-h">
        {log.length === 0 ? (
          <p className="text-ink-muted">No exports yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead className="border-b border-line-soft text-sm text-ink-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4">
                    When
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    By
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Kind
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Filters
                  </th>
                  <th scope="col" className="py-2">
                    Rows
                  </th>
                </tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id} className="border-b border-line-soft last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap">{dateTime(l.createdAt)}</td>
                    <td className="py-2 pr-4">
                      {l.channel === "cli" ? "CLI" : (l.instructorPseudonym ?? "–")}
                    </td>
                    <td className="py-2 pr-4">
                      {l.format.toUpperCase()}{" "}
                      {l.researchOnly ? (
                        <Badge tone="info">Research</Badge>
                      ) : (
                        <Badge>All students</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {describe(l.filters as Record<string, string | undefined>)}
                    </td>
                    <td className="py-2">{l.rowCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
