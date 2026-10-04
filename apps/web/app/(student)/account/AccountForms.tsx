"use client";

import { useActionState } from "react";
import { PrimaryButton } from "../../../components/auth/fields";
import { saveConsent, saveProfile, type AccountState } from "./actions";

const field =
  "w-full rounded-field border-[1.5px] border-line bg-surface px-4 py-3 text-[17px] text-ink";

export function ProfileForm(props: {
  displayName: string;
  projectDescription: string;
  character: string;
}) {
  const [state, action] = useActionState<AccountState, FormData>(saveProfile, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="font-bold">Display name (optional)</span>
        <input
          name="displayName"
          maxLength={80}
          defaultValue={props.displayName}
          className={`${field} h-[50px]`}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-bold">Your project</span>
        <span className="text-sm text-ink-subtle" id="project-hint">
          In Apply mode UXie uses this to relate papers to what you are building. Up to 1,500
          characters.
        </span>
        <textarea
          name="projectDescription"
          maxLength={1500}
          rows={5}
          defaultValue={props.projectDescription}
          aria-describedby="project-hint"
          className={field}
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold">Your UXie</legend>
        <div className="flex gap-4">
          {(["pip", "miso", "luma"] as const).map((c) => (
            <label key={c} className="inline-flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="character"
                value={c}
                defaultChecked={props.character === c}
              />
              <span className="capitalize">{c}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="max-w-xs">
        <PrimaryButton pendingLabel="Saving…">Save</PrimaryButton>
      </div>
      <p aria-live="polite" className="min-h-6 text-sm">
        {state.saved === "profile" ? "Saved." : (state.error ?? "")}
      </p>
    </form>
  );
}

export function ConsentForm({ consent }: { consent: boolean }) {
  const [state, action] = useActionState<AccountState, FormData>(saveConsent, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex items-start gap-3 text-[17px]">
        <input
          type="checkbox"
          name="researchConsent"
          defaultChecked={consent}
          className="mt-1 size-5"
        />
        <span>
          Pseudonymous copies of my conversations may be used for research on teaching. Withdrawing
          excludes you from future research exports and does not affect your access to UXie.
        </span>
      </label>
      <div className="max-w-xs">
        <PrimaryButton pendingLabel="Saving…">Save research choice</PrimaryButton>
      </div>
      <p aria-live="polite" className="min-h-6 text-sm">
        {state.saved === "consent" ? "Saved." : ""}
      </p>
    </form>
  );
}
