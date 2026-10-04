import type { Mode } from "@uxie/core";

/** Display labels and small formatters shared by the student pages. Browser-safe. */

export const MODE_LABEL: Record<Mode, string> = {
  understand: "Understand",
  apply: "Apply to UX",
  critique: "Critique",
  build: "Build",
};

/** "Just now", "12 minutes ago", "Yesterday", "3 days ago", "Last week", else a date. */
export function relativeTime(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso);
  const minutes = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days === 0) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Local "HH:MM" and "in X h Y min" for limit reset times (workspace handoff §4.7). */
export function resetTime(iso: string, now = new Date()) {
  const at = new Date(iso);
  const clock = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const mins = Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return { clock, inText: h ? `${h} h ${m} min` : `${m} min` };
}
