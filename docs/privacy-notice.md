# Privacy notice (source)

The text students see on `/onboarding` and `/privacy` lives in
[`apps/web/content/privacy-notice.md`](../apps/web/content/privacy-notice.md) so the web app can
ship it. It is a draft: the owner completes the bracketed parts (controller, lawful bases,
retention, providers and regions, contacts; PRD FR-8.5, NFR-2) and has it approved before launch.

After any change, raise `PRIVACY_NOTICE_VERSION` (and `RESEARCH_CONSENT_VERSION` if the research
paragraph changed) in Vercel's env: every student must then acknowledge the new version (FR-1.3).
