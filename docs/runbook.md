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
6. **Auth → SMTP**: Twilio SendGrid (D15, ADR-030): host `smtp.sendgrid.net`, port 465, user
   `apikey`, password = a restricted Mail-Send key, sender `auth@<domain>`. The built-in mailer is
   not acceptable in production. Then raise Auth → Rate limits → emails per hour.
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

## Production setup (M10, PRD §17.1)

The click-by-click version of this section, with SendGrid, is
[deployment-guide.md](deployment-guide.md); this is the summary.

Order matters: database first, then the worker, then the web app, then DNS and mail. Record the
values (not the secrets) in the launch checklist. Dev and prod are separate Supabase projects
(NFR-5); Vercel Preview uses dev, Production uses prod.

1. **Supabase prod project**: as "Supabase project setup" above (Frankfurt; Pro plan for daily
   backups, D14). Storage → Settings: upload size limit ≥ `MAX_PDF_MB` (the bucket allows 40 MB).
   Apply migrations with the **DB migrate** GitHub Action (below), never `seed.sql`.
2. **GitHub**: Settings → Environments → `dev` and `production` (production: required reviewer =
   the owner), each with `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`.
3. **Email provider** (D15: Twilio SendGrid, ADR-030): Sender Authentication → authenticate
   `<domain>` (automated security on: three CNAMEs cover SPF and DKIM); Tracking → click and open
   tracking **off**; two restricted API keys with Mail Send only: one for `auth@<domain>`
   (Supabase Auth → SMTP), one for the app sender `MAIL_FROM` (e.g. `UXie <uxie@<domain>>`,
   `SMTP_URL=smtps://apikey:<key>@smtp.sendgrid.net:465`).
4. **Namecheap → Advanced DNS** for `<domain>`:
   - `CNAME uxie → <value Vercel shows>` (after step 6),
   - SendGrid's three CNAMEs (`em…`, `s1._domainkey`, `s2._domainkey`; SPF is handled by the
     `em…` CNAME, so no `TXT @` change is needed),
   - `TXT _dmarc → v=DMARC1; p=quarantine; rua=mailto:<owner>`,
   - optionally `CAA @ 0 issue "letsencrypt.org"` (Vercel's CA).
5. **Supabase Auth (prod)**: Site URL `https://uxie.<domain>`; redirect allow-list
   `https://uxie.<domain>/auth/callback` only (preview wildcards belong on the dev project);
   custom SMTP from step 3 with sender `auth@<domain>`; email templates branded "UXie";
   leaked-password protection on; the before-user-created hook (step 4 of the project setup).
6. **Render**: New → Blueprint → this repo; `render.yaml` creates `uxie-worker` (Frankfurt) and the
   `uxie-prod` env group. Enter the secrets (`LLM_API_KEY`, Supabase URL/keys,
   `SETTINGS_ENCRYPTION_KEY`). The worker has no public port; it is healthy when `/admin/health`
   shows a fresh heartbeat.
7. **Vercel**: import the repo, Root Directory `apps/web`, framework Next.js, plan Pro (D14).
   Production env = prod values; Preview env = dev values. Required: `APP_URL`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `SETTINGS_ENCRYPTION_KEY`, `LLM_PROVIDER` + key, `LLM_PRICES_JSON`, `ALLOWED_EMAIL_DOMAINS`,
   `PRIVACY_NOTICE_VERSION`, `RESEARCH_CONSENT_VERSION`, `MONTHLY_SPEND_CEILING_EUR`,
   `ALERT_EMAIL`, `SMTP_URL`, `MAIL_FROM`, `RETENTION_REVIEW_DATE`. Domains → add
   `uxie.<domain>` → create the CNAME it shows (step 4); Vercel issues the certificate.
8. **First instructor**: register on the production URL, then
   `pnpm uxie role set <email> instructor` with the prod env exported.
9. **Check**: `pnpm uxie doctor --launch` and `pnpm uxie doctor --ping` with the prod env, then
   the [launch checklist](launch-checklist.md).

Security headers (NFR-9) need no setup: `proxy.ts` sets a per-request nonce
Content-Security-Policy (no `unsafe-eval`, `frame-ancestors 'none'`, `connect-src` limited to the
Supabase URL) and `next.config.ts` adds HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy` and
`Permissions-Policy`. Check with `curl -sI https://uxie.<domain>/auth/sign-in`. A new external
origin (e.g. a CDN) must be added to `lib/security.ts`, or the browser blocks it.

## Releases and rollback (NFR-17)

- **Release** = merge to `main`. Vercel and Render both deploy that commit. A PR with a migration:
  run **DB migrate** (Actions tab; `dry_run` first, then for real; dev, then production) _before_
  merging. Migrations stay backward-compatible for one release, so the previous deployment keeps
  working against the new schema.
- **Rollback (web)**: Vercel → Deployments → the previous production deployment → "Promote to
  Production" (instant; deployments are immutable). Then sign in, open a paper, chat once.
- **Rollback (worker)**: Render → `uxie-worker` → Events → the previous deploy → "Rollback".
- **Database**: no down-migrations. Fix forward with a new migration, or restore (below).
- **Rollback drill** (before launch, then once per semester): promote the previous deployment,
  verify as above, promote the latest again; note the date in the launch checklist.

## Backup and restore drill (NFR-16)

Supabase Pro takes daily backups (PITR as an add-on). Monthly during the pilot, restore into a
**scratch** project, never over production:

1. Supabase → prod project → Database → Backups → pick yesterday's backup → "Restore to new
   project" (or download the backup and `psql` it into a fresh scratch project in Frankfurt).
2. In the scratch project's SQL editor: `select public.reapply_deletion_ledger();` (deletions made
   after the backup), then `select count(*) from profiles p join deletion_ledger d using
(pseudonym_id);` must be 0.
3. Spot-check: `select count(*) from conversations;`, `messages`, the newest `messages.created_at`
   (≈ backup time), `select count(*) from storage.objects where bucket_id = 'papers';`.
