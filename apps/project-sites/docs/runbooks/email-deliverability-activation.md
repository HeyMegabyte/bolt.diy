# Runbook — Activate the SES Email + Deliverability Pipeline (§4/§42, ADR-0019)

This loop built the full Resend→SES transactional migration **and** the SES
bounce/complaint suppression pipeline behind progressive-degradation env gates.
The code ships dark: with no AWS creds it falls back to Resend, and with no
`SES_WEBHOOK_SECRET` the webhook 503s. These are the operator steps to turn it
on. Each step is independent and reversible.

## What is already built (no code work remaining)

- **10 transactional senders** route SES-primary when configured (notifications,
  auth magic-link, contact, forms send-reply, inbox, credits alerts, public
  contact-form, form_router, ai_admin invites, weekly_digest). Resend/SendGrid
  remain the fallback. (`src/platform/email-router.ts`, `services/ses_email_provider.ts`.)
- **Suppression pipeline**: parse (`services/ses_notifications.ts`) → store
  (`services/email_suppressions.ts`, migration `0575`) → webhook
  (`routes/ses_webhooks.ts`, `POST /webhooks/ses`) → enforce (fail-open
  `isSuppressed` check in the email-router) → manage (super-admin
  `GET`/`DELETE /api/super-admin/email-suppressions`).

## Step 1 — Apply the D1 migration (creates the suppression tables)

`wrangler deploy` does NOT run D1 migrations (repo's standing pattern). Run:

```bash
cd apps/project-sites
npx wrangler d1 migrations apply project-sites-db-production --env production --remote
# verify:
npx wrangler d1 execute project-sites-db-production --env production --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('email_suppressions','email_events');"
```

Expect both `email_suppressions` and `email_events` listed.

## Step 2 — Verify the SES sending domain + set the SES env

Requires `noreply@projectsites.dev` verified in SES (DKIM/SPF) + production SES
access (out of sandbox) before real sends.

```bash
npx wrangler secret put AWS_ACCESS_KEY_ID --env production
npx wrangler secret put AWS_SECRET_ACCESS_KEY --env production
# vars (wrangler.toml [env.production.vars] or secret):
#   AWS_DEFAULT_REGION = us-east-1   (or your SES region)
#   SES_FROM_EMAIL     = noreply@projectsites.dev
```

The moment all three of `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` +
`SES_FROM_EMAIL` are set, every transactional send flips to SES-primary.

## Step 3 — Generate + set the webhook HMAC secret

Self-generable (we control both signer + verifier). NOT a vendor cred.

```bash
SES_WEBHOOK_SECRET=$(openssl rand -base64 32)
echo "$SES_WEBHOOK_SECRET" | npx wrangler secret put SES_WEBHOOK_SECRET --env production
# keep $SES_WEBHOOK_SECRET — Step 4 configures Hookdeck/SNS to sign with it.
```

## Step 4 — Wire SES → SNS → /webhooks/ses (HMAC-signed)

1. In SES, set the configuration set / identity to publish **Bounce** +
   **Complaint** events to an SNS topic.
2. Point an HTTPS subscription at `https://api.projectsites.dev/webhooks/ses`,
   forwarded through Hookdeck (preferred) so Hookdeck verifies the raw SNS
   signature and re-signs with HMAC using `$SES_WEBHOOK_SECRET` in the
   `x-hookdeck-signature` header. (Direct SNS also works if it can HMAC-sign.)
3. The first delivery is a `SubscriptionConfirmation` — the handler auto-confirms
   it (SSRF-guarded to `sns.*.amazonaws.com` only).

## Step 5 — End-to-end verify

```bash
# Trigger a hard bounce via the SES simulator (sends FROM your verified domain):
#   send any transactional email to: bounce@simulator.amazonses.com
# Then confirm the address was suppressed:
npx wrangler d1 execute project-sites-db-production --env production --remote \
  --command "SELECT email, reason FROM email_suppressions ORDER BY created_at DESC LIMIT 5;"
```

Expect `bounce@simulator.amazonses.com` with `reason='bounce'`. A subsequent send
to it is skipped by the fail-open `isSuppressed` check (structured log
`send_skipped_suppressed`).

Operators view/manage the list at `GET /api/super-admin/email-suppressions` and
un-suppress via `DELETE /api/super-admin/email-suppressions/:email` (audited).

## Step 6 — Decommission Resend (only after SES is proven live)

Once Step 5 passes in prod for ≥48h:

1. Delete the Resend fallback branches from the 10 senders (each keeps SES + the
   structured logs).
2. In `scripts/check-architecture-fitness.mjs`, drop `documented: 'ADR-0019'`
   from the `resend` rule so any reintroduction is a HARD violation, and set the
   `email-resend` registry status to `removed`.
3. Verify `node scripts/check-architecture-fitness.mjs` reports
   `by_vendor.resend == 0` and the gate is green.

## Rollback

- Unset `AWS_*`/`SES_FROM_EMAIL` → senders fall back to Resend instantly (no
  redeploy needed — progressive degradation by env).
- Unset `SES_WEBHOOK_SECRET` → the webhook 503s (stops ingesting suppressions).
- D1 Time Travel restores `email_suppressions` if a bad bulk-suppress lands.

## See

- `docs/adr/0019-amazon-ses-plus-listmonk-email.md` — the decision + migration log.
- `~/.agentskills/rules/email-deliverability.md` — the cross-project doctrine.
