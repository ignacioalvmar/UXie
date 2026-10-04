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

## Data requests and deletion (FR-8.1–8.3)

- **Data download** is self-service (`/account` → "Download my data"); each download is logged as a
  completed `access` request and listed under `/admin/data-requests` → Closed.
- **Deletion requests** appear under `/admin/data-requests` with their due date (30 days); the admin
  overview shows a red banner when one is overdue. Students can withdraw a request until you mark it
  "in progress". Reject only with a reason (e.g. a legal retention obligation) and tell the student.
- **Completing a deletion** (type the pseudonym to confirm) runs `complete_deletion()` in one
  transaction: `deletion_ledger` row (pseudonym + auth id), the request is closed with `student_id`
  null, and the auth user is deleted, which cascades profile, conversations, messages, feedback,
  usage and events. `llm_calls` keep their cost rows without the conversation link. The page then
  sends the confirmation email over `SMTP_URL`; without SMTP it shows "Open it in your mail program"
  (a prepared `mailto:`). Send it before leaving the page: the address is gone afterwards.
- **Instructor accounts** are refused (change the role first with `pnpm uxie role set`).

### After a backup restore

A restored backup brings deleted students back. Re-apply the ledger before reopening the app:

```sql
select public.reapply_deletion_ledger();   -- returns the number of accounts deleted again
```

Run it in the SQL editor of the restored project (it is not callable from the app). Check
`select count(*) from profiles p join deletion_ledger d using (pseudonym_id)` is 0 afterwards.

### Exports already shared

Deletions do not reach copies outside UXie. Research exports exclude deleted students and pending
deletions from the moment of the request. If a deleted student appears in an export you shared
(see `/admin/exports` → Export log for when and what), ask the recipients to delete the rows with
that pseudonym (the ledger lists it) and note it in the request.

## Retention (FR-8.4)

Set `RETENTION_REVIEW_DATE` (e.g. the end of the semester + the period in the privacy notice); the
admin overview reminds you 30 days ahead. Then:

```bash
pnpm uxie purge --before 2027-03-31 --dry-run    # counts only
pnpm uxie purge --before 2027-03-31              # deletes; an events row `retention_purge` records the counts
```

The purge removes conversations whose last activity is before the date (messages and feedback
cascade) for all students, test chats included; model-call cost rows stay without the link.
Export first (`pnpm uxie export --research --format csv --out …`) if consented research data must be
kept, and store it per the privacy notice.

## Reports, exports and costs (FR-7.x)

- `/admin/conversations`, `/admin/reports`, `/admin/exports`, `/admin/usage`, `/admin/health`;
  the same from the CLI: `pnpm uxie report <paper> [--named]`, `pnpm uxie costs [--month 2026-10]`,
  `pnpm uxie export [--paper p] [--research] --format csv|json --out file`.
- "Reveal identity" on a transcript and `report --named` show emails; both are for contacting a
  student, never for grading. Reveals are logged (`events.type = 'identity_revealed'`).
- Every export (web and CLI) writes `export_log`. Store export files encrypted and delete them when
  the purpose ends.
