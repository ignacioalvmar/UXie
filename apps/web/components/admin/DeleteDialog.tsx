"use client";

import { useState } from "react";
import { api, Button, Dialog, ErrorNote, Field, inputClass, type ApiFailure } from "./ui";

/**
 * FR-6.7 guarded permanent deletion: shows the impact, requires typing the paper slug, and the
 * research-retention tick when an affected student gave research consent.
 */

interface Impact {
  versions: number;
  files: number;
  conversations: number;
  messages: number;
  students: number;
  researchConsentStudents: number;
}

export function DeleteButton({
  url,
  slug,
  what,
  onDeleted,
}: {
  /** The DELETE route; `?preview=1` returns the impact. */
  url: string;
  slug: string;
  what: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [typed, setTyped] = useState("");
  const [research, setResearch] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setError(null);
    setBusy(true);
    const res = await api<{ impact: Impact }>(`${url}?preview=1`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setImpact(res.data.impact);
    setTyped("");
    setResearch(false);
    setOpen(true);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const res = await api(url, {
      method: "DELETE",
      body: { confirmSlug: typed, researchChecked: research },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOpen(false);
    onDeleted();
  };

  const needsResearch = (impact?.researchConsentStudents ?? 0) > 0;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  return (
    <>
      <div className="flex flex-col gap-2">
        <div>
          <Button variant="danger" onClick={start} busy={busy && !open}>
            Delete {what} permanently…
          </Button>
        </div>
        {!open && <ErrorNote error={error} />}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Delete ${what} permanently?`}>
        {impact && (
          <>
            <p>This cannot be undone. It removes:</p>
            <ul className="list-disc pl-5">
              <li>
                {plural(impact.versions, "version")} and {plural(impact.files, "PDF file")}
              </li>
              <li>
                {plural(impact.conversations, "conversation")} with{" "}
                {plural(impact.messages, "message")}
              </li>
              <li>the history of {plural(impact.students, "student")}</li>
            </ul>
            <p className="text-sm text-ink-muted">
              To keep the history, retire the paper instead. An audit event records the deletion.
            </p>
            <Field label={`Type the paper slug “${slug}” to confirm`}>
              <input
                className={inputClass}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            {needsResearch && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 size-5"
                  checked={research}
                  onChange={(e) => setResearch(e.target.checked)}
                />
                <span>
                  {plural(impact.researchConsentStudents, "affected student")} gave research
                  consent. I have checked research retention obligations.
                </span>
              </label>
            )}
            <ErrorNote error={error} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                busy={busy}
                disabled={typed !== slug || (needsResearch && !research)}
                onClick={confirm}
              >
                Delete permanently
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}
