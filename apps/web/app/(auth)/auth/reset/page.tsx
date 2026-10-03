import type { Metadata } from "next";
import { CharacterLine, StackedShell } from "../../../../components/auth/parts";
import { EmailSchema } from "../../../../lib/authRules";
import { firstDomain } from "../guard";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = { title: "Reset your password" };

/** HANDOFF §6.5; `?expired=1` when a reset link was stale (§9). */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; expired?: string }>;
}) {
  const { email: raw, expired } = await searchParams;
  const email = EmailSchema.safeParse(raw ?? "").data;
  return (
    <StackedShell back="/auth/sign-in">
      <CharacterLine character="pip" state="hint" size={120}>
        {expired
          ? "That link has expired. Want a new one?"
          : "Happens to everyone. Want a fresh one?"}
      </CharacterLine>
      <div>
        <h1 className="font-display text-[32px] font-bold leading-[1.1] tracking-[-0.02em]">
          Reset your password
        </h1>
        <p className="mt-2 text-[17px] text-ink-muted">
          Enter your university email and we&apos;ll send you a link to set a new password.
        </p>
      </div>
      <ResetForm domain={firstDomain()} email={email} />
    </StackedShell>
  );
}
