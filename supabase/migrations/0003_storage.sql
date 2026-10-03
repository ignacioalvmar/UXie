-- Storage (PRD §9.3): one private bucket for paper PDFs at {paper_id}/{version_id}.pdf.
-- No storage.objects policies for anon/authenticated: the server uploads (signed upload URLs,
-- FR-5.1) and hands out 10-minute signed download URLs after checking can_read_version().
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('papers', 'papers', false, 40 * 1024 * 1024, array['application/pdf'])
on conflict (id) do nothing;
