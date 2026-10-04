"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { PaperAdminView, VersionRow } from "../../lib/admin/views";
import { DeleteButton } from "./DeleteDialog";
import { jobLabel, useJob } from "./useJob";
import {
  api,
  Badge,
  Button,
  Card,
  dateTime,
  ErrorNote,
  Field,
  inputClass,
  LiveNote,
  StatusBadge,
  type ApiFailure,
} from "./ui";

/** /admin/papers/[id] (FR-5.1, FR-6.2, FR-6.3, FR-6.7). */
export function PaperManager({
  view,
  maxPdfMb,
  justCreated,
}: {
  view: PaperAdminView;
  maxPdfMb: number;
  justCreated: boolean;
}) {
  const router = useRouter();
  const { paper } = view;
  const [error, setError] = useState<ApiFailure | null>(null);
  const [note, setNote] = useState("");

  const patch = async (body: object, done: string) => {
    setError(null);
    const res = await api(`/api/admin/papers/${paper.id}`, { method: "PATCH", body });
    if (!res.ok) return (setError(res.error), false);
    setNote(done);
    router.refresh();
    return true;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/admin/content" className="font-bold text-primary hover:underline">
          ← Content
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">{paper.title}</h1>
          <StatusBadge status={paper.status} />
        </div>
        <p className="text-ink-muted">
          <code>{paper.slug}</code> · module “{view.module?.title ?? "?"}”
          {paper.status === "published" && (
            <>
              {" · "}
              <Link href={`/papers/${paper.slug}`} className="text-primary hover:underline">
                Open as student
              </Link>
            </>
          )}
        </p>
      </div>
      <ErrorNote error={error} />
      <LiveNote>{note}</LiveNote>

      <Uploader
        paperId={paper.id}
        maxPdfMb={maxPdfMb}
        hasVersions={view.versions.length > 0}
        highlight={justCreated && view.versions.length === 0}
        onDone={() => router.refresh()}
      />

      <Card title="Versions" id="versions-h">
        {view.versions.length === 0 ? (
          <p className="text-ink-muted">No PDF uploaded yet.</p>
        ) : (
          <VersionsTable versions={view.versions} />
        )}
        <p className="text-sm text-ink-muted">
          Replacing the PDF makes a new version. Conversations stay on the version they started on;
          after you publish the new one, new conversations use it and older ones are labelled as
          based on a previous version.
        </p>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <DetailsForm view={view} onSave={(b) => patch(b, "Details saved.")} />
        <Card title="Module and availability" id="move-h">
          <MoveForm
            view={view}
            onMove={(moduleId, title) => patch({ moduleId }, `Moved to “${title}”.`)}
          />
          <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
            {paper.status === "retired" ? (
              <>
                <p>
                  Retired: not in the library, no new conversations; students can still read their
                  history.
                </p>
                <div>
                  <Button onClick={() => patch({ retired: false }, "Paper is available again.")}>
                    Un-retire
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-ink-muted">
                  Retiring removes the paper from the library and stops new conversations. History
                  stays readable.
                </p>
                <div>
                  <Button onClick={() => patch({ retired: true }, "Paper retired.")}>
                    Retire paper
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <Card title="Danger zone" id="danger-h" className="border-danger-line">
        <DeleteButton
          url={`/api/admin/papers/${paper.id}`}
          slug={paper.slug}
          what="paper"
          onDeleted={() => router.push("/admin/content")}
        />
      </Card>
    </div>
  );
}

function VersionsTable({ versions }: { versions: VersionRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left">
        <caption className="sr-only">Versions of this paper, newest first</caption>
        <thead className="text-sm text-ink-muted">
          <tr>
            <th scope="col" className="py-2 pr-3">
              Version
            </th>
            <th scope="col" className="py-2 pr-3">
              Status
            </th>
            <th scope="col" className="py-2 pr-3">
              Guide
            </th>
            <th scope="col" className="py-2 pr-3">
              Pages
            </th>
            <th scope="col" className="py-2 pr-3">
              Conversations
            </th>
            <th scope="col" className="py-2 pr-3">
              Uploaded
            </th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} className="border-t border-line-soft">
              <th scope="row" className="py-2 pr-3">
                <Link
                  href={`/admin/versions/${v.id}`}
                  className="font-bold text-primary hover:underline"
                >
                  v{v.versionNo}
                </Link>{" "}
                {v.isCurrent && <Badge tone="success">current</Badge>}
              </th>
              <td className="py-2 pr-3">
                <span className="flex flex-col items-start gap-1">
                  <StatusBadge status={v.status} />
                  {v.latestJob?.status === "failed" && v.status === "failed" && (
                    <span className="text-sm text-danger-ink">{v.latestJob.error}</span>
                  )}
                </span>
              </td>
              <td className="py-2 pr-3">
                {v.guideStatus ? (
                  <StatusBadge status={v.guideStatus} />
                ) : (
                  <span className="text-ink-muted">–</span>
                )}
              </td>
              <td className="py-2 pr-3">
                {v.pageCount ?? "–"}
                {v.warnings.filter((w) => w.kind !== "references_start").length > 0 && (
                  <span className="ml-1 text-sm text-ink-muted">
                    ({v.warnings.filter((w) => w.kind !== "references_start").length} warnings)
                  </span>
                )}
              </td>
              <td className="py-2 pr-3">{v.conversations}</td>
              <td className="py-2 pr-3 text-sm">{dateTime(v.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type UploadPhase =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "processing"; jobId: string; versionId: string; versionNo: number };

/**
 * FR-5.1: create the version (signed upload URL) → PUT the file straight to Storage (progress)
 * → confirm → poll the ingest job.
 */
function Uploader({
  paperId,
  maxPdfMb,
  hasVersions,
  highlight,
  onDone,
}: {
  paperId: string;
  maxPdfMb: number;
  hasVersions: boolean;
  highlight: boolean;
  onDone: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });
  const [error, setError] = useState<ApiFailure | null>(null);
  const job = useJob(phase.kind === "processing" ? phase.jobId : null, () => onDone());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    if (file.size > maxPdfMb * 1024 * 1024)
      return setError({ code: "too_large", message: `The PDF is larger than ${maxPdfMb} MB.` });
    setPhase({ kind: "uploading", percent: 0 });
    const created = await api<{ versionId: string; versionNo: number; signedUploadUrl: string }>(
      `/api/admin/papers/${paperId}/versions`,
      { method: "POST", body: { filename: file.name, sizeBytes: file.size } },
    );
    if (!created.ok) return (setPhase({ kind: "idle" }), setError(created.error));

    const ok = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", created.data.signedUploadUrl);
      xhr.setRequestHeader("content-type", "application/pdf");
      xhr.setRequestHeader("x-upsert", "true");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable)
          setPhase({ kind: "uploading", percent: Math.round((ev.loaded / ev.total) * 100) });
      };
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.send(file);
    });
    if (!ok) {
      setPhase({ kind: "idle" });
      return setError({ code: "upload_failed", message: "The upload failed. Try again." });
    }
    const confirmed = await api<{ jobId: string }>(
      `/api/admin/versions/${created.data.versionId}/uploaded`,
      { method: "POST" },
    );
    if (!confirmed.ok) return (setPhase({ kind: "idle" }), setError(confirmed.error));
    setPhase({
      kind: "processing",
      jobId: confirmed.data.jobId,
      versionId: created.data.versionId,
      versionNo: created.data.versionNo,
    });
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const finished = job && (job.job.status === "succeeded" || job.job.status === "failed");

  return (
    <Card
      title={hasVersions ? "Replace the PDF (new version)" : "Upload the PDF"}
      id="upload-h"
      className={highlight ? "border-primary" : ""}
    >
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field
          label="PDF file"
          hint={`Up to ${maxPdfMb} MB. Text is extracted page by page; the teaching guide is drafted automatically.`}
        >
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            className="min-h-11 py-2"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={phase.kind === "uploading"}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          disabled={!file || phase.kind === "uploading"}
          busy={phase.kind === "uploading"}
        >
          Upload
        </Button>
      </form>
      {phase.kind === "uploading" && (
        <div className="flex flex-col gap-1">
          <progress
            max={100}
            value={phase.percent}
            className="w-full"
            aria-label="Upload progress"
          />
          <LiveNote>Uploading… {phase.percent}%</LiveNote>
        </div>
      )}
      {phase.kind === "processing" && (
        <div className="flex flex-col gap-1">
          <LiveNote>
            v{phase.versionNo}: {jobLabel(job)}
          </LiveNote>
          {finished && (
            <Link
              href={`/admin/versions/${phase.versionId}`}
              className="font-bold text-primary hover:underline"
            >
              Open v{phase.versionNo}: check the extraction and the guide →
            </Link>
          )}
        </div>
      )}
      <ErrorNote error={error} />
    </Card>
  );
}

