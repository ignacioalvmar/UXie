# Runbook

Operations for UXie (PRD §17.2). Sections are added per milestone.

## Local development stack

Requires Docker Desktop.

```bash
pnpm exec supabase start        # Postgres, Auth, Storage, Studio, Mailpit; applies migrations + seed
pnpm exec supabase status -o env  # URL and keys for .env (NEXT_PUBLIC_SUPABASE_URL, …)
pnpm exec supabase db reset     # re-apply migrations and supabase/seed.sql
pnpm test:db                    # RLS matrix + repositories against the running stack
```

Seeded accounts (synthetic, local only; password in `packages/db/scripts/seedData.ts`):
`instructor@thi.de`, `student.a@thi.de`, `student.b@thi.de`. Verification and reset emails are
caught by Mailpit at http://127.0.0.1:54324.

After editing the fixture paper, regenerate the seed: `pnpm --filter @uxie/db seed:generate`.

## Supabase project setup (hosted dev and prod, EU Frankfurt)

`supabase/config.toml` configures the local stack only. For each hosted project:

1. Create the project in region **Frankfurt (eu-central-1)**; one for dev, one for prod (NFR-5).
2. Apply migrations: `pnpm exec supabase link --project-ref <ref>` then `pnpm exec supabase db push`.
   Never run `seed.sql` against production.
3. **Auth → Providers → Email**: confirm email ON; minimum password length 10; leaked password
   protection ON (FR-1.1, FR-1.2).
4. **Auth → Hooks → Before user created**: Postgres function `public.hook_before_user_created`
   (FR-1.1). Check `public.auth_allowed_domains` matches `ALLOWED_EMAIL_DOMAINS`
   (`pnpm uxie doctor` reports a mismatch).
5. **Auth → URL configuration**: Site URL = `APP_URL`; redirect allow-list
   `APP_URL/auth/callback`.
6. **Auth → SMTP**: custom EU-capable provider, sender `auth@<domain>` (D15, PRD §5). The built-in
   mailer is not acceptable in production.
7. **API keys**: copy the publishable and secret keys into Vercel (and Render for the worker).
   Generate `SETTINGS_ENCRYPTION_KEY` once (`openssl rand -base64 32`) and set it in Vercel and
   Render only. Losing it means re-entering provider keys on `/admin/settings/ai`.
8. Make the instructor: register normally, then `pnpm uxie role set <email> instructor` with the
   project's env.

## Changing the allowed email domains

Update `ALLOWED_EMAIL_DOMAINS` in Vercel **and** the table the sign-up hook reads:

```sql
delete from public.auth_allowed_domains;
insert into public.auth_allowed_domains (domain) values ('thi.de'), ('studmail.thi.de');
```

## Rotating the settings encryption key

Set the new `SETTINGS_ENCRYPTION_KEY` in Vercel and Render, redeploy, then re-enter each provider
key on `/admin/settings/ai` (the page flags keys that no longer decrypt). Env keys keep working
meanwhile.

## Ingestion worker (FR-5.1, FR-9.5)

The Render worker polls `ingest_jobs` every `WORKER_POLL_MS`: it upserts `worker_heartbeats`
(`ingest-worker`), re-queues jobs `running` longer than `WORKER_JOB_TIMEOUT_MS` (after 2 attempts the
job and its version fail), then claims one job with `claim_ingest_job()`. Two kinds: `ingest`
(download the PDF, extract, analyse, draft the guide) and `draft_guide` ("Regenerate draft"). Guide
drafting uses the effective AI settings, so the worker needs `SETTINGS_ENCRYPTION_KEY` as well as
the Supabase keys.

- **Stuck "Processing…"**: check the heartbeat (`select * from worker_heartbeats`) and the Render
  logs (`job_error`, `poll_failed`). A restart is safe: a job interrupted mid-run is re-queued by the
  timeout and runs again (pages are replaced, not duplicated).
- **Version failed with "no extractable text"**: the PDF is scanned. With `DOCLING_URL` set, use
  "Retry with docling (OCR)" on the version page; otherwise upload a PDF with a text layer.
- **Locally**: `pnpm --filter @uxie/worker dev` with the Supabase vars in `.env` (or exported).
