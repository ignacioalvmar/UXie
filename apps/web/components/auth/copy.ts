import type { AuthFailure } from "../../lib/authRules";

/** Final copy from HANDOFF §6.2–6.3 (verbatim). `domain` is ALLOWED_EMAIL_DOMAINS[0]. */
export function failureCopy(
  failure: AuthFailure,
  domain: string,
): { title?: string; body?: string; email?: string; password?: string; invite?: string } {
  switch (failure) {
    case "domain":
      return {
        title: "We couldn't sign you in",
        body: "Hmm, that address isn't a university email. Can you try the one from your student account?",
        email: `Use an address ending in @${domain}`,
      };
    case "credentials":
      return {
        title: "We couldn't sign you in",
        body: "That email and password don't match. Want to try again, or reset your password?",
      };
    case "rate_limited":
      return {
        title: "Too many attempts",
        body: "Let's take a short break. Try again in a minute.",
      };
    case "password_short":
      return { password: "That password is too short. Use at least 10 characters." };
    case "password_leaked":
      return {
        password: "This password has appeared in a data breach. Please choose a different one.",
      };
    case "password_same":
      return { password: "That is your current password. Choose a different one." };
    case "invite":
      return { invite: "That invite code doesn't match. Check with your instructor." };
    case "unverified":
    case "network":
      return {
        title: "Something went wrong",
        body: "We couldn't reach UXie. Check your connection and try again.",
      };
  }
}
