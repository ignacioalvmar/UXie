import "server-only";
import { ServerEnvSchema, parseEnv, type ServerEnv } from "@uxie/core";

let cached: ServerEnv | undefined;

/** Validated server configuration (PRD §7). Throws on first use if the environment is invalid. */
export function serverEnv(): ServerEnv {
  cached ??= parseEnv(ServerEnvSchema, process.env);
  return cached;
}
