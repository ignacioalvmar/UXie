import "server-only";
import { redirect } from "next/navigation";
import { currentUser } from "../../../lib/auth";
import { serverEnv } from "../../../lib/env";

/** HANDOFF §9: signed-in visitors of the auth screens go to the app. */
export async function redirectIfSignedIn() {
  const user = await currentUser();
  if (user?.emailConfirmed) redirect("/");
}

export const firstDomain = () => serverEnv().ALLOWED_EMAIL_DOMAINS[0] ?? "thi.de";
