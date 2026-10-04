"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * FR-8.1 / FR-8.2 on /account: download everything as JSON, ask for deletion (≤ 30 days, with
 * the exceptions explained), or withdraw an open request.
 */

const primary =
  "inline-flex min-h-11 items-center rounded-field bg-primary px-4 font-bold text-on-primary hover:bg-primary-hover disabled:opacity-50";
const secondary =
  "inline-flex min-h-11 items-center rounded-field border-2 border-primary px-4 font-bold text-primary disabled:opacity-50";
const danger =
  "inline-flex min-h-11 items-center rounded-field bg-danger px-4 font-bold text-white hover:bg-danger-ink disabled:opacity-50";

export function DataRights({
  openDeletion,
}: {
  openDeletion: { status: "open" | "in_progress"; dueAt: string } | null;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (confirming && !d.open) d.showModal();
    if (!confirming && d.open) d.close();
  }, [confirming]);

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/me/deletion-request", { method });
      if (!res.ok) throw new Error();
      setMessage(
        method === "POST"
          ? "Your deletion request was sent."
          : "Your deletion request was withdrawn.",
      );
      setConfirming(false);
      router.refresh();
    } catch {
      setMessage("That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const due = openDeletion
    ? new Date(openDeletion.dueAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p>
          Download a copy of everything UXie stores about you: profile (with your email),
          conversations, messages, feedback and your data requests, as a JSON file.
        </p>
        <div>
          <a href="/api/me/export" className={primary} download>
            Download my data
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        {openDeletion ? (
          <>
            <p>
              <strong>Your account is scheduled for deletion</strong>
              {openDeletion.status === "in_progress" ? " and the instructor is processing it" : ""}.
              It will be deleted by {due} at the latest, and you will get an email when it is done.
            </p>
            {openDeletion.status === "open" && (
              <div>
                <button
                  type="button"
                  className={secondary}
                  disabled={busy}
                  onClick={() => call("DELETE")}
                >
                  Withdraw my deletion request
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p>
              Deleting your account removes your login, profile, conversations and feedback. The
              instructor completes it within 30 days.
            </p>
            <div>
              <button type="button" className={secondary} onClick={() => setConfirming(true)}>
                Delete my account…
              </button>
            </div>
          </>
        )}
        <p role="status" aria-live="polite" className="min-h-6 text-sm">
          {message}
        </p>
      </div>

      <dialog
        ref={dialog}
        onClose={() => setConfirming(false)}
        aria-labelledby="delete-account-title"
        className="m-auto w-[min(560px,calc(100vw-32px))] rounded-hero bg-surface p-0 text-ink backdrop:bg-scrim"
      >
        <div className="flex flex-col gap-4 p-6">
          <h2 id="delete-account-title" className="font-display text-xl font-bold">
            Delete your account?
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              The instructor deletes your account within 30 days; you can keep using UXie until
              then.
            </li>
            <li>
              Your login, profile, conversations, messages, feedback and usage records are removed.
            </li>
            <li>
              Kept: your pseudonym and the deletion date in a deletion register (so the deletion is
              repeated if a backup is restored), and cost totals that no longer link to you.
            </li>
            <li>
              Research exports made earlier with your consent may still contain pseudonymous copies
              of your conversations.
            </li>
            <li>Download your data first if you want a copy.</li>
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondary} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className={danger} disabled={busy} onClick={() => call("POST")}>
              Request deletion
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
