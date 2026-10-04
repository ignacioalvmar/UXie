-- M9 review, reports, exports, data rights and costs (PRD §10.7, §10.8, FR-7.x, FR-8.x, ADR-028).
-- Server-only functions: execute revoked from anon/authenticated; the web app and the CLI call
-- them with the secret key after their own authorization checks. Test conversations (FR-6.5) are
-- excluded from every report, review list and export.

create index if not exists feedback_message_idx on public.feedback(message_id);
create index if not exists conversations_paper_idx on public.conversations(paper_id);
create index if not exists data_requests_status_idx on public.data_requests(status, due_at);

-- ── FR-7.1 review list ──────────────────────────────────────────────────────────────────────
create function public.review_conversations(
  p_module uuid default null,
  p_paper uuid default null,
  p_version uuid default null,
  p_pseudonym text default null,
  p_mode text default null,
  p_from date default null,
  p_to date default null,
  p_has_feedback boolean default false,
  p_limit int default 50,
  p_offset int default 0
) returns table (
  id uuid, pseudonym_id text, paper_id uuid, paper_slug text, paper_title text,
  version_no int, module_title_at_start text, mode text, status public.conv_status,
  created_at timestamptz, last_message_at timestamptz, student_turns int, feedback_count int,
  total_count bigint
)
language sql stable security definer set search_path = '' as $$
  with base as (
    select c.*, pr.pseudonym_id, p.slug as paper_slug, p.title as paper_title, v.version_no,
           (select count(*) from public.messages m
             where m.conversation_id = c.id and m.role = 'student')::int as student_turns,
           (select count(*) from public.feedback f join public.messages m on m.id = f.message_id
             where m.conversation_id = c.id)::int as feedback_count
      from public.conversations c
      join public.profiles pr on pr.id = c.student_id
      join public.papers p on p.id = c.paper_id
      join public.paper_versions v on v.id = c.paper_version_id
     where not c.is_test
       and (p_module is null or c.module_id_at_start = p_module)
       and (p_paper is null or c.paper_id = p_paper)
       and (p_version is null or c.paper_version_id = p_version)
       and (p_pseudonym is null or pr.pseudonym_id ilike p_pseudonym || '%')
       and (p_mode is null or c.mode = p_mode)
       and (p_from is null or c.created_at >= p_from::timestamptz)
       and (p_to is null or c.created_at < (p_to + 1)::timestamptz)
  )
  select id, pseudonym_id, paper_id, paper_slug, paper_title, version_no, module_title_at_start,
         mode, status, created_at, last_message_at, student_turns, feedback_count,
         count(*) over () as total_count
    from base
   where not p_has_feedback or feedback_count > 0
   order by coalesce(last_message_at, created_at) desc, id
   limit p_limit offset p_offset;
$$;
revoke execute on function public.review_conversations(uuid, uuid, uuid, text, text, date, date, boolean, int, int)
  from public, anon, authenticated;

-- ── FR-7.2 class report ─────────────────────────────────────────────────────────────────────
-- One row per real conversation of the paper: the version's objectives (guide JSON), the state,
-- the student's typed turns and the conversation's model cost.
create function public.report_conversations(p_paper uuid)
returns table (
  id uuid, pseudonym_id text, version_no int, objectives jsonb, state jsonb,
  student_turns int, cost_eur numeric
)
language sql stable security definer set search_path = '' as $$
  select c.id, pr.pseudonym_id, v.version_no,
         coalesce(g.guide -> 'objectives', '[]'::jsonb), c.state,
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.role = 'student')::int,
         (select coalesce(sum(l.cost_eur), 0) from public.llm_calls l where l.conversation_id = c.id)
    from public.conversations c
    join public.profiles pr on pr.id = c.student_id
    join public.paper_versions v on v.id = c.paper_version_id
    left join public.teaching_guides g on g.version_id = c.paper_version_id
   where c.paper_id = p_paper and not c.is_test
   order by c.created_at;
$$;
revoke execute on function public.report_conversations(uuid) from public, anon, authenticated;

create function public.report_counts(p_paper uuid)
returns table (
  feedback_up int, feedback_down int, tutor_calls int, tutor_calls_invalid_citations int,
  assessment_calls int, assessment_failures int
)
language sql stable security definer set search_path = '' as $$
  with convs as (
    select id from public.conversations where paper_id = p_paper and not is_test
  )
  select
    (select count(*) from public.feedback f join public.messages m on m.id = f.message_id
      where m.conversation_id in (select id from convs) and f.rating = 1)::int,
    (select count(*) from public.feedback f join public.messages m on m.id = f.message_id
      where m.conversation_id in (select id from convs) and f.rating = -1)::int,
    (select count(*) from public.llm_calls
      where conversation_id in (select id from convs) and purpose = 'tutor' and ok)::int,
    (select count(*) from public.llm_calls
      where conversation_id in (select id from convs) and purpose = 'tutor' and ok
        and coalesce((meta ->> 'citation_invalid')::int, 0) > 0)::int,
    (select count(*) from public.llm_calls
      where conversation_id in (select id from convs) and purpose = 'assessment')::int,
    (select count(*) from public.llm_calls
      where conversation_id in (select id from convs) and purpose = 'assessment' and not ok)::int;
