import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UxieCharacter } from "@uxie/character";
import { StackedShell } from "../../../../components/auth/parts";
import { safeNext } from "../../../../lib/authRules";
import { confirmEmailLink } from "../actions";
import { ConfirmButton } from "./ConfirmButton";

export const metadata: Metadata = { title: "Confirm your email" };

/**
 * Landing page of the confirmation and reset emails (ADR-031). Opening the link only renders this
 * page; the one-time token is spent by the button's POST, so mail link scanners that prefetch links
 * (e.g. Microsoft Safe Links) cannot use it up before the student clicks.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash: tokenHash, type, next } = await searchParams;
  const recovery = type === "recovery";
  if (!tokenHash || (type !== "email" && type !== "signup" && !recovery))
    redirect(recovery ? "/auth/reset?expired=1" : "/auth/verify?expired=1");

  return (
    <StackedShell>
      <div className="mx-auto flex size-[240px] items-end justify-center overflow-hidden rounded-full bg-panel-sage">
        <UxieCharacter character="miso" size={224} decorative />
      </div>
      <h1 className="font-display text-[32px] font-bold leading-[1.1] tracking-[-0.02em]">
        {recovery ? "Reset your password" : "Confirm your email"}
      </h1>
      <p className="text-[17px] text-ink-muted">
        {recovery
          ? "One more step: continue to choose a new password."
          : "One more step: confirm it's you to finish setting up your account."}
      </p>
      <form action={confirmEmailLink}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={recovery ? "recovery" : "email"} />
        <input type="hidden" name="next" value={safeNext(next ?? null, "/onboarding")} />
        <ConfirmButton recovery={recovery} />
      </form>
    </StackedShell>
  );
}
