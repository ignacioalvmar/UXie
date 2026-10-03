"use client";

import { useActionState, useState } from "react";
import { UxieCharacter } from "@uxie/character";
import { failureCopy } from "../../../../components/auth/copy";
import {
  FormAlert,
  PasswordField,
  PasswordLengthHint,
  PrimaryButton,
  TextField,
} from "../../../../components/auth/fields";
import { signUp, type AuthFormState } from "../actions";

export function SignUpForm({
  domain,
  inviteRequired,
}: {
  domain: string;
  inviteRequired: boolean;
}) {
  const [state, action] = useActionState<AuthFormState, FormData>(signUp, {});
  const [password, setPassword] = useState("");
  const copy = state.failure ? failureCopy(state.failure, domain) : null;

  return (
    <form action={action} className="flex flex-col gap-[18px]" noValidate>
      {copy?.title && <FormAlert title={copy.title}>{copy.body}</FormAlert>}
      <TextField
        label="University email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder={`name@${domain}`}
        defaultValue={state.email ?? ""}
        hint="Only university addresses can register."
        error={copy?.email}
        required
      />
      <PasswordField
        label="Create a password"
        name="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={<PasswordLengthHint value={password} min={10} />}
        error={copy?.password}
        required
      />
      {inviteRequired && (
        <TextField
          label="Course invite code (if your instructor gave you one)"
          name="inviteCode"
          autoComplete="off"
          error={copy?.invite}
        />
      )}
      <PrimaryButton pendingLabel="Creating account…">Create account</PrimaryButton>
      <div className="flex items-center gap-3 rounded-chip bg-panel p-3">
        <span className="flex items-end" aria-hidden="true">
          <UxieCharacter character="pip" size={44} decorative />
          <UxieCharacter character="miso" size={44} decorative className="-ml-2" />
          <UxieCharacter character="luma" size={44} decorative className="-ml-2" />
        </span>
        <p className="text-[15px] text-ink">Next: confirm your email, then choose your UXie.</p>
      </div>
    </form>
  );
}
