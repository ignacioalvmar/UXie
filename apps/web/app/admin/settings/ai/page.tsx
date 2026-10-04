import type { Metadata } from "next";
import { effectiveSettings } from "../../../../lib/llmSettings";
import { settingsView } from "../../../../lib/settingsView";
import { SettingsForm } from "./SettingsForm";

export const metadata: Metadata = { title: "AI provider settings" };

/** FR-9.6 / FR-9.7 (ADR-020). The admin layout already restricted this to instructors. */
export default async function AiSettingsPage() {
  const view = settingsView(await effectiveSettings({ fresh: true }));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">
          AI provider settings
        </h1>
        <p className="text-ink-muted">
          {view.saved
            ? `Saved on this page (${new Date(view.updatedAt!).toLocaleString("en-GB")}). These settings override the server environment.`
            : "Currently taken from the server environment. Saving here overrides it."}
        </p>
      </div>
      <SettingsForm view={view} />
    </div>
  );
}
