import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CharacterLine, StackedShell } from "../../../../../components/auth/parts";
import { currentUser } from "../../../../../lib/auth";
import { UpdatePasswordForm } from "./UpdatePasswordForm";

export const metadata: Metadata = { title: "Set a new password" };

/** "Set new password" after the reset link (HANDOFF §9; built to match the system). */
export default async function UpdatePasswordPage() {
  // The reset link signs the user in through /auth/callback; without that session the link expired.
  if (!(await currentUser())) redirect("/auth/reset?expired=1");
  return (
    <StackedShell>
      <CharacterLine character="pip" state="hint" size={120}>
        Fresh start. What will it be?
      </CharacterLine>
      <h1 className="font-display text-[32px] font-bold leading-[1.1] tracking-[-0.02em]">
        Set a new password
      </h1>
      <UpdatePasswordForm />
    </StackedShell>
  );
}
