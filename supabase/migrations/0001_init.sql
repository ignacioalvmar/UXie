-- UXie schema (PRD §9.1). RLS lives in 0002, storage in 0003, the sign-up hook in 0004.
create extension if not exists pgcrypto with schema extensions;

create type public.user_role      as enum ('student','instructor');
create type public.module_status  as enum ('draft','published','archived');
create type public.paper_status   as enum ('draft','published','retired');
create type public.version_status as enum ('uploading','processing','ready','failed','published','superseded');
create type public.guide_status   as enum ('draft','approved');
create type public.conv_status    as enum ('active','reset','closed');
create type public.msg_role       as enum ('student','tutor','event');
create type public.msg_status     as enum ('complete','streaming','failed');
create type public.request_type   as enum ('access','deletion');
create type public.request_status as enum ('open','in_progress','completed','rejected');

-- Identity (email lives only in auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  pseudonym_id text unique not null default ('S-' || encode(extensions.gen_random_bytes(5),'hex')),
  role public.user_role not null default 'student',
  display_name text check (char_length(display_name) <= 80),
  project_description text check (char_length(project_description) <= 1500),
  -- Chosen on /onboarding (ADR-014, ADR-024); null until chosen.
  uxie_character text check (uxie_character in ('pip','miso','luma')),
  privacy_notice_version text,
  privacy_ack_at timestamptz,
  research_consent boolean not null default false,
  research_consent_version text,
  research_consent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Content
create table public.modules (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description text,
  position int not null default 0,
  status public.module_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.papers (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id),
  slug text unique not null,
  title text not null,
  authors text[] not null default '{}',
  year int,
  position int not null default 0,
  status public.paper_status not null default 'draft',
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.paper_versions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id),
  version_no int not null,
  pdf_path text not null,                        -- storage: papers/{paper_id}/{version_id}.pdf
  pdf_sha256 text not null,
  page_count int,
  token_estimate int,
  extractor text,
  extraction_warnings jsonb not null default '[]',
  status public.version_status not null default 'processing',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (paper_id, version_no)
);
alter table public.papers add constraint papers_current_version_fk
  foreign key (current_version_id) references public.paper_versions(id);

create table public.paper_pages (
  version_id uuid not null references public.paper_versions(id) on delete cascade,
  page_no int not null,
  text text not null,
  char_count int generated always as (char_length(text)) stored,
  tsv tsvector generated always as (to_tsvector('english', text)) stored,
  primary key (version_id, page_no)
);
create index paper_pages_tsv_idx on public.paper_pages using gin (tsv);

create table public.teaching_guides (
  version_id uuid primary key references public.paper_versions(id) on delete cascade,
  guide jsonb not null,
  status public.guide_status not null default 'draft',
  guide_hash text not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);

create table public.ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.paper_versions(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  step text,                                     -- extract | analyze | draft_guide
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- Worker claims one job atomically (apps/worker, secret key).
create function public.claim_ingest_job() returns setof public.ingest_jobs
language sql security definer set search_path = '' as $$
  update public.ingest_jobs j
     set status = 'running', started_at = now(), attempts = j.attempts + 1
   where j.id = (select id from public.ingest_jobs
                  where status = 'queued' order by created_at
                  for update skip locked limit 1)
  returning j.*;
$$;
revoke execute on function public.claim_ingest_job() from public, anon, authenticated;

create table public.worker_heartbeats (
  name text primary key,
  last_seen_at timestamptz not null default now(),
  meta jsonb not null default '{}'
);

-- Conversations
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  paper_id uuid not null references public.papers(id),
  paper_version_id uuid not null references public.paper_versions(id),
  module_id_at_start uuid not null,
  module_title_at_start text not null,
  mode text not null default 'understand' check (mode in ('understand','apply','critique','build')),
  state jsonb not null,
  status public.conv_status not null default 'active',
  channel text not null default 'web' check (channel in ('web','cli','discord','eval')),
  external_thread_id text unique,
  is_test boolean not null default false,
  generating_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);
create unique index one_active_conv_per_version on public.conversations(student_id, paper_version_id)
  where status = 'active';
create index conversations_student_idx on public.conversations(student_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  client_message_id uuid,
  reply_to uuid references public.messages(id) on delete cascade,
  role public.msg_role not null,
  mode text,
  event text,                                    -- start | stuck | mode_switch | reset
  content text not null,
  status public.msg_status not null default 'complete',
  citations jsonb not null default '[]',
  help_level text,
  provider text, model text, prompt_version text,
  generation jsonb,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  unique (conversation_id, client_message_id)
);
create index messages_conv_idx on public.messages(conversation_id, created_at);
create index messages_reply_to_idx on public.messages(reply_to);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (message_id, student_id)
);

