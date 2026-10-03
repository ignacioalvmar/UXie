"use client";

import { useActionState } from "react";
import { failureCopy } from "../../../../components/auth/copy";
import { FormAlert, PrimaryButton, TextField } from "../../../../components/auth/fields";
import { TextLink } from "../../../../components/auth/parts";
import { requestReset, type AuthFormState } from "../actions";

export function ResetForm({ domain, email }: { domain: string; email?: string }) {
  const [state, action] = useActionState<AuthFormState, FormData>(requestReset, { email });
  if (state.sent) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <p className="text-[17px] text-ink">
          If that address has an account, a reset link is on its way.
        </p>
        <TextLink href="/auth/sign-in">Back to sign in</TextLink>
      </div>
    );
  }
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
        error={copy?.email}
        required
      />
      <PrimaryButton pendingLabel="Sending…">Send reset link</PrimaryButton>
      <TextLink href="/auth/sign-in">Back to sign in</TextLink>
    </form>
  );
}
