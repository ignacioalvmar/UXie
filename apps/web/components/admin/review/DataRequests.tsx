"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  api,
  Badge,
  Button,
  dateTime,
  Dialog,
  ErrorNote,
  inputClass,
  type ApiFailure,
} from "../ui";

/** FR-8.2 / FR-8.3: open requests with due dates; mark in progress, reject, or complete a deletion. */

export interface RequestView {
  id: string;
  pseudonymId: string;
  type: "access" | "deletion";
  status: "open" | "in_progress" | "completed" | "rejected";
  notes: string | null;
  createdAt: string;
  dueAt: string;
  completedAt: string | null;
  due: { text: string; overdue: boolean };
}

type Completed = { confirmation: "sent" | "not_configured" | "failed"; mailto?: string };

export function DataRequestRow({ r }: { r: RequestView }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"complete" | "reject" | null>(null);
  const [typed, setTyped] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [done, setDone] = useState<Completed | null>(null);
  const status = done ? "completed" : r.status;
  const open = status === "open" || status === "in_progress";

  async function patch(body: object) {
    setBusy(true);
    setError(null);
    const res = await api<Completed>(`/api/admin/data-requests/${r.id}`, { method: "PATCH", body });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    return res.data;
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{r.pseudonymId}</span>
        <Badge tone={r.type === "deletion" ? "warning" : "neutral"}>
          {r.type === "deletion" ? "Deletion" : "Data download"}
        </Badge>
        <Badge
          tone={status === "completed" ? "success" : status === "rejected" ? "neutral" : "info"}
        >
          {status.replace("_", " ")}
        </Badge>
        {open && <Badge tone={r.due.overdue ? "danger" : "neutral"}>{r.due.text}</Badge>}
      </div>
      <p className="text-sm text-ink-muted">
        Requested {dateTime(r.createdAt)}
        {open
          ? ` · due ${dateTime(r.dueAt)}`
          : r.completedAt
            ? ` · closed ${dateTime(r.completedAt)}`
            : ""}
        {r.notes ? ` · ${r.notes}` : ""}
      </p>
      {open && r.type === "deletion" && !done && (
        <div className="flex flex-wrap gap-2">
          {status === "open" && (
            <Button
              busy={busy}
              onClick={async () => {
                if (await patch({ action: "in_progress" })) router.refresh();
              }}
            >
              Mark in progress
            </Button>
          )}
          <Button variant="danger" onClick={() => setDialog("complete")}>
            Delete account…
          </Button>
          <Button variant="ghost" onClick={() => setDialog("reject")}>
            Reject…
          </Button>
        </div>
      )}
      {done && (
        <div role="status" className="rounded-alert bg-success-bg p-3 text-success-ink">
          <p className="font-bold">Account deleted and recorded in the deletion register.</p>
          {done.confirmation === "sent" ? (
            <p>The confirmation email was sent.</p>
          ) : (
            <p>
              The confirmation email could not be sent automatically
              {done.confirmation === "not_configured" ? " (SMTP is not configured)" : ""}.{" "}
              {done.mailto && (
                <a href={done.mailto} className="font-bold underline">
                  Open it in your mail program
                </a>
              )}
            </p>
          )}
        </div>
      )}
      {!dialog && <ErrorNote error={error} />}

      {dialog === "complete" && (
        <Dialog
          open
          onClose={() => setDialog(null)}
          title={`Delete the account of ${r.pseudonymId}?`}
        >
          <p>
            This permanently deletes the student’s login, profile, conversations, messages,
            feedback, usage and events. The pseudonym goes into the deletion register so the
            deletion is re-applied after a backup restore. Model-cost totals stay without a link to
            the student. Exports made earlier are not affected.
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-bold">Type the pseudonym {r.pseudonymId} to confirm</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className={inputClass}
            />
          </label>
          <ErrorNote error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              busy={busy}
              disabled={typed.trim() !== r.pseudonymId}
              onClick={async () => {
                const res = await patch({ action: "complete", confirmPseudonym: typed.trim() });
                if (res) {
                  // No refresh here: the row would move to "Closed" and lose this notice (and the
                  // mailto fallback). The list refreshes on the next visit.
                  setDone(res);
                  setDialog(null);
                }
              }}
            >
              Delete permanently
            </Button>
          </div>
        </Dialog>
      )}

      {dialog === "reject" && (
        <Dialog open onClose={() => setDialog(null)} title="Reject the request">
          <p>
            Give the reason (for example a legal retention obligation). Tell the student; the reason
            is stored with the request.
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-bold">Reason</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              className={inputClass}
            />
          </label>
          <ErrorNote error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={notes.trim().length < 3}
              onClick={async () => {
                if (await patch({ action: "reject", notes })) {
                  setDialog(null);
                  router.refresh();
                }
              }}
            >
              Reject request
            </Button>
          </div>
        </Dialog>
      )}
    </li>
  );
}
