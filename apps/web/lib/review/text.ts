/** Wording shared by the data-rights pages and routes (FR-8.2, FR-8.3). Pure. */

export const DELETION_DAYS = 30;

export function deletionConfirmationMail(input: {
  pseudonymId: string;
  deletedAt: Date;
  appUrl: string;
}) {
  const date = input.deletedAt.toISOString().slice(0, 10);
  return {
    subject: "Your UXie account has been deleted",
    text: [
      "Hello,",
      "",
      `as you requested, your UXie account (pseudonym ${input.pseudonymId}) was deleted on ${date}.`,
      "Your profile, conversations, messages, feedback and usage records have been removed.",
      "",
      "What we keep: the pseudonym and the deletion date in a deletion register, so that the",
      "deletion is applied again if a backup is ever restored, and cost totals of model calls",
      "that no longer link to you. Research exports made before the deletion may still contain",
      "pseudonymous copies of your conversations; they cannot be linked back to you.",
      "",
      `Questions: see the privacy notice at ${input.appUrl}/privacy.`,
      "",
      "UXie",
    ].join("\n"),
  };
}

/** Manual fallback when SMTP is not configured: a prepared mail in the instructor's client. */
export const mailtoLink = (to: string, mail: { subject: string; text: string }) =>
  `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.text)}`;

/** "due in 3 days" / "overdue by 2 days" for the request list. */
export function dueLabel(dueAt: string, now = new Date()): { text: string; overdue: boolean } {
  const days = Math.ceil((new Date(dueAt).getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return { text: `overdue by ${-days} day${days === -1 ? "" : "s"}`, overdue: true };
  if (days === 0) return { text: "due today", overdue: false };
  return { text: `due in ${days} day${days === 1 ? "" : "s"}`, overdue: false };
}

/** Admin "Overview": RETENTION_REVIEW_DATE reminder (FR-8.4). */
export function retentionReminder(date: string | undefined, now = new Date()) {
  if (!date) return null;
  const days = Math.ceil((Date.parse(`${date}T00:00:00Z`) - now.getTime()) / 86_400_000);
  if (days > 30) return null;
  return days < 0
    ? `The retention review was due on ${date}. Decide what to purge with \`pnpm uxie purge --before <date> --dry-run\`.`
    : `Retention review due on ${date} (in ${days} day${days === 1 ? "" : "s"}).`;
}
