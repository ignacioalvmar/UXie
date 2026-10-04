import "server-only";
import { needsOnboarding, type Profile } from "@uxie/db";
import { accounts, currentUser, type SessionUser } from "./auth";
import { jsonError } from "./chat/turn";
import { serverEnv } from "./env";

/**
 * Guards for JSON API routes (PRD §11): errors are `{ code, message }`, never redirects.
 * Students must be signed in, verified (FR-1.2) and onboarded (FR-1.3) before any chat access.
 */
export async function apiUser(): Promise<{ user: SessionUser; profile: Profile } | Response> {
  const user = await currentUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  if (!user.emailConfirmed) return jsonError(403, "email_unverified", "Please verify your email.");
  const profile = await accounts().getProfile(user.id);
  if (needsOnboarding(profile, serverEnv().PRIVACY_NOTICE_VERSION))
    return jsonError(403, "onboarding_required", "Please read the privacy notice first.");
  return { user, profile };
}

/** CSRF defence for mutations (NFR-9): same-site cookies plus this Origin check. */
export function crossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null; // same-origin fetches from older browsers; cookies are SameSite=Lax
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    if (new URL(origin).host === host) return null;
  } catch {
    // Malformed Origin header.
  }
  return jsonError(403, "forbidden", "Cross-origin request refused.");
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Postgres `uuid` shape (any version/variant: seeded ids are not RFC 4122 v4). */
export const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