4. Optional: point a local web app at the scratch project (`apps/web/.env.local`) and open a paper
   as the instructor.
5. Delete the scratch project; write the date, backup timestamp and row counts in the launch
   checklist / this runbook's log.

A real restore = the same steps into a new project, then switch Vercel and Render to its URL and
keys, re-run the auth settings (Production setup step 5) and announce the data loss window.

## Worker restarts (NFR-17)

On `SIGTERM` (deploy, restart, scale) the worker stops claiming jobs and gives the current job
`WORKER_SHUTDOWN_GRACE_MS` (20 s) to finish. After that the job is aborted and re-queued at once
(the log shows `job_requeued_on_shutdown`; the attempt is not counted) and the next worker picks it
up. A hard kill leaves the job `running` until `WORKER_JOB_TIMEOUT_MS` (15 min) re-queues it.
Keep the grace below Render's shutdown delay (30 s).

## Alerts and routines (PRD §17.2)

- **Spend alert**: the first tutor turn after this month's spend reaches 80 % of
  `MONTHLY_SPEND_CEILING_EUR` emails `ALERT_EMAIL` (needs `SMTP_URL`/`MAIL_FROM`), once per month
  (`alerts_sent` table). `/admin` shows the same warning. At 100 % new replies stop for everyone
  (`chat_paused`); raise the ceiling in Vercel and redeploy, or wait for the next month.
- **Weekly during the pilot**: `/admin/usage` (spend, cache hit ratio, errors), `/admin/data-requests`
  (due dates), `/admin/health`, the class reports (invalid-citation rate, helpfulness), feedback
  comments on `/admin/conversations?feedback=1`.
- **Provider or model change**: re-run the eval (`pnpm uxie eval`, PRD §13) and add an ADR before
  switching production; list the provider in the privacy notice first.
- **Each semester**: rotate the Anthropic key and the Supabase secret key (Vercel env + Render env
  group only; redeploy both) and the two SendGrid keys (Supabase Auth → SMTP; `SMTP_URL` in
  Vercel); export if permitted, then `pnpm uxie purge --before <date>`
  (Retention above); rollback drill; update `RETENTION_REVIEW_DATE`.
