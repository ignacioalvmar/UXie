"use client";

import { useActionState, useEffect, useState } from "react";
import { SecondaryButton, TextField } from "../../../../components/auth/fields";
import { resendVerification, type AuthFormState } from "../actions";

const COOLDOWN = 60;

/**
 * HANDOFF §6.4: disabled for 60 s after each send; "Email sent" announced politely. Without a known
 * address (an expired link lands here without one) it asks for the email first.
 */
export function ResendButton({ email }: { email?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(resendVerification, {});
  const [left, setLeft] = useState(email ? COOLDOWN : 0);
  useEffect(() => {
    if (state.sent) setLeft(COOLDOWN);
  }, [state]);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const label =
    left > 0
      ? `Resend in 0:${String(left).padStart(2, "0")}`
      : pending
        ? "Sending…"
        : email
          ? "Resend email"
          : "Send a new link";

  return (
    <form action={action} className="flex flex-col gap-3">
      {email ? (
        <input type="hidden" name="email" value={email} />
      ) : (
        <TextField
          label="University email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
        />
      )}
      <SecondaryButton
        type="submit"
        disabled={left > 0 || pending}
        aria-disabled={left > 0 || pending}
      >
        {label}
      </SecondaryButton>
      <p aria-live="polite" className="min-h-6 text-center text-sm text-ink-subtle">
        {state.sent
          ? "Email sent"
          : state.failure === "rate_limited"
            ? "Too many attempts. Try again in a minute."
            : ""}
      </p>
    </form>
  );
}
