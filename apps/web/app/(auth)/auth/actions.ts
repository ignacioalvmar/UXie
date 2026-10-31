"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { needsOnboarding } from "@uxie/db";
import { accounts } from "../../../lib/auth";
import {
  classifyAuthError,
  EmailSchema,
  isAllowedEmail,
  passwordFailure,
  safeNext,
  SignInSchema,
  SignUpSchema,
  type AuthFailure,
} from "../../../lib/authRules";
import { serverEnv } from "../../../lib/env";
import { userClient } from "../../../lib/supabase/server";

export interface AuthFormState {
  failure?: AuthFailure;
  email?: string;
  sent?: boolean;
}

const callbackUrl = (next?: string) =>
  `${serverEnv().APP_URL}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;

/** HANDOFF §6.1–6.2. */
export async function signIn(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = SignInSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    next: form.get("next") ?? undefined,
  });
  const email = String(form.get("email") ?? "");
  if (!parsed.success) return { failure: "credentials", email };
  const env = serverEnv();
  if (!isAllowedEmail(parsed.data.email, env.ALLOWED_EMAIL_DOMAINS))
    return { failure: "domain", email };

  const supabase = await userClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    const failure = classifyAuthError(error);
    if (failure === "unverified")
      redirect(`/auth/verify?email=${encodeURIComponent(parsed.data.email)}`);
    return { failure: failure === "domain" ? "credentials" : failure, email };
  }
  const profile = await accounts().getProfile(data.user.id);
  if (needsOnboarding(profile, env.PRIVACY_NOTICE_VERSION)) redirect("/onboarding");
  redirect(safeNext(parsed.data.next));
}

/** HANDOFF §6.3. An already registered address is not revealed: it goes to verify as well. */
export async function signUp(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = String(form.get("email") ?? "");
  const parsed = SignUpSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    inviteCode: form.get("inviteCode") ?? undefined,
  });
  if (!parsed.success) return { failure: "domain", email };
  const env = serverEnv();
  if (!isAllowedEmail(parsed.data.email, env.ALLOWED_EMAIL_DOMAINS))
    return { failure: "domain", email };
  const weak = passwordFailure(parsed.data.password);
  if (weak) return { failure: weak, email };
  if (env.REGISTRATION_INVITE_CODE && parsed.data.inviteCode !== env.REGISTRATION_INVITE_CODE)
    return { failure: "invite", email };

  const supabase = await userClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: callbackUrl("/onboarding") },
  });
  if (error) {
    const failure = classifyAuthError(error);
    if (failure === "network" || failure === "email_send")
      // Unexpected Supabase errors otherwise vanish behind the generic banner (no address logged).
      console.error("sign-up failed", {
        status: error.status,
        code: error.code,
        message: error.message,
      });
    if (
      failure === "password_short" ||
      failure === "password_weak" ||
      failure === "password_leaked" ||
      failure === "rate_limited" ||
      failure === "domain" ||
      failure === "email_send" ||
      failure === "network"
    )
      return { failure, email };
  }
  if (data?.user && !data.user.identities?.length) {
    // Existing account: Supabase returns an obfuscated user; behave exactly as for a new one.
  } else if (data?.user) {
    await accounts()
      .logEvent("registered", data.user.id)
      .catch(() => {});
  }
  redirect(`/auth/verify?email=${encodeURIComponent(parsed.data.email)}`);
}

const ConfirmLinkSchema = z.object({
  token_hash: z.string().min(1).max(500),
  type: z.enum(["email", "recovery"]),
  next: z.string().optional(),
});

/** POST from /auth/confirm (ADR-031): spends the email's one-time token, then continues. */
export async function confirmEmailLink(form: FormData) {
  const parsed = ConfirmLinkSchema.safeParse({
    token_hash: form.get("token_hash"),
    type: form.get("type"),
    next: form.get("next") ?? undefined,
  });
  const recovery = form.get("type") === "recovery";
  if (!parsed.success) redirect(recovery ? "/auth/reset?expired=1" : "/auth/verify?expired=1");
  const supabase = await userClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: parsed.data.token_hash,
    type: parsed.data.type,
  });
  if (error) redirect(recovery ? "/auth/reset?expired=1" : "/auth/verify?expired=1");
  redirect(recovery ? "/auth/reset/update" : safeNext(parsed.data.next, "/onboarding"));
}

/** HANDOFF §6.4 "Resend email". */
export async function resendVerification(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const parsed = EmailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { failure: "network" };
  const supabase = await userClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data,
    options: { emailRedirectTo: callbackUrl("/onboarding") },
  });
  if (error && classifyAuthError(error) === "rate_limited") return { failure: "rate_limited" };
  return { sent: true };
}

/** HANDOFF §6.5: always the same confirmation (no account enumeration). */
export async function requestReset(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = EmailSchema.safeParse(form.get("email"));
  const email = String(form.get("email") ?? "");
  if (!parsed.success) return { failure: "domain", email };
  if (!isAllowedEmail(parsed.data, serverEnv().ALLOWED_EMAIL_DOMAINS))
    return { failure: "domain", email };
  const supabase = await userClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: callbackUrl("/auth/reset/update"),
  });
  return { sent: true, email };
}

/** "Set new password" after the reset link (HANDOFF §9). */
export async function updatePassword(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const weak = passwordFailure(password);
  if (weak) return { failure: weak };
  if (password !== confirm) return { failure: "credentials" };
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/auth/reset?expired=1");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const failure = classifyAuthError(error);
    return {
      failure:
        failure === "password_leaked" ||
        failure === "password_same" ||
        failure === "password_short" ||
        failure === "password_weak"
          ? failure
          : "network",
    };
  }
  redirect("/");
}

/** FR-1.2: sign out here, or everywhere (all sessions). */
export async function signOut(form: FormData) {
  const supabase = await userClient();
  await supabase.auth.signOut({ scope: form.get("scope") === "global" ? "global" : "local" });
  redirect("/auth/sign-in");
}
