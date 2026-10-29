import { z } from "zod";

/** Pure auth rules shared by server actions and tests (FR-1.1, HANDOFF §6). */

export const MIN_PASSWORD = 10;

/** Supabase's symbol set for `password_requirements = "lower_upper_letters_digits_symbols"`. */
const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

/** Mirrors the hosted Supabase Auth policy, so the form shows every rule the server enforces. */
export const PASSWORD_RULES = [
  {
    id: "length",
    label: `At least ${MIN_PASSWORD} characters`,
    test: (p: string) => p.length >= MIN_PASSWORD,
  },
  { id: "lower", label: "A lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { id: "upper", label: "An uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { id: "digit", label: "A number", test: (p: string) => /[0-9]/.test(p) },
  {
    id: "symbol",
    label: "A special character, e.g. ! ? # $ %",
    test: (p: string) => [...p].some((c) => PASSWORD_SYMBOLS.includes(c)),
  },
] as const;

/** The first unmet rule, mapped to a failure: length first, then character classes. */
export function passwordFailure(password: string): "password_short" | "password_weak" | null {
  const unmet = PASSWORD_RULES.find((r) => !r.test(password));
  if (!unmet) return null;
  return unmet.id === "length" ? "password_short" : "password_weak";
}

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
  | "password_weak"
  | "password_leaked"
  | "password_same"
  | "invite"
  | "email_send";

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
  if (code === "weak_password") {
    if (msg.includes("pwned") || msg.includes("breach") || msg.includes("leaked"))
      return "password_leaked";
    return msg.includes("at least one character") ? "password_weak" : "password_short";
  }
  // Supabase rolls the sign-up back when its mailer (SMTP) fails.
  if (msg.includes("sending") && msg.includes("email")) return "email_send";
  if (msg.includes("university email") || err.status === 403) return "domain";
  if (code === "invalid_credentials" || err.status === 400) return "credentials";
  return "network";
}
