import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNext } from "../../../../lib/authRules";
import { userClient } from "../../../../lib/supabase/server";

/**
 * Landing route of the confirmation and reset links (HANDOFF §6.4, §6.5). Supports both the PKCE
 * `?code=` flow and `?token_hash=&type=` email templates. Failure → the "link expired" states.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const rawNext = url.searchParams.get("next");
  // safeNext() refuses /auth/* targets, so the reset flow is recognised before it.
  const resetFlow = rawNext === "/auth/reset/update" || url.searchParams.get("type") === "recovery";
  const next = safeNext(rawNext, "/onboarding");
  const supabase = await userClient();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing code") };

  const target = url.clone();
  target.search = "";
  if (error) {
    target.pathname = resetFlow ? "/auth/reset" : "/auth/verify";
    target.searchParams.set("expired", "1");
  } else {
    target.pathname = resetFlow ? "/auth/reset/update" : next;
  }
  return NextResponse.redirect(target);
}
