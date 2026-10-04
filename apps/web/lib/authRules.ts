import { z } from "zod";

/** Pure auth rules shared by server actions and tests (FR-1.1, HANDOFF §6). */

export const MIN_PASSWORD = 10;

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

/** Empty allow-list = any domain (development only; production requires a list, env.ts). */
export function isAllowedEmail(email: string, allowed: readonly string[]): boolean {
  if (!allowed.length) return true;
  return allowed.includes(emailDomain(email));
}

/** Only same-origin relative paths; anything else falls back to "/" (open-redirect guard). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\"))
    return fallback;
  if (next.startsWith("/auth/")) return fallback;
  return next;
}

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const SignInSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

export const SignUpSchema = z.object({
  email: EmailSchema,
  password: z.string().max(200),
  inviteCode: z.string().trim().max(100).optional(),
});

/** "f•••@thi.de" for the verify screen (HANDOFF §6.4). */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return local ? `${local[0]}•••@${domain}` : email;
}

export type AuthFailure =
  | "domain"
  | "credentials"
  | "unverified"
  | "rate_limited"
  | "network"
  | "password_short"
  | "password_leaked"
  | "password_same"
  | "invite";

/** Map a Supabase Auth error to a UI condition. Never reveals which credential was wrong. */
export function classifyAuthError(err: {
  code?: string;
  status?: number;
  message?: string;
}): AuthFailure {
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  if (err.status === 429 || code === "over_request_rate_limit" || code.includes("rate_limit"))
    return "rate_limited";
  if (code === "email_not_confirmed") return "unverified";
  if (code === "same_password") return "password_same";
  if (code === "weak_password")
    return msg.includes("pwned") || msg.includes("breach") || msg.includes("leaked")
      ? "password_leaked"
      : "password_short";
  if (msg.includes("university email") || err.status === 403) return "domain";
  if (code === "invalid_credentials" || err.status === 400) return "credentials";
  return "network";
}
