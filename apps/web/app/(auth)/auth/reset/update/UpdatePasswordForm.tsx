"use client";

import { useActionState, useState } from "react";
import { failureCopy } from "../../../../../components/auth/copy";
import {
  FormAlert,
  PasswordField,
  PasswordLengthHint,
  PrimaryButton,
} from "../../../../../components/auth/fields";
import { updatePassword, type AuthFormState } from "../../actions";

export function UpdatePasswordForm() {
  const [state, action] = useActionState<AuthFormState, FormData>(updatePassword, {});
  const [password, setPassword] = useState("");
  const copy = state.failure ? failureCopy(state.failure, "") : null;
  const mismatch = state.failure === "credentials";
  return (
    <form action={action} className="flex flex-col gap-[18px]" noValidate>
      {copy?.title && !mismatch && <FormAlert title={copy.title}>{copy.body}</FormAlert>}
      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={<PasswordLengthHint value={password} min={10} />}
        error={copy?.password}
        required
      />
      <PasswordField
        label="Confirm new password"
        name="confirm"
        autoComplete="new-password"
        error={mismatch ? "The two passwords don't match." : undefined}
        required
      />
      <PrimaryButton pendingLabel="Saving…">Save new password</PrimaryButton>
    </form>
  );
}
