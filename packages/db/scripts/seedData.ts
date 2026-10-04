/** Synthetic seed identities (NFR-5), shared by make-seed.ts and the `pnpm test:db` suite. */

/** Dev-only password for the seeded accounts (local stack only; never use on hosted projects). */
export const SEED_PASSWORD = "uxie-dev-password";

export const SEED_USERS = [
  { id: "00000000-0000-4000-a000-000000000001", email: "instructor@thi.de", role: "instructor" },
  { id: "00000000-0000-4000-a000-000000000002", email: "student.a@thi.de", role: "student" },
  { id: "00000000-0000-4000-a000-000000000003", email: "student.b@thi.de", role: "student" },
] as const;

export const SEED_MODULE_ID = "00000000-0000-4000-b000-000000000001";
export const SEED_PAPER_ID = "00000000-0000-4000-c000-000000000001";
export const SEED_VERSION_ID = "00000000-0000-4000-d000-000000000001";
