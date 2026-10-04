import type { Metadata } from "next";
import { Badge, Card } from "../../../components/admin/ui";
import { dateTime } from "../../../lib/admin/format";
import { adminHealth } from "../../../lib/review/health";

export const metadata: Metadata = { title: "Health" };

const Ok = ({ ok, yes = "OK", no = "Problem" }: { ok: boolean; yes?: string; no?: string }) => (
  <Badge tone={ok ? "success" : "danger"}>{ok ? yes : no}</Badge>
);

/** FR-9.5 admin health: database, storage, model providers (cached 60 s), worker, last errors. */
export default async function HealthPage() {
  const h = await adminHealth();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Health</h1>
        <p className="text-ink-muted">Checked {dateTime(h.checkedAt)}. Reload to check again.</p>
      </div>
      <Card title="Services" id="services-h">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3">
          <dt className="font-bold">Database</dt>
          <dd>
            <Ok ok={h.db} />
          </dd>
          <dt className="font-bold">PDF storage</dt>
          <dd>
            <Ok ok={h.storage} />
          </dd>
          <dt className="font-bold">Model provider</dt>
          <dd className="flex flex-col gap-1">
            {h.llm.roles.length === 0 ? (
              <Badge tone="danger">Not reachable</Badge>
            ) : (
              h.llm.roles.map((r) => (
                <span
                  key={`${r.provider}:${r.model}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <Ok ok={r.ok} yes="OK" no={r.errorCode ?? "Error"} />
                  <span>
                    {r.provider}:{r.model}
                  </span>
                  {r.latencyMs !== null && (
                    <span className="text-sm text-ink-muted">
                      {(r.latencyMs / 1000).toFixed(1)} s
                    </span>
                  )}
                </span>
              ))
            )}
            <span className="text-sm text-ink-muted">
              Pinged {dateTime(h.llm.cachedAt)} (cached 60 s)
            </span>
          </dd>
          <dt className="font-bold">Ingestion worker</dt>
          <dd className="flex flex-col gap-1">
            {h.workers.length === 0 ? (
              <Badge tone="danger">Never seen</Badge>
            ) : (
              h.workers.map((w) => (
                <span key={w.name} className="flex flex-wrap items-center gap-2">
                  <Ok ok={!w.stale} yes="Running" no="Stale" />
                  <span>
                    {w.name} · last poll {dateTime(w.lastSeenAt)}
                  </span>
                </span>
              ))
            )}
          </dd>
        </dl>
      </Card>
      <Card title="Last errors" id="errors-h">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="font-bold">Model call</dt>
          <dd>
            {h.lastErrors.llm
              ? `${dateTime(h.lastErrors.llm.at)} · ${h.lastErrors.llm.purpose} · ${h.lastErrors.llm.model} · ${h.lastErrors.llm.errorCode ?? "error"}`
              : "None"}
          </dd>
          <dt className="font-bold">Ingestion</dt>
          <dd>
            {h.lastErrors.ingest
              ? `${dateTime(h.lastErrors.ingest.at)} · ${h.lastErrors.ingest.error ?? "failed"}`
              : "None"}
          </dd>
        </dl>
      </Card>
    </div>
  );
}
