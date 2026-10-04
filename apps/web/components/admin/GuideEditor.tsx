"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import type { GuideView } from "../../lib/admin/views";
import { checkGuideYaml } from "../../lib/admin/guideYaml";
import { jobLabel, useJob } from "./useJob";
import {
  api,
  Button,
  dateTime,
  Dialog,
  ErrorNote,
  LiveNote,
  StatusBadge,
  type ApiFailure,
} from "./ui";

/**
 * FR-6.4 guide editor: YAML with live zod + page-range validation, Save draft, Approve,
 * Regenerate draft (confirm; overwrites), import/export YAML. Read-only once the version is
 * published (ADR-009/027).
 */
export function GuideEditor({
  versionId,
  paperSlug,
  versionNo,
  pageCount,
  initial,
  onChanged,
}: {
  versionId: string;
  paperSlug: string;
  versionNo: number;
  pageCount: number | null;
  initial: GuideView;
  onChanged: () => void;
}) {
  const [text, setText] = useState(initial.yaml);
  const [saved, setSaved] = useState(initial.yaml);
  const [status, setStatus] = useState(initial.status);
  const [hash, setHash] = useState(initial.guideHash);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"save" | "approve" | "regenerate" | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [regenJob, setRegenJob] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);

  const deferred = useDeferredValue(text);
  const checked = useMemo(() => checkGuideYaml(deferred, pageCount), [deferred, pageCount]);
  const dirty = text !== saved;
  const editable = initial.editable;

  const job = useJob(regenJob, async (s) => {
    if (s.job.status !== "succeeded") return;
    const res = await api<GuideView>(`/api/admin/versions/${versionId}/guide`);
    if (!res.ok) return setError(res.error);
    setText(res.data.yaml);
    setSaved(res.data.yaml);
    setStatus(res.data.status);
    setHash(res.data.guideHash);
    setNote(
      res.data.issues.length
        ? `New draft loaded with ${res.data.issues.length} issue(s).`
        : "New draft loaded. Review it, then approve.",
    );
    onChanged();
  });

  const save = async () => {
    setBusy("save");
    setError(null);
    const res = await api<{ status: "draft"; guideHash: string; issues: unknown[] }>(
      `/api/admin/versions/${versionId}/guide`,
      { method: "PUT", body: { yaml: text } },
    );
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setSaved(text);
    setStatus(res.data.status);
    setHash(res.data.guideHash);
    setNote(
      res.data.issues.length
        ? `Draft saved with ${res.data.issues.length} issue(s). Fix them before approving.`
        : "Draft saved. Approve it when it is ready.",
    );
    onChanged();
  };

  const approve = async () => {
    setBusy("approve");
    setError(null);
    const res = await api<{ status: "approved"; guideHash: string }>(
      `/api/admin/versions/${versionId}/guide/approve`,
      { method: "POST", body: { guideHash: hash ?? undefined } },
    );
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setStatus("approved");
    setNote("Guide approved. You can publish this version.");
    onChanged();
  };

  const regenerate = async () => {
    setConfirmRegenerate(false);
    setBusy("regenerate");
    setError(null);
    const res = await api<{ jobId: string }>(`/api/admin/versions/${versionId}/guide/regenerate`, {
      method: "POST",
    });
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setRegenJob(res.data.jobId);
  };

  const exportYaml = () => {
    const blob = new Blob([text], { type: "application/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${paperSlug}-v${versionNo}-guide.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importYaml = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
    setNote(`Imported ${file.name}. Save to keep it.`);
    if (importInput.current) importInput.current.value = "";
    editor.current?.focus();
  };

  const jumpTo = (path: string) => {
    const line = /^line (\d+)$/.exec(path)?.[1];
    const el = editor.current;
    if (!el) return;
    // `line 12` from a YAML syntax error; `objectives[1].hints` → the last plain key of the path.
    const key = path
      .split(/[.[\]]/)
      .filter((k) => k && !/^\d+$/.test(k))
      .at(-1);
    const index = line
      ? text
          .split("\n")
          .slice(0, Number(line) - 1)
          .join("\n").length + 1
      : Math.max(0, key ? text.search(new RegExp(`^\\s*-?\\s*${key}:`, "m")) : 0);
    el.focus();
    el.setSelectionRange(index, index);
  };

  const approvable =
    editable && !dirty && checked.issues.length === 0 && status === "draft" && text.trim();
  const regenRunning = job && (job.job.status === "queued" || job.job.status === "running");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {status ? (
          <StatusBadge status={status} label={status === "approved" ? "Approved" : "Draft"} />
        ) : (
          <StatusBadge status="draft" label="No guide yet" />
        )}
        {dirty && <StatusBadge status="processing" label="Unsaved changes" />}
        <span className="text-sm text-ink-muted">
          {initial.source === "draft" && initial.model
            ? `Drafted by ${initial.model} (${initial.promptVersion})`
            : initial.source === "copy"
              ? "Copied from an earlier version"
              : initial.source
                ? `Edited (${initial.source})`
                : ""}
          {initial.updatedAt ? ` · updated ${dateTime(initial.updatedAt)}` : ""}
          {initial.approvedAt ? ` · approved ${dateTime(initial.approvedAt)}` : ""}
        </span>
      </div>

      {!editable && (
        <p className="rounded-field bg-panel p-3">
          This version is {initial.status === "approved" ? "published or superseded" : "not ready"},
          so its guide is read-only. Use “New version from this one” to change it: students on this
          version keep the guide they started with.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-2">
          <label htmlFor="guide-yaml" className="font-bold">
            Teaching guide (YAML)
          </label>
          <textarea
            id="guide-yaml"
            ref={editor}
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={!editable}
            spellCheck={false}
            aria-describedby="guide-issues-h"
            className="min-h-[60vh] w-full rounded-field border-[1.5px] border-line bg-surface p-3 font-mono text-[14px] leading-6 text-ink"
          />
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={save} busy={busy === "save"} disabled={!dirty}>
                Save draft
              </Button>
              <Button onClick={approve} busy={busy === "approve"} disabled={!approvable}>
                Approve
              </Button>
              <Button
                onClick={() => setConfirmRegenerate(true)}
                busy={busy === "regenerate" || !!regenRunning}
              >
                Regenerate draft…
              </Button>
              <Button variant="ghost" onClick={() => importInput.current?.click()}>
                Import YAML
              </Button>
              <input
                ref={importInput}
                type="file"
                accept=".yaml,.yml,application/yaml,text/yaml"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => importYaml(e.target.files?.[0])}
              />
              <Button variant="ghost" onClick={exportYaml} disabled={!text.trim()}>
                Export YAML
              </Button>
            </div>
          )}
          {!editable && (
            <div>
              <Button variant="ghost" onClick={exportYaml} disabled={!text.trim()}>
                Export YAML
              </Button>
            </div>
          )}
          {regenJob && <LiveNote>Regenerate: {jobLabel(job)}</LiveNote>}
          <LiveNote>{note}</LiveNote>
          <ErrorNote error={error} />
        </div>

        <aside className="flex flex-col gap-3" aria-labelledby="guide-issues-h">
          <h3 id="guide-issues-h" className="font-bold">
            {checked.issues.length === 0
              ? "No issues: the guide validates"
              : `${checked.issues.length} issue${checked.issues.length === 1 ? "" : "s"}`}
          </h3>
          {checked.issues.length > 0 && (
            <ul className="flex max-h-[50vh] flex-col gap-1 overflow-auto">
              {checked.issues.map((i, n) => (
                <li key={n}>
                  <button
                    type="button"
                    onClick={() => jumpTo(i.path)}
                    className="w-full rounded-field p-2 text-left text-sm hover:bg-panel"
                  >
                    <code className="font-bold text-danger-ink">{i.path}</code>
                    <br />
                    {i.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {initial.draftIssues.length > 0 && initial.source === "draft" && (
            <details className="text-sm">
              <summary className="cursor-pointer font-bold">
                The model&apos;s draft had {initial.draftIssues.length} issue(s)
              </summary>
              <ul className="mt-1 list-disc pl-5">
                {initial.draftIssues.map((i, n) => (
                  <li key={n}>
                    <code>{i.path}</code>: {i.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-sm text-ink-muted">
            Students never see the guide. They see the objective statements, page refs and starter
            questions only.
          </p>
        </aside>
      </div>

      <Dialog
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        title="Regenerate the draft?"
      >
        <p>
          The model drafts a new guide from the extracted pages. It overwrites the current guide
          {dirty ? " and your unsaved changes" : ""}; export it first if you want to keep it.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmRegenerate(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={regenerate}>
            Regenerate
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
