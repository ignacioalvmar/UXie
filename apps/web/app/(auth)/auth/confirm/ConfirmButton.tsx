"use client";

import { PrimaryButton } from "../../../../components/auth/fields";

export function ConfirmButton({ recovery }: { recovery: boolean }) {
  return (
    <PrimaryButton pendingLabel={recovery ? "Checking…" : "Confirming…"}>
      {recovery ? "Continue" : "Confirm my email"}
    </PrimaryButton>
  );
}
