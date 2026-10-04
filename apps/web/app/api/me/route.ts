import { z } from "zod";
import { accounts } from "../../../lib/auth";
import { jsonError } from "../../../lib/chat/turn";
import { apiUser, crossOrigin, readJson } from "../../../lib/http";

const MeBody = z
  .object({
    displayName: z.string().trim().max(80).nullable().optional(),
    projectDescription: z.string().trim().max(1500).nullable().optional(),
  })
  .refine((b) => b.displayName !== undefined || b.projectDescription !== undefined);

/**
 * PATCH /api/me `{ displayName?, projectDescription? }` → profile (PRD §11). Used by the
 * Apply-mode project card ("Save to my profile", FR-1.5); `/account` uses a server action.
 * An empty string or null clears the field.
 */
export async function PATCH(request: Request) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const body = MeBody.safeParse(await readJson(request));
  if (!body.success)
    return jsonError(
      400,
      "invalid_input",
      "The project description can be at most 1,500 characters.",
    );

  const { displayName, projectDescription } = body.data;
  await accounts().updateProfile(auth.user.id, {
    ...(displayName !== undefined ? { displayName: displayName || null } : {}),
    ...(projectDescription !== undefined ? { projectDescription: projectDescription || null } : {}),
  });
  const profile = await accounts().getProfile(auth.user.id);
  return Response.json({
    displayName: profile.displayName,
    projectDescription: profile.projectDescription,
  });
}
