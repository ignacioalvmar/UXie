# Deployment guide (production)

Step by step, from empty accounts to a live pilot: **Supabase** (database, auth, storage),
**Twilio SendGrid** (email), **Render** (ingestion worker), **Vercel** (web app), **Namecheap**
(DNS). Follow the sections in order; each one needs values from the previous ones. The summary and
the day-2 operations are in [runbook.md](runbook.md); what to tick before launch is in
[launch-checklist.md](launch-checklist.md). Email decision: ADR-030.

Throughout, `<domain>` is your Namecheap domain. The app will live at `https://uxie.<domain>`, auth
mail comes from `auth@<domain>`, app mail from `uxie@<domain>`.

## 0. Before you start

1. Accounts: Supabase (Pro for daily backups), Render, Vercel (Pro), Twilio SendGrid, Namecheap,
   Anthropic (API key), GitHub access to `ignacioalvmar/UXie`. Accept each provider's DPA and note
   the date in the launch checklist.
2. Locally: Node 22, pnpm (`corepack enable`), `pnpm install` in the repo. Use Git Bash on Windows
   for the shell commands below.
3. Generate the settings encryption key **once** and keep it in your password manager:

   ```bash
   openssl rand -base64 32
   ```

4. Create a local, git-ignored file `.env.production.local` in the repo root. You will fill it while
   going through the steps; it is what the CLI uses against production (step 6). `.env.*` is in
   `.gitignore`; never commit it.

| Collect                           | From step | Used in                    |
| --------------------------------- | --------- | -------------------------- |
| Supabase project ref, DB password | 1.1       | GitHub secrets, CLI        |
| Supabase URL, publishable, secret | 1.6       | Render, Vercel, CLI        |
| SendGrid key `uxie-supabase-auth` | 2.4       | Supabase Auth SMTP         |
| SendGrid key `uxie-app`           | 2.4       | Vercel `SMTP_URL`          |
| Anthropic API key                 | 0.1       | Render, Vercel             |
| `SETTINGS_ENCRYPTION_KEY`         | 0.3       | Render, Vercel (identical) |

## 1. Supabase

Create a **prod** project now. A second **dev** project (same steps, Site URL = the Vercel preview
URL) is what Vercel Preview deployments use (NFR-5); you can add it after launch.

1. supabase.com → New project → organization → name `uxie-prod`, region **Frankfurt
   (eu-central-1)**, generate a strong database password (save it). The project ref is the
   `xxxxxxxx` in `https://xxxxxxxx.supabase.co`.
2. **Apply the migrations** (`supabase/migrations/0001…0008`). Recommended, through GitHub:
   - Supabase → Account → Access Tokens → generate a token.
   - GitHub repo → Settings → Environments → New `production` → required reviewer = you → add
     secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`. (Same for a
     `dev` environment later.)
   - Actions → **DB migrate** → Run workflow → environment `production`, `dry_run` ✓ → check the
     list shows 0001–0008 → run again with `dry_run` unticked.

   Alternative from your machine:

   ```bash
   pnpm exec supabase link --project-ref <ref>
   ```

   ```bash
   pnpm exec supabase db push
   ```

   Never run `supabase/seed.sql` against production (it creates test accounts).

3. Check: Table Editor lists `profiles`, `papers`, `conversations`, …; Storage shows the `papers`
   bucket. Storage → Settings → upload file size limit ≥ 40 MB (`MAX_PDF_MB`).
4. **Authentication → Sign In / Providers → Email**: "Confirm email" ON; minimum password length
   10; "Prevent use of leaked passwords" ON.
5. **Authentication → Hooks → Before User Created** → type Postgres → function
   `public.hook_before_user_created` → enable. In the SQL editor confirm the allowed domains:

   ```sql
   select * from public.auth_allowed_domains;   -- thi.de, studmail.thi.de
   ```

6. **Project Settings → API Keys**: copy the Project URL, the **publishable** key and the
   **secret** key into `.env.production.local` as `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.

URL configuration and SMTP follow in step 3, once mail is ready.

## 2. Twilio SendGrid

1. app.sendgrid.com → **Settings → Sender Authentication → Authenticate Your Domain**. DNS host:
   Namecheap. Link branding: No (not needed). Domain: `<domain>` (the root domain, not `uxie.`).
   Advanced settings: keep **automated security** on. SendGrid shows three CNAME records:
   `em1234.<domain>`, `s1._domainkey.<domain>`, `s2._domainkey.<domain>`.
2. Namecheap → Domain List → `<domain>` → **Advanced DNS** → Add new record for each:
   - Type CNAME, Host = the name **without** `.<domain>` (e.g. `em1234`, `s1._domainkey`), Value =
     SendGrid's target, TTL automatic.
   - DMARC: Type TXT, Host `_dmarc`, Value `v=DMARC1; p=quarantine; rua=mailto:<your address>`.
   - No SPF `TXT @` change is needed: the `em…` CNAME carries SendGrid's SPF.

   Back in SendGrid press **Verify** (DNS can take up to an hour). All three rows must be green.

