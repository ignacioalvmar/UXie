import type { Metadata } from "next";
import Link from "next/link";
import { DataRightsRepo, isOpenRequest } from "@uxie/db";
import { requireUser } from "../../../lib/auth";
import { serviceDb } from "../../../lib/supabase/server";
import { signOut } from "../../(auth)/auth/actions";
import { ConsentForm, ProfileForm } from "./AccountForms";
import { DataRights } from "./DataRights";

export const metadata: Metadata = { title: "Account" };

/** /account: profile, research consent, your data (FR-8.1, FR-8.2), sessions. */
export default async function AccountPage() {
  const { user, profile } = await requireUser();
  const deletion = (await new DataRightsRepo(serviceDb()).requestsOf(user.id)).find(
    (r) => r.type === "deletion" && isOpenRequest(r),
  );
  const section = "flex flex-col gap-4 rounded-chip border-[1.5px] border-line-soft bg-surface p-5";
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Account</h1>
      <p className="text-ink-muted">
        Signed in as <strong className="text-ink">{user.email}</strong>. Your pseudonym is{" "}
        <strong className="text-ink">{profile.pseudonymId}</strong>; the instructor sees this
        instead of your email.
      </p>

      <section aria-labelledby="profile-h" className={section}>
        <h2 id="profile-h" className="font-display text-xl font-bold">
          Profile
        </h2>
        <ProfileForm
          displayName={profile.displayName ?? ""}
          projectDescription={profile.projectDescription ?? ""}
          character={profile.uxieCharacter ?? "pip"}
        />
      </section>

      <section aria-labelledby="research-h" className={section}>
        <h2 id="research-h" className="font-display text-xl font-bold">
          Research consent
        </h2>
        <ConsentForm consent={profile.researchConsent} />
        <p className="text-sm text-ink-subtle">
          See the{" "}
          <Link href="/privacy" className="font-bold text-primary underline">
            privacy notice
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="data-h" className={section}>
        <h2 id="data-h" className="font-display text-xl font-bold">
          Your data
        </h2>
        <DataRights
          openDeletion={
            deletion
              ? { status: deletion.status as "open" | "in_progress", dueAt: deletion.dueAt }
              : null
          }
        />
      </section>

      <section aria-labelledby="sessions-h" className={section}>
        <h2 id="sessions-h" className="font-display text-xl font-bold">
          Sessions
        </h2>
        <div className="flex flex-wrap gap-3">
          <form action={signOut}>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-field bg-primary px-4 font-bold text-on-primary hover:bg-primary-hover"
            >
              Sign out
            </button>
          </form>
          <form action={signOut}>
            <input type="hidden" name="scope" value="global" />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-field border-2 border-primary px-4 font-bold text-primary"
            >
              Sign out on all devices
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
