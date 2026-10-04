-- M10 hardening (PRD §17.3, ADR-029): operational alerts sent to the instructor, at most once per
-- kind and period (e.g. `spend_80` for `2026-10`). Server only: RLS on, no policies, so browser
-- roles see nothing; the web app writes with the secret key. Contains no personal data.

create table public.alerts_sent (
  kind text not null,
  period text not null,
  sent_at timestamptz not null default now(),
  primary key (kind, period)
);

alter table public.alerts_sent enable row level security;
revoke all on public.alerts_sent from anon, authenticated;
