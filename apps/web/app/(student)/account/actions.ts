"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { accounts, requireUser } from "../../../lib/auth";
import { serverEnv } from "../../../lib/env";

export interface AccountState {
  saved?: "profile" | "consent";
  error?: string;
}

const ProfileSchema = z.object({
  displayName: z.string().trim().max(80),
  projectDescription: z.string().trim().max(1500),
  character: z.enum(["pip", "miso", "luma"]),
});

/** FR-1.5: display name, project description, character. */
export async function saveProfile(_prev: AccountState, form: FormData): Promise<AccountState> {
  const { user } = await requireUser();
  const parsed = ProfileSchema.safeParse({
    displayName: form.get("displayName") ?? "",
    projectDescription: form.get("projectDescription") ?? "",
    character: form.get("character"),
  });
  if (!parsed.success)
    return {
      error: "Please check the fields: the project description can be at most 1,500 characters.",
    };
  await accounts().updateProfile(user.id, {
    displayName: parsed.data.displayName || null,
    projectDescription: parsed.data.projectDescription || null,
    uxieCharacter: parsed.data.character,
  });
  revalidatePath("/", "layout");
  return { saved: "profile" };
}

/** FR-1.4: give or withdraw research consent; service access is unaffected. */
export async function saveConsent(_prev: AccountState, form: FormData): Promise<AccountState> {
  const { user } = await requireUser();
  const consent = form.get("researchConsent") === "on";
  await accounts().setResearchConsent(user.id, consent, serverEnv().RESEARCH_CONSENT_VERSION);
  revalidatePath("/account");
  return { saved: "consent" };
}
