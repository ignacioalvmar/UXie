import type { Metadata } from "next";
import { StackedShell } from "../../../../components/auth/parts";
import { serverEnv } from "../../../../lib/env";
import { firstDomain, redirectIfSignedIn } from "../guard";
import { SignUpForm } from "./SignUpForm";

export const metadata: Metadata = { title: "Create your account" };

/** HANDOFF §6.3, FR-1.1. */
export default async function SignUpPage() {
  await redirectIfSignedIn();
  return (
    <StackedShell back="/auth/sign-in">
      <div>
        <h1 className="font-display text-[32px] font-bold leading-[1.1] tracking-[-0.02em]">
          Create your account
        </h1>
        <p className="mt-2 text-[17px] text-ink-muted">For students enrolled in the course.</p>
      </div>
      <SignUpForm
        domain={firstDomain()}
        inviteRequired={Boolean(serverEnv().REGISTRATION_INVITE_CODE)}
      />
    </StackedShell>
  );
}
