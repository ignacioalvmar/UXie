import { must, NotFoundError, type Db } from "../client";

/** Profiles, roles, onboarding and analytics events (FR-1.x, NFR-19). Server-side only. */

export type UserRole = "student" | "instructor";
export type UxieCharacterChoice = "pip" | "miso" | "luma";

export interface Profile {
  id: string;
  pseudonymId: string;
  role: UserRole;
  displayName: string | null;
  projectDescription: string | null;
  uxieCharacter: UxieCharacterChoice | null;
  privacyNoticeVersion: string | null;
  privacyAckAt: string | null;
  researchConsent: boolean;
  researchConsentVersion: string | null;
  researchConsentAt: string | null;
}

interface ProfileRow {
  id: string;
  pseudonym_id: string;
  role: UserRole;
  display_name: string | null;
  project_description: string | null;
  uxie_character: UxieCharacterChoice | null;
  privacy_notice_version: string | null;
  privacy_ack_at: string | null;
  research_consent: boolean;
  research_consent_version: string | null;
  research_consent_at: string | null;
}

const PROFILE_COLUMNS =
  "id, pseudonym_id, role, display_name, project_description, uxie_character, privacy_notice_version, privacy_ack_at, research_consent, research_consent_version, research_consent_at";

const toProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  pseudonymId: r.pseudonym_id,
  role: r.role,
  displayName: r.display_name,
  projectDescription: r.project_description,
  uxieCharacter: r.uxie_character,
  privacyNoticeVersion: r.privacy_notice_version,
  privacyAckAt: r.privacy_ack_at,
  researchConsent: r.research_consent,
  researchConsentVersion: r.research_consent_version,
  researchConsentAt: r.research_consent_at,
});

/** FR-1.3: onboarding is needed until the current privacy notice version is acknowledged. */
export const needsOnboarding = (p: Profile, privacyNoticeVersion: string) =>
  p.privacyNoticeVersion !== privacyNoticeVersion || !p.privacyAckAt;

export class AccountsRepo {
  constructor(private readonly db: Db) {}

  async getProfile(userId: string): Promise<Profile> {
    const row = must(
      await this.db.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle(),
      `profile ${userId}`,
    ) as ProfileRow;
    return toProfile(row);
  }

  async isInstructor(userId: string): Promise<boolean> {
    const res = await this.db.from("profiles").select("role").eq("id", userId).maybeSingle();
    return (res.data as { role: UserRole } | null)?.role === "instructor";
  }

  /** FR-1.3/1.4: acknowledge the notice; research consent is a separate, optional choice. */
  async completeOnboarding(
    userId: string,
    input: {
      privacyNoticeVersion: string;
      researchConsent: boolean;
      researchConsentVersion: string;
      uxieCharacter: UxieCharacterChoice | null;
      now?: Date;
    },
  ): Promise<void> {
    const now = (input.now ?? new Date()).toISOString();
    must(
      await this.db
        .from("profiles")
        .update({
          privacy_notice_version: input.privacyNoticeVersion,
          privacy_ack_at: now,
          research_consent: input.researchConsent,
          research_consent_version: input.researchConsent ? input.researchConsentVersion : null,
          research_consent_at: input.researchConsent ? now : null,
          ...(input.uxieCharacter ? { uxie_character: input.uxieCharacter } : {}),
        })
        .eq("id", userId)
        .select("id")
        .maybeSingle(),
      `profile ${userId}`,
    );
  }

  /** FR-1.4: give or withdraw research consent at any time; no effect on service access. */
  async setResearchConsent(userId: string, consent: boolean, version: string, now = new Date()) {
    must(
      await this.db
        .from("profiles")
        .update({
          research_consent: consent,
          research_consent_version: consent ? version : null,
          research_consent_at: consent ? now.toISOString() : null,
        })
        .eq("id", userId)
        .select("id")
        .maybeSingle(),
      `profile ${userId}`,
    );
  }

  /** FR-1.5 and the character choice. */
  async updateProfile(
    userId: string,
    patch: {
      displayName?: string | null;
      projectDescription?: string | null;
      uxieCharacter?: UxieCharacterChoice;
    },
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.displayName !== undefined) update.display_name = patch.displayName;
    if (patch.projectDescription !== undefined)
      update.project_description = patch.projectDescription;
    if (patch.uxieCharacter !== undefined) update.uxie_character = patch.uxieCharacter;
    if (!Object.keys(update).length) return;
    must(
      await this.db.from("profiles").update(update).eq("id", userId).select("id").maybeSingle(),
      `profile ${userId}`,
    );
  }

  /** Auth user id for an email (admin API; fine for a course-sized user base). */
  async findUserIdByEmail(email: string): Promise<string> {
    const wanted = email.trim().toLowerCase();
    for (let page = 1; page < 100; page++) {
      const { data, error } = await this.db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`list users: ${error.message}`);
      const hit = data.users.find((u) => u.email?.toLowerCase() === wanted);
      if (hit) return hit.id;
      if (data.users.length < 200) break;
    }
    throw new NotFoundError(`User ${email}`);
  }

  /** FR-1.6: only via CLI (service key), never via the UI. */
  async setRole(email: string, role: UserRole): Promise<{ userId: string; previous: UserRole }> {
    const userId = await this.findUserIdByEmail(email);
    const before = await this.getProfile(userId);
    must(
      await this.db.from("profiles").update({ role }).eq("id", userId).select("id").maybeSingle(),
      `profile ${userId}`,
    );
    return { userId, previous: before.role };
  }

  /** Analytics/audit events carry ids only, never chat text (NFR-19). */
  async logEvent(type: string, studentId: string | null, props: Record<string, unknown> = {}) {
    const { error } = await this.db.from("events").insert({ type, student_id: studentId, props });
    if (error) throw new Error(`log event: ${error.message}`);
  }

  /** The email domain allow-list read by the sign-up hook (0004_auth_hook.sql). */
  async allowedDomainsInDb(): Promise<string[]> {
    const rows = must(
      await this.db.from("auth_allowed_domains").select("domain").order("domain"),
      "allowed domains",
    ) as { domain: string }[];
    return rows.map((r) => r.domain);
  }
}
