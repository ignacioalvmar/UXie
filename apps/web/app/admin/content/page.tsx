import type { Metadata } from "next";
import { AdminRepo } from "@uxie/db";
import { ContentManager } from "../../../components/admin/ContentManager";
import { loadContent } from "../../../lib/admin/views";
import { serviceDb } from "../../../lib/supabase/server";

export const metadata: Metadata = { title: "Content" };

/** FR-6.1 / FR-6.2: modules and papers. The admin layout already restricted this to instructors. */
export default async function ContentPage() {
  const modules = await loadContent(new AdminRepo(serviceDb()));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">Content</h1>
        <p className="text-ink-muted">
          Modules and papers in the order students see them. Open a paper to upload its PDF, check
          the extraction, edit and approve the teaching guide, test it as a student and publish.
        </p>
      </div>
      <ContentManager initial={modules} />
    </div>
  );
}
