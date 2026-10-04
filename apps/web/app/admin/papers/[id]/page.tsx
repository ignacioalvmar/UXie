import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminRepo } from "@uxie/db";
import { PaperManager } from "../../../../components/admin/PaperManager";
import { serverEnv } from "../../../../lib/env";
import { isUuid } from "../../../../lib/http";
import { loadPaperAdmin } from "../../../../lib/admin/views";
import { serviceDb } from "../../../../lib/supabase/server";

export const metadata: Metadata = { title: "Paper" };

/** FR-5.1, FR-6.2, FR-6.3, FR-6.7. Instructors only (admin layout). */
export default async function PaperAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { id } = await params;
  const view = isUuid(id) ? await loadPaperAdmin(new AdminRepo(serviceDb()), id) : null;
  if (!view) notFound();
  const { new: justCreated } = await searchParams;
  return (
    <PaperManager
      key={view.paper.id}
      view={view}
      maxPdfMb={serverEnv().MAX_PDF_MB}
      justCreated={justCreated === "1"}
    />
  );
}