function DetailsForm({
  view,
  onSave,
}: {
  view: PaperAdminView;
  onSave: (body: object) => Promise<boolean>;
}) {
  const p = view.paper;
  const [title, setTitle] = useState(p.title);
  const [authors, setAuthors] = useState(p.authors.join(", "));
  const [year, setYear] = useState(p.year?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Details" id="details-h">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onSave({
            title,
            authors: authors
              .split(/[;,]/)
              .map((a) => a.trim())
              .filter(Boolean),
            year: year ? Number(year) : null,
          });
          setBusy(false);
        }}
      >
        <Field label="Title">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={2}
          />
        </Field>
        <Field label="Authors" hint="Separate with commas.">
          <input
            className={inputClass}
            value={authors}
            onChange={(e) => setAuthors(e.target.value)}
          />
        </Field>
        <Field label="Year">
          <input
            className={inputClass}
            value={year}
            inputMode="numeric"
            pattern="(19|20|21)[0-9]{2}"
            onChange={(e) => setYear(e.target.value)}
          />
        </Field>
        <div>
          <Button type="submit" variant="primary" busy={busy}>
            Save details
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MoveForm({
  view,
  onMove,
}: {
  view: PaperAdminView;
  onMove: (moduleId: string, title: string) => Promise<boolean>;
}) {
  const [target, setTarget] = useState(view.paper.moduleId);
  const [busy, setBusy] = useState(false);
  const title = view.modules.find((m) => m.id === target)?.title ?? "";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onMove(target, title);
        setBusy(false);
      }}
    >
      <Field
        label="Module"
        hint="Existing conversations keep the module name they started in (reports and exports)."
      >
        <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
          {view.modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
              {m.status !== "published" ? ` (${m.status})` : ""}
            </option>
          ))}
        </select>
      </Field>
      <div>
        <Button type="submit" disabled={target === view.paper.moduleId} busy={busy}>
          Move paper
        </Button>
      </div>
    </form>
  );
}
