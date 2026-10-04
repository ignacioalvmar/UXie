import { DataRightsRepo } from "@uxie/db";
import { accounts } from "../../../../lib/auth";
import { apiUser, crossOrigin } from "../../../../lib/http";
import { serviceDb } from "../../../../lib/supabase/server";

/** POST /api/me/deletion-request → the open deletion request (FR-8.2); asking twice is harmless. */
export async function POST(request: Request) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const { request: req, created } = await new DataRightsRepo(serviceDb()).requestDeletion(
    auth.user.id,
  );
  if (created)
    await accounts().logEvent("data_request", auth.user.id, {
      type: "deletion",
      request_id: req.id,
    });
  const { studentId: _omit, ...view } = req;
  return Response.json({ request: view }, { status: created ? 201 : 200 });
}

/** DELETE /api/me/deletion-request: withdraw an open request the instructor has not started. */
export async function DELETE(request: Request) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiUser();
  if (auth instanceof Response) return auth;
  const withdrawn = await new DataRightsRepo(serviceDb()).cancelDeletion(auth.user.id);
  return Response.json({ withdrawn });
}
