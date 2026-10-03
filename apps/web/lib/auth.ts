import "server-only";
import { notFound, redirect } from "next/navigation";
import { AccountsRepo, needsOnboarding, type Profile } from "@uxie/db";
import { serverEnv } from "./env";
import { serviceDb, userClient } from "./supabase/server";

export interface SessionUser {
  id: string;
  email: string;
  emailConfirmed: boolean;
}

/** The signed-in user, verified with the Auth server (not just the cookie), or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return null;
  return { id: u.id, email: u.email ?? "", emailConfirmed: Boolean(u.email_confirmed_at) };
}

export const accounts = () => new AccountsRepo(serviceDb());

/**
 * Guard for student pages: signed in, email verified (FR-1.2) and, unless `allowOnboarding`,
 * the current privacy notice acknowledged (FR-1.3).
 */
export async function requireUser(
  opts: { allowOnboarding?: boolean; next?: string } = {},
): Promise<{ user: SessionUser; profile: Profile }> {
  const user = await currentUser();
  if (!user) {
    const next = opts.next ? `?next=${encodeURIComponent(opts.next)}` : "";
    redirect(`/auth/sign-in${next}`);
  }
  if (!user.emailConfirmed) redirect(`/auth/verify?email=${encodeURIComponent(user.email)}`);
  const profile = await accounts().getProfile(user.id);
  if (!opts.allowOnboarding && needsOnboarding(profile, serverEnv().PRIVACY_NOTICE_VERSION)) {
    redirect("/onboarding");
  }
  return { user, profile };
}

/** FR-1.6: /admin/* for instructors only; everyone else gets a 404 (existence not revealed). */
export async function requireInstructor(): Promise<{ user: SessionUser; profile: Profile }> {
  const user = await currentUser();
  if (!user || !user.emailConfirmed) notFound();
  const profile = await accounts().getProfile(user.id);
  if (profile.role !== "instructor") notFound();
  return { user, profile };
}
