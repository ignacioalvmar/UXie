import type { Metadata } from "next";
import { Prose } from "../../components/Prose";
import { StackedShell } from "../../components/auth/parts";
import { requireUser } from "../../lib/auth";
import { serverEnv } from "../../lib/env";
import { privacyNoticeMarkdown } from "../../lib/privacyNotice";
import { OnboardingForm } from "./OnboardingForm";

export const metadata: Metadata = { title: "Welcome" };

/** FR-1.3 / FR-1.4: notice + optional research consent, then the character choice (ADR-024). */
export default async function OnboardingPage() {
  const { profile } = await requireUser({ allowOnboarding: true });
  const env = serverEnv();
  const changed =
    profile.privacyAckAt !== null && profile.privacyNoticeVersion !== env.PRIVACY_NOTICE_VERSION;
  return (
    <StackedShell>
      <h1 className="font-display text-[32px] font-bold leading-[1.1] tracking-[-0.02em]">
        {changed ? "Our privacy notice changed" : "Welcome to UXie"}
      </h1>
      <p className="text-[17px] text-ink-muted">
        {changed
          ? "Please read the updated notice and confirm before you continue."
          : "Before your first paper, here is how UXie handles your data."}
      </p>
      <section
        aria-label="Privacy notice"
        tabIndex={0}
        className="max-h-[50dvh] overflow-y-auto rounded-chip border-[1.5px] border-line-soft bg-surface p-4"
      >
        <Prose>{privacyNoticeMarkdown()}</Prose>
        <p className="mt-3 text-sm text-ink-subtle">Version {env.PRIVACY_NOTICE_VERSION}</p>
      </section>
      <OnboardingForm
        initialCharacter={profile.uxieCharacter}
        initialConsent={profile.researchConsent}
      />
    </StackedShell>
  );
}
