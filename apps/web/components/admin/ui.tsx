"use client";

import { useEffect, useRef, type ReactNode } from "react";

export { dateTime, inputClass } from "../../lib/admin/format";

/**
 * Small building blocks for the instructor pages (FR-6.x). Same tokens as the student UI;
 * 44 px minimum targets (§2.5); errors are announced (`role="alert"`), progress politely.
 */

export interface ApiFailure {
  code: string;
  message: string;
  issues?: { path: string; message: string }[];
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

/** JSON request to an admin route; errors come back as `{ code, message, issues? }` (PRD §11). */
export async function api<T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    if (res.status === 204) return { ok: true, data: undefined as T };
    const json = (await res.json().catch(() => null)) as unknown;
    if (res.ok) return { ok: true, data: json as T };
    const err = json as Partial<ApiFailure> | null;
    return {
      ok: false,
      error: {
        code: err?.code ?? `http_${res.status}`,
        message: err?.message ?? `Request failed (${res.status}).`,
        ...(err?.issues ? { issues: err.issues } : {}),
      },
    };
  } catch {
    return { ok: false, error: { code: "network_error", message: "Network error. Try again." } };
  }
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover disabled:bg-primary/50",
  secondary:
    "border-[1.5px] border-primary bg-surface text-primary hover:text-primary-hover disabled:opacity-50",
  danger: "bg-danger text-white hover:bg-danger-ink disabled:opacity-50",
  ghost: "text-primary hover:bg-panel disabled:opacity-50",
};

export function Button({
  variant = "secondary",
  busy = false,
  className = "",
  children,
  ...props
}: {
  variant?: Variant;
  busy?: boolean;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-field px-4 font-bold transition-colors disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      )}
      {children}
    </button>
  );
}

const TONE = {
  neutral: "bg-panel text-ink",
  success: "bg-success-bg text-success-ink",
  warning: "bg-cite-bg text-ink",
  danger: "bg-danger-bg text-danger-ink",
  info: "bg-surface text-primary border border-primary/40",
};
export type Tone = keyof typeof TONE;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-sm font-bold whitespace-nowrap ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  published: "success",
  archived: "warning",
  retired: "warning",
  uploading: "info",
  processing: "info",
  ready: "info",
  failed: "danger",
  superseded: "neutral",
  approved: "success",
  queued: "info",
  running: "info",
  succeeded: "success",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label ?? capitalize(status)}</Badge>;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Card({
  title,
  id,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  id?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={title && id ? id : undefined}
      className={`flex flex-col gap-4 rounded-chip border-[1.5px] border-line-soft bg-surface p-5 ${className}`}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title && (
            <h2 id={id} className="font-display text-xl font-bold">
              {title}
            </h2>
          )}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-bold">{label}</span>
      {children}
      {hint && <span className="text-sm text-ink-muted">{hint}</span>}
    </label>
  );
}

/** An error message that takes focus when it appears, so keyboard users hear it. */
export function ErrorNote({ error }: { error: ApiFailure | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="rounded-alert border-[1.5px] border-danger-line bg-danger-bg p-3 text-danger-ink outline-none"
    >
      <p className="font-bold">{error.message}</p>
      {error.issues?.length ? (
        <ul className="mt-1 list-disc pl-5 text-sm text-ink">
          {error.issues.slice(0, 12).map((i, n) => (
            <li key={n}>
              <code>{i.path}</code>: {i.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Polite status line (upload progress, saved, moved). */
export function LiveNote({ children }: { children: ReactNode }) {
  return (
    <p role="status" aria-live="polite" className="min-h-6 text-sm text-ink-muted">
      {children}
    </p>
  );
}

/** Native modal dialog (focus containment, Esc, focus return), as in the student UI (ADR-026). */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="admin-dialog-title"
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-hero bg-surface p-0 text-ink backdrop:bg-scrim"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id="admin-dialog-title" className="font-display text-xl font-bold">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

/** Same rule as the server's slugs: lowercase words joined by single dashes, max 60 chars. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}