-- Operations
create table public.llm_calls (
  id bigint generated always as identity primary key,
  conversation_id uuid references public.conversations(id) on delete set null,
  purpose text not null,
  provider text not null, model text not null,
  input_tokens int, output_tokens int, cached_input_tokens int,
  cache_write_input_tokens int,                  -- ADR-018
  cost_eur numeric(10,5) not null default 0,
  latency_ms int, ttft_ms int,
  ok boolean not null,
  error_code text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index llm_calls_month_idx on public.llm_calls(created_at);

create table public.usage_daily (
  student_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  turns int not null default 0,
  primary key (student_id, day)
);

-- Atomic increment for UsageRepo.incrementTurn (ports.ts).
create function public.increment_usage(p_student uuid, p_day date) returns int
language sql security definer set search_path = '' as $$
  insert into public.usage_daily (student_id, day, turns) values (p_student, p_day, 1)
  on conflict (student_id, day) do update set turns = public.usage_daily.turns + 1
  returning turns;
$$;
revoke execute on function public.increment_usage(uuid, date) from public, anon, authenticated;

create table public.events (
  id bigint generated always as identity primary key,
  student_id uuid references public.profiles(id) on delete cascade,
  type text not null,
  props jsonb not null default '{}',             -- ids only; NEVER chat text (NFR-19)
  created_at timestamptz not null default now()
);

-- Data rights & governance
create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.profiles(id) on delete set null,
  pseudonym_id text not null,
  type public.request_type not null,
  status public.request_status not null default 'open',
  notes text,
  created_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '30 days'),
  completed_at timestamptz
);

create table public.deletion_ledger (
  pseudonym_id text primary key,
  auth_user_id uuid not null,
  deleted_at timestamptz not null default now()
);

create table public.export_log (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.profiles(id),
  format text not null check (format in ('csv','json')),
  filters jsonb not null,
  research_only boolean not null,
  row_count int not null,
  created_at timestamptz not null default now()
);

-- Inference settings edited on /admin/settings/ai (FR-9.6, ADR-020). Singleton row.
create table public.llm_settings (
  id boolean primary key default true check (id),
  config jsonb not null,                         -- LlmSettings without credentials
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- Provider API keys (FR-9.7). Never readable through RLS; only the server (secret key) reads them.
create table public.llm_credentials (
  provider text primary key check (provider in ('anthropic','openai','google','openai_compatible')),
  api_key_sealed text,                           -- AES-256-GCM, AAD 'llm_credentials:<provider>'
  key_hint text,
  base_url text,
  workspace_id text,                             -- anthropic org-level keys (ADR-020); not a secret
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- Profile auto-creation
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role helper (used by RLS policies)
create function public.is_instructor() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'instructor');
$$;

-- Server-only RPCs used by packages/db (secret key).
-- PaperRepo.searchPages: Postgres FTS ranking (ADR-004 retrieval fallback).
create function public.search_pages(p_version uuid, p_query text, p_limit int) returns setof int
language sql stable security definer set search_path = '' as $$
  select page_no from public.paper_pages
   where version_id = p_version and tsv @@ websearch_to_tsquery('english', p_query)
   order by ts_rank(tsv, websearch_to_tsquery('english', p_query)) desc, page_no
   limit p_limit;
$$;
revoke execute on function public.search_pages(uuid, text, int) from public, anon, authenticated;

-- ConversationRepo.saveSummary: patch only the two summary fields (ADR-019).
create function public.save_conversation_summary(p_conversation uuid, p_summary text, p_through uuid)
returns void language sql security definer set search_path = '' as $$
  update public.conversations
     set state = state || jsonb_build_object('history_summary', p_summary,
                                             'summarized_through_message_id', p_through),
         updated_at = now()
   where id = p_conversation;
$$;
revoke execute on function public.save_conversation_summary(uuid, text, uuid) from public, anon, authenticated;
-- Month-to-date spend for the ceiling check (FR-9.2); summed in SQL, not over capped API pages.
create function public.spend_since(p_since timestamptz) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(cost_eur), 0) from public.llm_calls where created_at >= p_since;
$$;
revoke execute on function public.spend_since(timestamptz) from public, anon, authenticated;