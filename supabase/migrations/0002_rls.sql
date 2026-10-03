-- Row-level security (PRD §9.2, normative matrix). RLS is on for every table. The server writes
-- with the secret key after explicit authorization checks; the browser only reads with the user's
-- session. Policies use `(select auth.uid())` so Postgres evaluates it once per query.

alter table public.profiles          enable row level security;
alter table public.modules           enable row level security;
alter table public.papers            enable row level security;
alter table public.paper_versions    enable row level security;
alter table public.paper_pages       enable row level security;
alter table public.teaching_guides   enable row level security;
alter table public.ingest_jobs       enable row level security;
alter table public.worker_heartbeats enable row level security;
alter table public.conversations     enable row level security;
alter table public.messages          enable row level security;
alter table public.feedback          enable row level security;
alter table public.llm_calls         enable row level security;
alter table public.usage_daily       enable row level security;
alter table public.events            enable row level security;
alter table public.data_requests     enable row level security;
alter table public.deletion_ledger   enable row level security;
alter table public.export_log        enable row level security;
alter table public.llm_settings      enable row level security;
alter table public.llm_credentials   enable row level security;

-- Browser sessions never write; the server uses the secret key (service role bypasses RLS).
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
-- Students may edit two profile columns of their own row (FR-1.5).
grant update (display_name, project_description) on public.profiles to authenticated;
-- Credentials are not even selectable by role grants (FR-9.7).
revoke all on public.llm_credentials from anon, authenticated;

-- A paper version is readable when published, when the reader has a conversation on it, or by an
-- instructor. Shared by paper_versions and paper_pages (and the signed-URL check in the server).
create function public.can_read_version(v uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_instructor()
      or exists (select 1 from public.paper_versions pv where pv.id = v and pv.status = 'published')
      or exists (select 1 from public.conversations c
                  where c.paper_version_id = v and c.student_id = auth.uid());
$$;
revoke execute on function public.can_read_version(uuid) from public, anon;
grant execute on function public.can_read_version(uuid) to authenticated;
revoke execute on function public.is_instructor() from public, anon;
grant execute on function public.is_instructor() to authenticated;

-- profiles: own row (select, limited update); instructors select all.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_instructor()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- modules: published for students; all for instructors.
create policy modules_select on public.modules for select to authenticated
  using (status = 'published' or (select public.is_instructor()));

-- papers: published or retired, in a published module.
create policy papers_select on public.papers for select to authenticated
  using (
    (select public.is_instructor())
    or (status in ('published','retired')
        and exists (select 1 from public.modules m where m.id = module_id and m.status = 'published'))
  );

create policy paper_versions_select on public.paper_versions for select to authenticated
  using (public.can_read_version(id));
create policy paper_pages_select on public.paper_pages for select to authenticated
  using (public.can_read_version(version_id));

-- teaching_guides: never students.
create policy teaching_guides_select on public.teaching_guides for select to authenticated
  using ((select public.is_instructor()));

-- conversations / messages: own; instructors all.
create policy conversations_select on public.conversations for select to authenticated
  using (student_id = (select auth.uid()) or (select public.is_instructor()));
create policy messages_select on public.messages for select to authenticated
  using (
    (select public.is_instructor())
    or exists (select 1 from public.conversations c
                where c.id = conversation_id and c.student_id = (select auth.uid()))
  );

-- feedback, data_requests, usage_daily: own; instructors all.
create policy feedback_select on public.feedback for select to authenticated
  using (student_id = (select auth.uid()) or (select public.is_instructor()));
create policy data_requests_select on public.data_requests for select to authenticated
  using (student_id = (select auth.uid()) or (select public.is_instructor()));
create policy usage_daily_select on public.usage_daily for select to authenticated
  using (student_id = (select auth.uid()) or (select public.is_instructor()));

-- Operations: instructors only.
create policy llm_calls_select on public.llm_calls for select to authenticated
  using ((select public.is_instructor()));
create policy ingest_jobs_select on public.ingest_jobs for select to authenticated
  using ((select public.is_instructor()));
create policy export_log_select on public.export_log for select to authenticated
  using ((select public.is_instructor()));
create policy events_select on public.events for select to authenticated
  using ((select public.is_instructor()));
create policy deletion_ledger_select on public.deletion_ledger for select to authenticated
  using ((select public.is_instructor()));
create policy worker_heartbeats_select on public.worker_heartbeats for select to authenticated
  using ((select public.is_instructor()));
create policy llm_settings_select on public.llm_settings for select to authenticated
  using ((select public.is_instructor()));

-- llm_credentials: no policy at all (RLS on + grants revoked = nobody but the service role).
