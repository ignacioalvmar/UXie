import "server-only";
import { AdminRepo, type ContentResult, type Profile, type Refusal } from "@uxie/db";
import { accounts, currentUser, type SessionUser } from "../auth";
import { jsonError } from "../chat/turn";
import { serviceDb } from "../supabase/server";

/**
 * Guard for /api/admin/* (PRD §11: admin routes enforce is_instructor()). Anyone else gets the
 * same 404 as the pages (FR-1.6: existence not revealed).
 */
export async function apiInstructor(): Promise<
  { user: SessionUser; profile: Profile; repo: AdminRepo } | Response
> {
  const user = await currentUser();
  if (!user || !user.emailConfirmed) return jsonError(404, "not_found", "Not found.");
  const profile = await accounts().getProfile(user.id);
  if (profile.role !== "instructor") return jsonError(404, "not_found", "Not found.");
  return { user, profile, repo: new AdminRepo(serviceDb()) };
}

export const REFUSAL_STATUS: Record<Refusal, number> = {
  not_found: 404,
  version_locked: 409,
  version_not_ready: 409,
  guide_missing: 409,
  guide_invalid: 422,
  guide_changed: 409,
  guide_not_approved: 409,
  job_running: 409,
};

/** A content rule result as JSON: the payload on success, `{ code, message, issues? }` otherwise. */
export function contentResponse<T extends object>(
  result: ContentResult<T>,
  toBody: (r: T) => unknown,
): Response {
  if (result.ok) return Response.json(toBody(result));
  return Response.json(
    {
      code: result.code,
      message: result.message,
      ...(result.issues ? { issues: result.issues } : {}),
    },
    { status: REFUSAL_STATUS[result.code] },
  );
}

/** Postgres unique violation → 409 with a readable message (slugs). */
export function uniqueViolation(e: unknown, what: string): Response | null {
  if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "23505")
    return jsonError(409, "slug_taken", `This ${what} slug is already in use.`);
  return null;
}
