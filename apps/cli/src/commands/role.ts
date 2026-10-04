import { parseEnv, ServerEnvSchema } from "@uxie/core";
import { AccountsRepo, createServiceClient } from "@uxie/db";

/** `pnpm uxie role set <email> <student|instructor>` (FR-1.6). Service key; never via the UI. */
export async function roleSetCommand(email: string, role: string): Promise<void> {
  if (role !== "student" && role !== "instructor") {
    throw new Error(`Role must be "student" or "instructor", not "${role}"`);
  }
  const env = parseEnv(ServerEnvSchema, process.env);
  const accounts = new AccountsRepo(
    createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY),
  );
  const { userId, previous } = await accounts.setRole(email, role);
  await accounts.logEvent("role_changed", userId, { from: previous, to: role });
  console.log(
    previous === role ? `${email} is already ${role}.` : `${email}: ${previous} → ${role}.`,
  );
}