3. **Settings → Tracking**: turn **Click Tracking OFF** and **Open Tracking OFF** (also
   Subscription Tracking and Google Analytics off). Click tracking rewrites the verification and
   reset links through SendGrid; this breaks or delays them and exposes the tokens (ADR-030).
4. **Settings → API Keys → Create API Key** → Restricted Access → only **Mail Send: Full Access** →
   name `uxie-supabase-auth`. Copy it (shown once). Repeat for `uxie-app`.
5. Data residency: if your SendGrid plan offers EU data residency, use it and note it; otherwise
   SendGrid processes in the US. Either way, fill the bracket in
   `apps/web/content/privacy-notice.md` (hosting providers) and have the DPO confirm it.
6. Optional sanity check: Email API → Integration guide → SMTP Relay sends a test, or wait for the
   real tests in step 6.

## 3. Supabase Auth: mail and URLs

1. **Authentication → Emails → SMTP Settings** → Enable custom SMTP:
   - Sender email `auth@<domain>`, sender name `UXie`
   - Host `smtp.sendgrid.net`, port `465`
   - Username `apikey` (literally this word), password = the `uxie-supabase-auth` key
   - Minimum interval per user: keep the default (60 s, matches the "Resend email" button).
2. **Authentication → Rate Limits** → "Rate limit for sending emails": custom SMTP starts low (30 per
   hour); raise to e.g. 200 per hour before the first lecture, when a whole cohort registers.
3. **Authentication → URL Configuration**: Site URL `https://uxie.<domain>`; Redirect URLs: add
   `https://uxie.<domain>/auth/callback` only. (Dev project: its own preview URLs, e.g.
   `https://*-<team>.vercel.app/auth/callback`.)
4. **Authentication → Emails → Templates**: brand "Confirm signup" and "Reset password" with "UXie"
   in subject and text. Keep the `{{ .ConfirmationURL }}` placeholder.

## 4. Render (ingestion worker)

1. dashboard.render.com → **New → Blueprint** → connect GitHub → repository `UXie`, branch `main`.
   Render reads `render.yaml` and proposes the `uxie-worker` background worker (Frankfurt, Starter;
   background workers are a paid service) and the env group `uxie-prod`.
2. Fill in the secrets it asks for (all `sync: false` keys):
   - `LLM_API_KEY` = Anthropic key
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
   - `SETTINGS_ENCRYPTION_KEY` (the same value Vercel gets)

   The worker sends no email: no SMTP variables here.

3. Apply → the first deploy runs `pnpm install` and `pnpm --filter @uxie/worker start`. Logs:
   no `Invalid configuration` (it lists any missing variable by name) and no `poll_failed`.
   `autoDeploy` redeploys on every push to `main`.

## 5. Vercel (web app)

1. vercel.com → **Add New → Project** → import `ignacioalvmar/UXie`.
   - Root Directory: `apps/web` (keep "Include files outside the root directory" enabled; the app
     reads `packages/*` and `prompts/`).
   - Framework: Next.js (detected). Build and install commands: defaults (pnpm is detected from
     `pnpm-lock.yaml`). Region comes from `apps/web/vercel.json` (`fra1`).
   - Settings → General → Node.js Version 22.x.
2. **Environment Variables**, scope **Production** (the Preview scope gets the dev project values
   later):

   | Variable                               | Value                                                                  |
   | -------------------------------------- | ---------------------------------------------------------------------- |
   | `APP_URL`                              | `https://uxie.<domain>`                                                |
   | `NEXT_PUBLIC_SUPABASE_URL`             | from 1.6                                                               |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from 1.6                                                               |
   | `SUPABASE_SECRET_KEY`                  | from 1.6 (mark Sensitive)                                              |
   | `SETTINGS_ENCRYPTION_KEY`              | from 0.3, same as Render                                               |
   | `LLM_PROVIDER`                         | `anthropic`                                                            |
   | `LLM_API_KEY`                          | Anthropic key                                                          |
   | `LLM_TUTOR_MODEL` / `LLM_STATE_MODEL`  | `claude-sonnet-5-5` / `claude-haiku-4-5`                               |
   | `LLM_PRICES_JSON`                      | copy the line from `.env.example`                                      |
   | `ALLOWED_EMAIL_DOMAINS`                | `thi.de,studmail.thi.de`                                               |
   | `PRIVACY_NOTICE_VERSION`               | date of the approved notice, e.g. `2026-10-15`                         |
   | `RESEARCH_CONSENT_VERSION`             | date of the approved consent text                                      |
   | `MONTHLY_SPEND_CEILING_EUR`            | e.g. `100`                                                             |
   | `DAILY_TURN_LIMIT`                     | `120`                                                                  |
   | `PER_MINUTE_TURN_LIMIT`                | `8`                                                                    |
   | `ALERT_EMAIL`                          | your address (spend alert at 80 %)                                     |
   | `RETENTION_REVIEW_DATE`                | e.g. `2027-09-30`                                                      |
   | `SMTP_URL`                             | `smtps://apikey:<uxie-app key>@smtp.sendgrid.net:465` (mark Sensitive) |
   | `MAIL_FROM`                            | `UXie <uxie@<domain>>`                                                 |

   Leave `LLM_TEMPERATURE` unset (Sonnet 5.5 rejects it). `NODE_ENV` is set by Vercel. Put the same
   values in `.env.production.local`, plus `NODE_ENV=production`.

