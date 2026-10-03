"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormAlert, PasswordField, PrimaryButton, TextField } from "../../../../components/auth/fields";
import { failureCopy } from "../../../../components/auth/copy";
import { TextLink } from "../../../../components/auth/parts";
import { signIn, type AuthFormState } from "../actions";

export function SignInForm({
  domain,
  next,
  email,
}: {
  domain: string;
  next?: string;
  email?: string;
}) {
  const [state, action] = useActionState<AuthFormState, FormData>(signIn, { email });
  const copy = state.failure ? failureCopy(state.failure, domain) : null;
  const resetHref = (typed: string | undefined) =>
    `/auth/reset${typed && typed.includes("@") ? `?email=${encodeURIComponent(typed)}` : ""}`;

  return (
    <form action={action} className="flex flex-col gap-[18px] lg:gap-6" noValidate>
      {copy?.title && <FormAlert title={copy.title}>{copy.body}</FormAlert>}
      {next && <input type="hidden" name="next" value={next} />}
      <TextField
        label="University email"
        name="email"
        type="email"
        autoComplete="username"
        placeholder={`name@${domain}`}
        defaultValue={state.email ?? email ?? ""}
        required
        error={copy?.email}
      />
      <div className="flex flex-col">
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          required
          key={state.failure ?? "fresh"}
        />
        <div className="flex justify-end">
          <TextLink href={resetHref(state.email ?? email)}>Forgot password?</TextLink>
        </div>
      </div>
      <PrimaryButton pendingLabel="Signing in…">
        {state.failure ? "Try again" : "Sign in"}
      </PrimaryButton>
      <p className="text-center text-base text-ink-muted">
        New to UXie?{" "}
        <Link
          href="/auth/sign-up"
          className="inline-block py-2.5 font-bold text-primary hover:text-primary-hover hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
