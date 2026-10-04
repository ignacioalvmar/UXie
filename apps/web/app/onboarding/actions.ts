"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { accounts, requireUser } from "../../lib/auth";
import { serverEnv } from "../../lib/env";

const OnboardingSchema = z.object({
  acknowledge: z.literal("on"),
  researchConsent: z.literal("on").optional(),
  character: z.enum(["pip", "miso", "luma"]),
});

export interface OnboardingState {
  error?: "acknowledge" | "character";
}

/** FR-1.3 (notice acknowledged, versioned) and FR-1.4 (separate, optional research consent). */
export async function completeOnboarding(
  _prev: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  const { user } = await requireUser({ allowOnboarding: true });
  const parsed = OnboardingSchema.safeParse({
    acknowledge: form.get("acknowledge") ?? undefined,
    researchConsent: form.get("researchConsent") ?? undefined,
    character: form.get("character") ?? undefined,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field === "character" ? "character" : "acknowledge" };
  }
  const env = serverEnv();
  await accounts().completeOnboarding(user.id, {
    privacyNoticeVersion: env.PRIVACY_NOTICE_VERSION,
    researchConsent: parsed.data.researchConsent === "on",
    researchConsentVersion: env.RESEARCH_CONSENT_VERSION,
    uxieCharacter: parsed.data.character,
  });
  redirect("/");
}
