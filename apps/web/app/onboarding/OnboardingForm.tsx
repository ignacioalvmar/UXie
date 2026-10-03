"use client";

import { useActionState, useState } from "react";
import { UxieCharacter, type CharacterId } from "@uxie/character";
import { FormAlert, PrimaryButton } from "../../components/auth/fields";
import { completeOnboarding, type OnboardingState } from "./actions";

const CHARACTERS: { id: CharacterId; name: string; blurb: string }[] = [
  { id: "pip", name: "Pip", blurb: "Quick and curious" },
  { id: "miso", name: "Miso", blurb: "Calm and patient" },
  { id: "luma", name: "Luma", blurb: "Bright and playful" },
];

export function OnboardingForm({
  initialCharacter,
  initialConsent,
}: {
  initialCharacter: CharacterId | null;
  /** An existing research consent stays ticked when a changed notice is re-acknowledged. */
  initialConsent: boolean;
}) {
  const [state, action] = useActionState<OnboardingState, FormData>(completeOnboarding, {});
  const [character, setCharacter] = useState<CharacterId | null>(initialCharacter);

  return (
    <form action={action} className="flex flex-col gap-6">
      {state.error === "acknowledge" && (
        <FormAlert title="One more step">
          Please confirm that you have read the privacy notice.
        </FormAlert>
      )}
      {state.error === "character" && (
        <FormAlert title="One more step">Pick the UXie you'd like to study with.</FormAlert>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-display text-2xl font-bold">Choose your UXie</legend>
        <p className="text-[15px] text-ink-muted">
          All three teach the same way. You can change this later.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {CHARACTERS.map((c) => (
            <label
              key={c.id}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-chip border-2 bg-surface p-3 text-center has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
                character === c.id ? "border-primary" : "border-line-soft"
              }`}
            >
              <input
                type="radio"
                name="character"
                value={c.id}
                checked={character === c.id}
                onChange={() => setCharacter(c.id)}
                className="sr-only"
              />
              <UxieCharacter
                character={c.id}
                state={character === c.id ? "celebrate" : "idle"}
                size={72}
                decorative
              />
              <span className="font-bold">{c.name}</span>
              <span className="text-sm text-ink-subtle">{c.blurb}</span>
              {character === c.id && <span className="sr-only">(selected)</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-3 text-[17px]">
        <input
          type="checkbox"
          name="acknowledge"
          required
          className="mt-1 size-5 accent-[var(--color-primary)]"
        />
        <span>I have read the privacy notice above.</span>
      </label>

      <div className="rounded-chip border-[1.5px] border-line-soft bg-surface p-4">
        <label className="flex items-start gap-3 text-[17px]">
          <input
            type="checkbox"
            name="researchConsent"
            defaultChecked={initialConsent}
            className="mt-1 size-5 accent-[var(--color-primary)]"
          />
          <span>
            <strong>Optional:</strong> I agree that pseudonymous copies of my conversations may be
            used for research on teaching, as described in the notice.
          </span>
        </label>
        <p className="mt-2 pl-8 text-sm text-ink-subtle">
          Leaving this unticked changes nothing about how you can use UXie. You can change your mind
          any time on your account page.
        </p>
      </div>

      <PrimaryButton pendingLabel="Saving…">Continue to UXie</PrimaryButton>
    </form>
  );
}
