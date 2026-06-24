# 0019 — Amazon SES + Listmonk for email (Resend excluded)

**Status:** accepted
**Date:** 2026-06-20
**Deciders:** Brian Zalewski

## Context

The convergence spec §4 (Exclude List) forbids Resend, and §42 mandates **Amazon
SES** for transactional email plus **Listmonk** (SES SMTP relay) for newsletters/
campaigns. The repo currently references Resend in **~34 source files** (concentrated
in `src/services/`, `src/routes/`, and `libs/features/email_marketing/`) — the single
largest piece of excluded-vendor drift in the convergence. This ADR records the
decision and makes the Resend references a **documented, tracked migration** rather
than untracked drift, so the architecture-fitness gate can burn them down without
blocking every deploy in the interim.

## Decision

- **Amazon SES** is the primary transactional email provider (magic links, claim
  verification, receipts, billing/security/domain-verification emails, the Novu email
  channel, and Listmonk's SMTP delivery). SigV4 raw-send from the Worker; no npm SDK.
- **Listmonk** (`mail.projectsites.dev`, CF Container) owns newsletters, campaigns,
  outreach lists, subscriber/segment management, and unsubscribe handling — sending
  through SES SMTP.
- Email flows sit behind an `EmailProvider` / `MarketingEmailProvider` port
  (`AmazonSesEmailProvider`, `ListmonkMarketingEmailProvider`) with a fake provider for
  local/no-vendor mode (§16). Routing: transactional/critical → SES; bulk → Listmonk.
- **Resend is `deprecated`** in the service registry (`email-resend`) and **excluded**
  in `EXCLUDED_VENDORS`. New code MUST NOT import or call Resend.

## Consequences

- Positive: one delivery substrate (SES) under both transactional and bulk, lower cost,
  no Resend dependency, deliverability owned (SPF/DKIM/DMARC on `projectsites.dev`).
- Negative: ~34 files to migrate off Resend; SES SigV4 + SMTP-password derivation is
  more setup than the Resend SDK.
- Neutral: `scripts/check-architecture-fitness.mjs` reports Resend refs as
  `tracked-migration (ADR-0019)` (non-blocking) while the clean exclude-list
  (polar/trigger.dev/postmark/clay/socket.dev/chainguard = 0) is locked as a hard
  regression guard. When Resend refs reach 0, drop the `documented` tag so any
  reintroduction hard-fails CI (maturity-ladder promotion).

## Alternatives considered

- **Keep Resend** — rejected: excluded by §4; the platform standardizes on SES+Listmonk.
- **Postmark** — rejected: also on the §4 exclude list.
- **SES only (no Listmonk)** — rejected: SES is not a campaign/subscriber manager;
  Listmonk provides lists/segments/unsubscribe/campaign analytics over SES SMTP.

## Migration notes

1. Introduce the `EmailProvider`/`MarketingEmailProvider` ports + SES/Listmonk/fake
   providers (a future slice).
2. Replace Resend call sites file-by-file, transactional first (auth/claim/billing),
   each with a test, behind a `email.ses.enabled` flag.
3. Move `email_marketing` campaigns to Listmonk behind `email.listmonk.enabled`.
4. When `check-architecture-fitness --json` reports `by_vendor.resend == 0`, remove the
   `documented` tag on the Resend rule so reintroduction is a hard violation, and set
   `email-resend` registry status to `removed`.

## Operational risks

- SES sandbox/production access + verified domain required before cutover.
- Bounce/complaint/suppression handling must be wired (SES events → `email_events`/
  `email_suppressions`) before bulk sends.

## Rollback strategy

- The ports keep providers swappable; if SES is blocked at cutover, the fake provider
  (local) and a feature-flag-gated rollout mean partial migration is safe. Resend stays
  `deprecated` (not deleted) until SES is proven in prod, so a flag flip can revert a
  given flow.

## Migration progress (updated 2026-06-23)

**Step 2 (transactional call-site cutover) — COMPLETE.** All 10 platform transactional
senders route through the SES seam (`getEmailProvider`) as the PRIMARY rail when AWS
creds + `SES_FROM_EMAIL` are set; Resend/SendGrid remain fallback until SES is proven in
prod (progressive degradation by env, no flag needed):

- `services/notifications.ts`, `services/auth.ts` (magic-link), `services/contact.ts`,
  `routes/forms.ts` (send-reply), `services/inbox.ts` (email channel), `services/credits.ts`
  (billing alerts), `routes/search.ts` (`/api/contact-form/:slug`), `services/form_router.ts`
  (send_email), `routes/ai_admin.ts` (team invites), `services/weekly_digest.ts`.

Port enhancements landed for the cutover: `replyTo` (contact-form lead reply-to) and
`headers` (SES `Content.Simple.Headers` — weekly_digest one-click `List-Unsubscribe`).

**EXEMPT (not platform email — do NOT migrate):** `services/mcp_client.ts` (customer-
connected Resend MCP, uses the customer's `accessToken`) and `services/newsletter_dispatch.ts`
`dispatchResend` (customer-connected Resend Audiences, uses `requireApiKey(row)`). §4 bans
Resend as OUR rail, not as a customer-selectable integration.

**Remaining (prod-gated, steps 3-4):**
- Provision AWS SES prod secrets + verify `projectsites.dev` sending domain; send a real
  magic-link and confirm delivery from `noreply@projectsites.dev`.
- Wire SES bounce/complaint events into `email_events`/`email_suppressions`.
- Once verified live: delete the Resend fallback branches from the 10 files, then drop the
  Resend rule's `documented` tag (hard-block) + set `email-resend` registry status `removed`.
