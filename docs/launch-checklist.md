# Launch checklist (pilot)

PRD §17.3 and the M10 acceptance criteria (§16), with how to verify each item. The owner ticks the
boxes and fills in the dates; keep this file in git as the launch record. Steps referenced as
"runbook" are in [runbook.md](runbook.md).

Run the automated part first, with the **production** env exported (Vercel → Settings →
Environment Variables → Production, or the Render env group):

```bash
pnpm uxie doctor --launch      # ✗ blocks the launch, ! should be fixed, then the manual list below
pnpm uxie doctor --ping        # one tiny request per configured provider/model
```

## Decisions to confirm (PRD §19)

| #   | Decision                        | Working default                                           | Confirmed (date, value) |
| --- | ------------------------------- | --------------------------------------------------------- | ----------------------- |
| D1  | Data controller, product owner  | THI; Prof. Ignacio Alvarez                                |                         |
| D2  | Production provider/model       | Anthropic, Sonnet 5.5 tutor (low), Haiku 4.5 assessment   | ADR-023 (proposed)      |
| D8  | Retention                       | Purge 6 months after semester end                         |                         |
| D9  | Research basis, ethics approval | Consent-based exports, disabled until approved            |                         |
| D12 | Launch date                     | First weeks of WS 26/27 after the pilot week              |                         |
| D13 | Domain                          | `uxie.<owner's Namecheap domain>`, sender `auth@<domain>` |                         |
| D14 | Plans                           | Vercel Pro, Render Starter, Supabase Pro                  |                         |
| D15 | Transactional email             | Twilio SendGrid over SMTP (ADR-030)                       |                         |
| D17 | Providers enabled for the pilot | Anthropic only                                            |                         |

## §17.3 checklist

- [ ] **Provider chosen** via the M4 benchmark; capacity and monthly budget documented: change
      ADR-023 to `accepted` with the eval run (`eval-results/<date>/`) and the ceiling.
- [ ] **Provider terms reviewed** (region, retention, no training, subprocessors) and reflected in
      the privacy notice.
- [ ] **Privacy notice and research-consent text approved** (DPO / ethics); controller named. Edit
      `apps/web/content/privacy-notice.md` (remove the draft banner and every `[…]`), raise
      `PRIVACY_NOTICE_VERSION` (and `RESEARCH_CONSENT_VERSION` if the research paragraph changed).
      `doctor --launch` fails while placeholders remain.
- [ ] **DPAs accepted** for Vercel, Render, Supabase, the email provider and Anthropic; listed with
      regions in the privacy notice.
- [ ] **Custom domain live** on Vercel (HTTPS); **SPF/DKIM/DMARC verified**; Supabase Site URL and
      redirect allow-list set to the production URL (runbook → Production setup, steps 3–5).
- [ ] **SendGrid**: domain authenticated (green in Sender Authentication), click and open
      tracking **off**, two restricted Mail-Send keys (Supabase Auth, app); Supabase Auth → Rate
      limits → emails per hour raised for semester start ([deployment-guide.md](deployment-guide.md)
      steps 2–3).
- [ ] **Render worker healthy**: heartbeat green on `/admin/health`; docling deployed only if
      `EXTRACTOR=docling`.
- [ ] **HTTPS, custom SMTP, verification and reset tested in production** (acceptance 1 below).
- [ ] **≥ 3 real papers** ingested, extraction reviewed, guides approved, test-chatted by the
      instructor (`doctor --launch` counts published papers with an approved guide).
- [ ] **Eval thresholds (§1.6) met** on the production provider with the production prompts:
      `pnpm uxie eval <paper> --runs 3` with the production settings.
- [ ] **RLS, permissions, exports, deletion verified** in a production-like environment: run
      `pnpm test:db` against the local stack (CI does), then on the hosted **dev** project do the
      M9 manual steps 8–9 once (ADR-028 asks to verify `complete_deletion()` there).
- [ ] **Accessibility pass**: CI `e2e` job green (axe on every page) **and** the manual keyboard +
      screen-reader pass in [manual-tests.md](manual-tests.md) → M10.
- [ ] **Backup restore drill done; runbook complete** (runbook → Backup and restore drill).
- [ ] **Limits and spend ceiling configured; alert at 80 %**: `MONTHLY_SPEND_CEILING_EUR`,
      `DAILY_TURN_LIMIT`, `PER_MINUTE_TURN_LIMIT`, `ALERT_EMAIL` and `SMTP_URL`/`MAIL_FROM` set in
      Vercel.

## M10 acceptance criteria

1. [ ] `https://uxie.<domain>` serves the app with a valid certificate. Register a test student
       with a real university address: the verification email and a password-reset email arrive
       from `auth@<domain>`. In the mail client, "show original": `spf=pass`, `dkim=pass`
       (`header.d=<domain>`), `dmarc=pass`. Delete the test account afterwards
       (`/admin/data-requests`).
2. [ ] Upload a ~30 MB PDF on `/admin/content` (direct-to-Storage; the browser shows the upload
       progress) → the Render worker ingests it. During "Extracting text…", **restart the worker**
       in Render (Manual Deploy → Restart): the log shows `shutdown requested; finishing current
 job` (SIGTERM). If Render kills it before the job ends, the job is re-queued after
       `WORKER_JOB_TIMEOUT_MS` and completes (`/admin/versions/<id>` → Ready). Date: ______
3. [ ] **Rollback drill**: runbook → Releases and rollback. Promote the previous Vercel deployment,
       sign in, open a paper, chat once; then promote the latest again. Date: ______
4. [ ] Everything above ticked; launch date recorded: ______
