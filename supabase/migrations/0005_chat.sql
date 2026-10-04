-- M6 chat plumbing (PRD §4.4, FR-9.2). Server-only functions: execute revoked from anon/authenticated.

-- Step 3 of the per-turn sequence: one generation at a time per conversation. A lock older than
-- two minutes is stale (crashed function) and may be taken over.
create function public.acquire_generation_lock(p_conversation uuid) returns boolean
language sql security definer set search_path = '' as $$
  with taken as (
    update public.conversations
       set generating_since = now()
     where id = p_conversation
       and (generating_since is null or generating_since < now() - interval '2 minutes')
    returning id
  )
  select exists (select 1 from taken);
$$;
revoke execute on function public.acquire_generation_lock(uuid) from public, anon, authenticated;

create function public.release_generation_lock(p_conversation uuid) returns void
language sql security definer set search_path = '' as $$
  update public.conversations set generating_since = null where id = p_conversation;
$$;
revoke execute on function public.release_generation_lock(uuid) from public, anon, authenticated;

-- Per-minute limit: turns a student started (typed messages and button events) since a moment,
-- across their non-test conversations. Returns the count and the oldest timestamp in the window
-- so the API can say when the next turn is allowed.
create function public.turns_since(p_student uuid, p_since timestamptz)
returns table (turns int, oldest timestamptz)
language sql stable security definer set search_path = '' as $$
  select count(*)::int, min(m.created_at)
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where c.student_id = p_student
     and not c.is_test
     and m.role in ('student', 'event')
     and m.created_at >= p_since;
$$;
revoke execute on function public.turns_since(uuid, timestamptz) from public, anon, authenticated;
