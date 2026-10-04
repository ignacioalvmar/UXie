-- M8 instructor content management (PRD §10.5, §10.6, ADR-027). Server-only functions: execute
-- revoked from anon/authenticated; the web app and the worker call them with the secret key after
-- their own authorization checks.

-- The hash is computed by the worker after the upload (FR-5.1 step 4), so it is unknown while the
-- version is `uploading` / `processing`.
alter table public.paper_versions alter column pdf_sha256 drop not null;

-- One job table for both kinds of background work: full ingestion of an uploaded PDF, and
-- "Regenerate draft" of the guide (FR-6.4), which reads the stored pages. `extractor` overrides
-- EXTRACTOR for a retry with the other extractor (FR-5.5).
alter table public.ingest_jobs
  add column kind text not null default 'ingest' check (kind in ('ingest', 'draft_guide')),
  add column extractor text check (extractor in ('unpdf', 'docling'));
create index ingest_jobs_version_idx on public.ingest_jobs(version_id, created_at desc);

-- Where the stored guide came from and what was wrong with the model's draft (FR-5.4): source
-- (draft | editor | cli), prompt_version, model, issues at drafting time.
alter table public.teaching_guides add column draft_meta jsonb not null default '{}';

-- Instructor test chats (FR-6.5) live next to the instructor's own student conversations on the
-- same version, so the one-active-conversation rule applies to real conversations only.
drop index public.one_active_conv_per_version;
create unique index one_active_conv_per_version on public.conversations(student_id, paper_version_id)
  where status = 'active' and not is_test;

-- FR-6.6: publish a ready version with an approved guide, atomically. Returns 'ok' or a refusal
-- code. The previous published version becomes `superseded`; its conversations stay on it.
create function public.publish_version(p_version uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v public.paper_versions%rowtype;
  g public.guide_status;
begin
  select * into v from public.paper_versions where id = p_version for update;
  if not found then return 'not_found'; end if;
  perform 1 from public.papers where id = v.paper_id for update;
  if v.status <> 'ready' then return 'version_not_ready'; end if;
  select status into g from public.teaching_guides where version_id = p_version;
  if g is distinct from 'approved' then return 'guide_not_approved'; end if;

  update public.paper_versions set status = 'superseded'
   where paper_id = v.paper_id and status = 'published' and id <> p_version;
  update public.paper_versions set status = 'published', published_at = now() where id = p_version;
  update public.papers
     set current_version_id = p_version,
         status = case when status = 'draft' then 'published'::public.paper_status else status end,
         updated_at = now()
   where id = v.paper_id;
  return 'ok';
end $$;
revoke execute on function public.publish_version(uuid) from public, anon, authenticated;

-- FR-5.1 step 4: jobs `running` for longer than WORKER_JOB_TIMEOUT_MS go back to `queued`; after
-- p_max_attempts they fail, and so does the version of an ingestion job. Returns the jobs touched.
create function public.requeue_stale_ingest_jobs(p_timeout_ms int, p_max_attempts int default 2)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with stale as (
    update public.ingest_jobs j
       set status = case when j.attempts >= p_max_attempts then 'failed' else 'queued' end,
           error = case when j.attempts >= p_max_attempts
                        then 'The job timed out ' || j.attempts || ' times.' else j.error end,
           finished_at = case when j.attempts >= p_max_attempts then now() else null end
     where j.status = 'running'
       and j.started_at < now() - make_interval(secs => p_timeout_ms / 1000.0)
    returning j.*
  ), failed_versions as (
    update public.paper_versions pv set status = 'failed'
      from stale s
     where s.status = 'failed' and s.kind = 'ingest' and pv.id = s.version_id
       and pv.status = 'processing'
    returning pv.id
  )
  select count(*) into n from stale;
  return n;
end $$;
revoke execute on function public.requeue_stale_ingest_jobs(int, int) from public, anon, authenticated;

-- FR-6.7 permanent deletion. Both return the Storage paths to remove afterwards (the server
-- deletes the files once the rows are gone). Conversations go first (messages, feedback cascade;
-- llm_calls keep their aggregates with conversation_id set null).
create function public.delete_paper(p_paper uuid) returns setof text
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.papers where id = p_paper for update;
  if not found then return; end if;
  return query select pdf_path from public.paper_versions where paper_id = p_paper;
  delete from public.conversations where paper_id = p_paper;
  update public.papers set current_version_id = null where id = p_paper;
  delete from public.paper_versions where paper_id = p_paper;
  delete from public.papers where id = p_paper;
end $$;
revoke execute on function public.delete_paper(uuid) from public, anon, authenticated;

-- A paper's current version cannot be deleted on its own (publish another one or delete the paper).
create function public.delete_paper_version(p_version uuid) returns setof text
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.papers where current_version_id = p_version) then
    raise exception 'current_version' using errcode = 'P0001';
  end if;
  return query select pdf_path from public.paper_versions where id = p_version;
  delete from public.conversations where paper_version_id = p_version;
  delete from public.paper_versions where id = p_version;
end $$;
revoke execute on function public.delete_paper_version(uuid) from public, anon, authenticated;
