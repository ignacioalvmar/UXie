-- FR-1.1: the email domain allow-list is enforced in the sign-up server action AND here, in a
-- Supabase "before user created" Auth hook (Postgres function hook, configured in config.toml
-- locally and in the dashboard for hosted projects). Keep this table in sync with
-- ALLOWED_EMAIL_DOMAINS; `pnpm uxie doctor` reports differences. Empty table = any domain (dev).
create table public.auth_allowed_domains (
  domain text primary key check (domain = lower(domain) and domain !~ '\s')
);
alter table public.auth_allowed_domains enable row level security;
revoke all on public.auth_allowed_domains from anon, authenticated;

-- D5 (confirmed by the owner).
insert into public.auth_allowed_domains (domain) values ('thi.de'), ('studmail.thi.de');

create function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
  v_domain text := split_part(v_email, '@', 2);
begin
  if not exists (select 1 from public.auth_allowed_domains) then
    return '{}'::jsonb;
  end if;
  if v_domain <> '' and exists (select 1 from public.auth_allowed_domains d where d.domain = v_domain) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Only university email addresses can register.'
    )
  );
end $$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant select on public.auth_allowed_domains to supabase_auth_admin;
