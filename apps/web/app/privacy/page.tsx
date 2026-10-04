import type { Metadata } from "next";
import { Prose } from "../../components/Prose";
import { StackedShell } from "../../components/auth/parts";
import { serverEnv } from "../../lib/env";
import { privacyNoticeMarkdown } from "../../lib/privacyNotice";

export const metadata: Metadata = { title: "Privacy notice" };
export const dynamic = "force-dynamic";

/** Public privacy notice (footer link on every auth screen). */
export default function PrivacyPage() {
  return (
    <StackedShell back="/auth/sign-in">
      <Prose>{privacyNoticeMarkdown()}</Prose>
      <p className="text-sm text-ink-subtle">Version {serverEnv().PRIVACY_NOTICE_VERSION}</p>
    </StackedShell>
  );
}