$$;
revoke execute on function public.report_counts(uuid) from public, anon, authenticated;

-- ── FR-7.3 export rows ──────────────────────────────────────────────────────────────────────
-- One row per complete message. Research exports keep only students who consent *now*, and drop
-- pseudonyms in the deletion ledger or with an open deletion request. Never emails or auth ids.
create function public.export_rows(
  p_module uuid default null,
  p_paper uuid default null,
  p_version uuid default null,
  p_from date default null,
  p_to date default null,
  p_research_only boolean default false
) returns table (
  pseudonym_id text, conversation_id uuid, module_id_at_start uuid, module_title_at_start text,
  paper_id uuid, paper_slug text, paper_version_id uuid, version_no int, message_id uuid,
  created_at timestamptz, role public.msg_role, mode text, event text, help_level text,
  content text, provider text, model text, prompt_version text, generation jsonb,
  feedback_rating smallint
)
language sql stable security definer set search_path = '' as $$
  select pr.pseudonym_id, c.id, c.module_id_at_start, c.module_title_at_start,
         c.paper_id, p.slug, c.paper_version_id, v.version_no, m.id,
         m.created_at, m.role, m.mode, m.event, m.help_level,
         m.content, m.provider, m.model, m.prompt_version, m.generation,
         (select f.rating from public.feedback f where f.message_id = m.id limit 1)
    from public.conversations c
    join public.profiles pr on pr.id = c.student_id
    join public.papers p on p.id = c.paper_id
    join public.paper_versions v on v.id = c.paper_version_id
    join public.messages m on m.conversation_id = c.id
   where not c.is_test
     and m.status = 'complete'
     and (p_module is null or c.module_id_at_start = p_module)
     and (p_paper is null or c.paper_id = p_paper)
     and (p_version is null or c.paper_version_id = p_version)
     and (p_from is null or c.created_at >= p_from::timestamptz)
     and (p_to is null or c.created_at < (p_to + 1)::timestamptz)
     and not exists (select 1 from public.deletion_ledger d where d.pseudonym_id = pr.pseudonym_id)
     and (not p_research_only or (
           pr.research_consent
           and pr.role = 'student'
           and not exists (select 1 from public.data_requests r
                            where r.student_id = pr.id and r.type = 'deletion'
                              and r.status in ('open', 'in_progress'))))
   order by c.created_at, c.id, m.created_at, m.id;
$$;
revoke execute on function public.export_rows(uuid, uuid, uuid, date, date, boolean)
  from public, anon, authenticated;

-- ── FR-7.4 usage & cost ─────────────────────────────────────────────────────────────────────
create function public.usage_by_model(p_from timestamptz, p_to timestamptz)
returns table (
  purpose text, provider text, model text, calls int, errors int, input_tokens bigint,
  output_tokens bigint, cached_input_tokens bigint, cache_write_input_tokens bigint,
  cost_eur numeric
)
language sql stable security definer set search_path = '' as $$
  select purpose, provider, model, count(*)::int, count(*) filter (where not ok)::int,
         coalesce(sum(input_tokens), 0), coalesce(sum(output_tokens), 0),
         coalesce(sum(cached_input_tokens), 0), coalesce(sum(cache_write_input_tokens), 0),
         coalesce(sum(cost_eur), 0)
    from public.llm_calls
   where created_at >= p_from and created_at < p_to
   group by purpose, provider, model;
$$;
revoke execute on function public.usage_by_model(timestamptz, timestamptz) from public, anon, authenticated;

create function public.usage_latency(p_from timestamptz, p_to timestamptz)
returns table (purpose text, latency_p50_ms int, latency_p95_ms int, ttft_p95_ms int)
language sql stable security definer set search_path = '' as $$
  select purpose,
         (percentile_cont(0.5) within group (order by latency_ms))::int,
         (percentile_cont(0.95) within group (order by latency_ms))::int,
         (percentile_cont(0.95) within group (order by ttft_ms))::int
    from public.llm_calls
   where created_at >= p_from and created_at < p_to and ok
   group by purpose
   order by purpose;
$$;
revoke execute on function public.usage_latency(timestamptz, timestamptz) from public, anon, authenticated;

