import type { Metadata } from "next";
import { DataRightsRepo, isOpenRequest } from "@uxie/db";
import { DataRequestRow } from "../../../components/admin/review/DataRequests";
import { Card } from "../../../components/admin/ui";
import { dueLabel } from "../../../lib/review/text";
import { serviceDb } from "../../../lib/supabase/server";

export const metadata: Metadata = { title: "Data requests" };

/** FR-8.2 / FR-8.3: students' data requests, oldest due first, overdue highlighted. */
export default async function DataRequestsPage() {
  const now = new Date();
  const requests = (await new DataRightsRepo(serviceDb()).listRequests()).map(
    ({ studentId: _omit, ...r }) => ({ ...r, due: dueLabel(r.dueAt, now) }),
  );
  const open = requests.filter(isOpenRequest);
  const closed = requests
    .filter((r) => !isOpenRequest(r))
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))
    .slice(0, 50);
  const list = "flex flex-col divide-y divide-line-soft";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Data requests</h1>
        <p className="text-ink-muted">
          Students download their data themselves (logged here). Deletion requests must be answered
          within 30 days; the runbook covers backups and exports already shared.
        </p>
      </div>
      <Card title={`Open (${open.length})`} id="open-h">
        {open.length === 0 ? (
          <p className="text-ink-muted">Nothing to do.</p>
        ) : (
          <ul className={list}>
            {open.map((r) => (
              <DataRequestRow key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Card>
      <Card title="Closed" id="closed-h">
        {closed.length === 0 ? (
          <p className="text-ink-muted">None yet.</p>
        ) : (
          <ul className={list}>
            {closed.map((r) => (
              <DataRequestRow key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
