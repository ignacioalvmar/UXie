import type { Metadata } from "next";
import Link from "next/link";
import { UxieCharacter } from "@uxie/character";
import { StackedShell, TextLink } from "../../../../components/auth/parts";
import { EmailSchema } from "../../../../lib/authRules";
import { ResendButton } from "./ResendButton";

export const metadata: Metadata = { title: "Check your inbox" };

/** HANDOFF §6.4. Also the "link expired" state (§9) with `?expired=1`. */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; expired?: string }>;
}) {
  const { email: raw, expired } = await searchParams;
  const email = EmailSchema.safeParse(raw ?? "").data ?? null;

  return (
    <StackedShell>
      <div className="mx-auto flex size-[240px] items-end justify-center overflow-hidden rounded-full bg-panel-sage">
        <UxieCharacter character="miso" size={224} decorative />
      </div>
      <h1 className="font-display text-[32px] font-bold leading-[1.1] tracking-[-0.02em]">
        {expired ? "That link has expired" : "Check your inbox"}
      </h1>
      {expired ? (
        <>
          <p className="text-[17px] text-ink-muted">
            That link has expired or was already used. If you opened it before, your email may
            already be confirmed.
          </p>
          <Link
            href="/auth/sign-in"
            className="inline-flex h-[54px] w-full items-center justify-center rounded-field bg-primary text-lg font-bold text-on-primary hover:bg-primary-hover"
          >
            Try signing in
          </Link>
          <p className="text-[17px] text-ink-muted">Still not confirmed? We can send a new link.</p>
        </>
      ) : (
        <p className="text-[17px] text-ink-muted [overflow-wrap:anywhere]">
          We sent a confirmation link to{" "}
          <strong className="text-ink">{email ?? "your university email"}</strong>. Open it on any
          device to finish setting up.
        </p>
      )}
      <p className="text-sm text-ink-subtle">It can take a minute. Check your spam folder too.</p>
      {(email || expired) && <ResendButton email={email ?? undefined} />}
      <TextLink href="/auth/sign-up">Use a different email</TextLink>
    </StackedShell>
  );
}