-- Daily active students (≥1 turn, students only) and daily cost, for every day with either.
create function public.usage_days(p_from timestamptz, p_to timestamptz)
returns table (day date, active_students int, cost_eur numeric)
language sql stable security definer set search_path = '' as $$
  with active as (
    select u.day, count(distinct u.student_id)::int as n
      from public.usage_daily u join public.profiles p on p.id = u.student_id
     where p.role = 'student' and u.turns > 0
       and u.day >= (p_from at time zone 'UTC')::date and u.day < (p_to at time zone 'UTC')::date
     group by u.day
  ), cost as (
    select (created_at at time zone 'UTC')::date as day, sum(cost_eur) as eur
      from public.llm_calls
     where created_at >= p_from and created_at < p_to
     group by 1
  )
  select coalesce(a.day, c.day), coalesce(a.n, 0), coalesce(c.eur, 0)
    from active a full join cost c on c.day = a.day
   order by 1;
$$;
revoke execute on function public.usage_days(timestamptz, timestamptz) from public, anon, authenticated;

create function public.usage_active_students(p_from timestamptz, p_to timestamptz) returns int
language sql stable security definer set search_path = '' as $$
  select count(distinct u.student_id)::int
    from public.usage_daily u join public.profiles p on p.id = u.student_id
   where p.role = 'student' and u.turns > 0
     and u.day >= (p_from at time zone 'UTC')::date and u.day < (p_to at time zone 'UTC')::date;
$$;
revoke execute on function public.usage_active_students(timestamptz, timestamptz) from public, anon, authenticated;

-- ── FR-8.3 completing a deletion request ────────────────────────────────────────────────────
-- In one transaction: ledger row, auth user deleted (cascades profile, conversations, messages,
-- feedback, usage, events; llm_calls keep aggregates with conversation_id null), request
-- completed with student_id null and the pseudonym kept. Returns 'ok' or a refusal code. The
-- caller reads the email first (for the confirmation mail) and must not log it.
create function public.complete_deletion(p_request uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  r public.data_requests%rowtype;
  who public.user_role;
begin
  select * into r from public.data_requests where id = p_request for update;
  if not found then return 'not_found'; end if;
  if r.type <> 'deletion' then return 'not_a_deletion'; end if;
  if r.status in ('completed', 'rejected') then return 'already_closed'; end if;
  if r.student_id is null then return 'student_missing'; end if;
  select role into who from public.profiles where id = r.student_id;
  if who = 'instructor' then return 'instructor_account'; end if;

  insert into public.deletion_ledger (pseudonym_id, auth_user_id)
    values (r.pseudonym_id, r.student_id)
    on conflict (pseudonym_id) do nothing;
  update public.data_requests
     set status = 'completed', completed_at = now(), student_id = null
   where id = p_request;
  -- Other requests of the same student keep their pseudonym; the FK nulls student_id.
  delete from auth.users where id = r.student_id;
  return 'ok';
end $$;
revoke execute on function public.complete_deletion(uuid) from public, anon, authenticated;

-- After a backup restore (runbook): delete every account whose pseudonym is in the ledger.
create function public.reapply_deletion_ledger() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with gone as (
    delete from auth.users u
     using public.deletion_ledger d
     where d.auth_user_id = u.id
    returning u.id
  )
  select count(*) into n from gone;
  return n;
end $$;
revoke execute on function public.reapply_deletion_ledger() from public, anon, authenticated;

-- ── FR-8.4 retention purge ──────────────────────────────────────────────────────────────────
-- Conversations whose last activity is before p_before, for all students (test chats too).
-- Messages and feedback cascade; llm_calls keep their aggregates with conversation_id null.
create function public.purge_conversations(p_before timestamptz, p_dry_run boolean default true)
returns table (conversations int, messages int, feedback int, students int)
language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into ids
    from public.conversations
   where coalesce(last_message_at, created_at) < p_before;
  conversations := cardinality(ids);
  select count(*)::int into messages from public.messages where conversation_id = any(ids);
  select count(*)::int into feedback from public.feedback f
    join public.messages m on m.id = f.message_id where m.conversation_id = any(ids);
  select count(distinct student_id)::int into students from public.conversations
   where id = any(ids);
  if not p_dry_run then
    delete from public.conversations where id = any(ids);
  end if;
  return next;
end $$;
revoke execute on function public.purge_conversations(timestamptz, boolean) from public, anon, authenticated;

-- ── Export log for CLI exports ──────────────────────────────────────────────────────────────
-- `pnpm uxie export` runs as the operator with no signed-in instructor (as other CLI audit
-- events, ADR-027), so the instructor is optional and the channel says where it came from.
alter table public.export_log alter column instructor_id drop not null;
alter table public.export_log add column channel text not null default 'web'
  check (channel in ('web', 'cli'));
