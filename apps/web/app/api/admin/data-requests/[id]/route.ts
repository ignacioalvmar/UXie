import { DataRightsRepo, ReviewRepo } from "@uxie/db";
import { apiInstructor } from "../../../../../lib/admin/api";
import { jsonError } from "../../../../../lib/chat/turn";
import { serverEnv } from "../../../../../lib/env";
import { crossOrigin, isUuid, readJson } from "../../../../../lib/http";
import { sendMail } from "../../../../../lib/mail";
import { DataRequestPatch } from "../../../../../lib/review/schemas";
import { deletionConfirmationMail, mailtoLink } from "../../../../../lib/review/text";
import { serviceDb } from "../../../../../lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

const REFUSALS: Record<string, [number, string]> = {
  not_found: [404, "Request not found."],
  not_a_deletion: [409, "Only deletion requests can be completed this way."],
  already_closed: [409, "This request is already closed."],
  student_missing: [409, "The account no longer exists."],
  instructor_account: [409, "Instructor accounts are not deleted here: change the role first."],
};

/**
 * PATCH /api/admin/data-requests/:id — `{ action: "in_progress" }`, `{ action: "reject", notes }`
 * or `{ action: "complete", confirmPseudonym }` (FR-8.3: deletes the account atomically, writes
 * the ledger, closes the request, then sends the confirmation mail or returns a mailto: link).
 */
export async function PATCH(request: Request, ctx: Ctx) {
  const refused = crossOrigin(request);
  if (refused) return refused;
  const auth = await apiInstructor();
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const db = serviceDb();
  const rights = new DataRightsRepo(db);
  const req = isUuid(id) ? await rights.request(id) : null;
  if (!req) return jsonError(404, "not_found", "Request not found.");
  const body = DataRequestPatch.safeParse(await readJson(request));
  if (!body.success) return jsonError(400, "invalid_input", body.error.issues[0]!.message);
  const b = body.data;

  if (b.action !== "complete") {
    if (req.status !== "open" && req.status !== "in_progress")
      return jsonError(409, "already_closed", "This request is already closed.");
    const updated = await rights.setStatus(
      id,
      b.action === "reject" ? "rejected" : "in_progress",
      b.action === "reject" ? b.notes : undefined,
    );
    await auth.repo.logEvent(`data_request_${b.action}`, auth.user.id, { request_id: id });
    const { studentId: _omit, ...view } = updated;
    return Response.json({ request: view });
  }

  if (b.confirmPseudonym !== req.pseudonymId)
    return jsonError(
      400,
      "confirmation_required",
      `Type the pseudonym "${req.pseudonymId}" to confirm.`,
    );
  // Read the address before the account is gone; it is used for the mail and never logged.
  const email = req.studentId ? await new ReviewRepo(db).studentEmail(req.studentId) : null;
  const result = await rights.completeDeletion(id);
  if (result !== "ok") {
    const [status, message] = REFUSALS[result] ?? [409, "The request cannot be completed."];
    return jsonError(status, result, message);
  }
  const mail = deletionConfirmationMail({
    pseudonymId: req.pseudonymId,
    deletedAt: new Date(),
    appUrl: serverEnv().APP_URL,
  });
  const confirmation = email ? await sendMail({ to: email, ...mail }) : "failed";
  await auth.repo.logEvent("deletion_completed", auth.user.id, {
    request_id: id,
    pseudonym_id: req.pseudonymId,
    confirmation,
  });
  const { studentId: _omit, ...view } = (await rights.request(id))!;
  return Response.json({
    request: view,
    confirmation,
    ...(confirmation !== "sent" && email ? { mailto: mailtoLink(email, mail) } : {}),
  });
}
