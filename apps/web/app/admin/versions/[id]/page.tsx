import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminRepo, StudentViewsRepo, SupabaseConversationRepo } from "@uxie/db";
import { VersionWorkspace } from "../../../../components/admin/VersionWorkspace";
import { requireInstructor } from "../../../../lib/auth";
import { toTranscript } from "../../../../lib/chat/transcript";
import { serverEnv } from "../../../../lib/env";
import { isUuid } from "../../../../lib/http";
import { loadVersionAdmin } from "../../../../lib/admin/views";
import { serviceDb } from "../../../../lib/supabase/server";

export const metadata: Metadata = { title: "Paper version" };

/** FR-6.3–6.6. Instructors only (admin layout; checked again for the test-chat owner). */
export default async function VersionAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireInstructor();
  const { id } = await params;
  const db = serviceDb();
  const view = isUuid(id) ? await loadVersionAdmin(new AdminRepo(db), id) : null;
  if (!view) notFound();

  // Resume the instructor's open test chat on this version (FR-6.5).
  const active = await new SupabaseConversationRepo(db).findActive(user.id, id, { isTest: true });
  const messages = active ? await new StudentViewsRepo(db).messages(active.id) : [];
  const transcript = toTranscript(
    messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      status: m.status,
      event: m.event,
      mode: m.mode,
      helpLevel: m.helpLevel,
      clientMessageId: m.clientMessageId,
      citations: m.citations,
      feedback: null,
      createdAt: m.createdAt.toISOString(),
    })),
    false,
  );
  if (active && transcript.messages[0]) {
    const first = transcript.messages[0];
    first.metadata = { ...first.metadata, conversationId: active.id };
  }

  return (
    <VersionWorkspace
      key={view.version.id}
      view={view}
      doclingAvailable={Boolean(serverEnv().DOCLING_URL)}
      test={{
        messages: transcript.messages,
        conversationId: active?.id ?? null,
        mode: active?.mode ?? "understand",
      }}
    />
  );
}