3. **Deploy**, then open the deployment URL. An invalid or missing variable makes the first request
   fail; Vercel → Logs shows `Invalid configuration` with the variable names. Changes to
   `NEXT_PUBLIC_*` need a redeploy (they are baked in at build time).
4. **Settings → Domains** → add `uxie.<domain>` → Vercel shows a CNAME target. In Namecheap →
   Advanced DNS: Type CNAME, Host `uxie`, Value = that target. Optional: `CAA @ 0 issue
"letsencrypt.org"`. Wait until Vercel shows "Valid Configuration" and the certificate is issued.
5. Check the security headers:

   ```bash
   curl -sI https://uxie.<domain>/auth/sign-in
   ```

   Expect `content-security-policy`, `strict-transport-security`, `x-frame-options: DENY`.

## 6. Go live

1. **First instructor**: open `https://uxie.<domain>`, register with your `@thi.de` address. The
   verification mail must arrive from `auth@<domain>` (check SendGrid → Activity if not). After
   verifying, promote yourself from your machine:

   ```bash
   set -a; . ./.env.production.local; set +a; pnpm uxie role set <your email> instructor
   ```

2. **Automated checks** (same exported env):

   ```bash
   set -a; . ./.env.production.local; set +a; pnpm uxie doctor --launch
   ```

   ```bash
   set -a; . ./.env.production.local; set +a; pnpm uxie doctor --ping
   ```

   `✗` blocks the launch, `!` should be fixed. Expected until the end of the launch checklist: the
   privacy-notice placeholders and "fewer than 3 papers".

3. **Worker**: `/admin/health` shows a fresh `ingest-worker` heartbeat. Upload one PDF on
   `/admin/content` and watch it reach "Ready".
4. **Mail**:
   - Sign out → "Forgot password" → the reset mail arrives and the link opens
     `https://uxie.<domain>/auth/...` directly (not a `sendgrid.net` redirect).
   - In the mail client "Show original": `spf=pass`, `dkim=pass` with `header.d=<domain>`,
     `dmarc=pass`.
   - App mail (`SMTP_URL`): register a second test student, request deletion on `/account`,
     complete it on `/admin/data-requests`; the confirmation mail arrives from `uxie@<domain>`.
5. Work through [launch-checklist.md](launch-checklist.md): privacy notice approved, ≥ 3 papers,
   eval, accessibility pass, backup and rollback drills.

## 7. After launch

- **Release** = merge to `main`; Vercel and Render deploy it. If the PR adds a migration, run
  **DB migrate** (dry run, then real) _before_ merging.
- **Rollback**, **backups**, **retention**, **alerts**, **key rotation** (Anthropic, Supabase
  secret, both SendGrid keys, each semester): [runbook.md](runbook.md).

## Troubleshooting

| Symptom                                                    | Cause and fix                                                                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up shows "Error sending confirmation email"           | Supabase SMTP: username must be `apikey`; key lacks Mail Send; sender domain not verified in SendGrid. Supabase → Logs → Auth shows the SMTP error. |
| Links in mails go through `sendgrid.net` or `ct.sendgrid…` | Click tracking is on (step 2.3). Turn it off; already sent mails keep the rewritten link.                                                           |
| Mail lands in spam, `dkim=fail`                            | CNAMEs missing or typed with the domain twice (`s1._domainkey.<domain>.<domain>`). Fix in Namecheap, Verify again in SendGrid.                      |
| "Email rate limit exceeded" at semester start              | Supabase Auth rate limit (step 3.2).                                                                                                                |
| Sign-up refused for a valid university address             | Domain missing from `public.auth_allowed_domains` or `ALLOWED_EMAIL_DOMAINS` (runbook → Changing the allowed email domains).                        |
| After clicking the verify link: "redirect not allowed"     | Redirect URL list in Supabase (step 3.3) does not contain `https://uxie.<domain>/auth/callback`, or `APP_URL` differs from the real domain.         |
| Render or Vercel log: `Invalid configuration: - X: …`      | The named variable is missing or malformed in Render / Vercel; values are never printed.                                                            |
| Papers stay "Processing…"                                  | Worker down or wrong Supabase keys: Render logs, `/admin/health` (runbook → Ingestion worker).                                                      |
| Browser console: blocked by Content-Security-Policy        | A new external origin; add it in `apps/web/lib/security.ts`.                                                                                        |
| Deletion confirmation shows "Open it in your mail program" | `SMTP_URL`/`MAIL_FROM` not set in Vercel, or the SendGrid `uxie-app` key was revoked; check Vercel → Logs for the mail error.                       |
