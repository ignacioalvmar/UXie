/**
 * Pure helpers shared by the instructor pages. Not in components/admin/ui.tsx: that module is
 * "use client", so server components could not call these.
 */

export const inputClass =
  "min-h-11 w-full rounded-field border-[1.5px] border-line bg-surface px-3 text-base text-ink placeholder:text-placeholder";

export const dateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "–";
