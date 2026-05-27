# SECURITY.md — projectsites.dev v2

> **Owner:** Architect. Reviewer: Brian Zalewski.
> **Posture:** Practical, layered, honest. We ship the controls that pay for themselves
> at our threat profile (consumer SaaS + marketplace + tenant content + payments through
> Stripe). We explicitly defer controls whose engineering cost outweighs the marginal
> risk reduction at our current scale.
> **Last reviewed:** 2026-05-26.

This document records two lists:

1. **What we ship.** Concrete controls live in the codebase today.
2. **What we explicitly skip — and why.** Deferred per the v2 doctrine §17 and §25. Every
   skip is justified, scoped, and re-evaluated on the schedule in § 9.

Pretending we ship controls we don't, or skipping controls without naming them, is the
failure mode this doc exists to prevent.

---

## 1. Threat model summary

**Asset taxonomy:**

| Tier | Asset | Compromise impact |
|------|-------|-------------------|
| Critical | Stripe live keys, Stripe Connect account access | Direct financial loss |
| Critical | Tenant D1 databases (per-tenant data) | Cross-tenant data leak, GDPR/CCPA fine |
| Critical | Platform D1 (users, sessions, audit log) | Account takeover, audit-log tampering |
| High | R2 tenant content (uploaded files, generated sites) | Tenant data exposure, abuse |
| High | Clerk session JWT signing keys | Session forgery |
| High | Workers AI / OpenAI / Anthropic API keys | Runaway spend |
| Medium | Cloudflare API tokens (scoped) | Infrastructure modification |
| Medium | Resend / SendGrid API keys | Phishing as us |
| Low | PostHog API key (write-only) | Analytics noise |
| Low | Sentry DSN | Error noise |

**Threat actors we plan for:**

1. **Opportunistic abuse** — credential stuffing, scraping, spam form submissions, brute
   force on tenant login pages. **Mitigated by Turnstile + rate limiting + WebAuthn**.
2. **Tenant-vs-tenant data attempts** — a malicious tenant trying to read another
   tenant's data. **Mitigated by per-tenant D1 isolation** (ADR-0008).
3. **Account takeover** — phishing or credential theft against tenants or admins.
   **Mitigated by mandatory 2FA on payouts + WebAuthn passkeys**.
4. **Insider risk** — us. **Mitigated by audit log + scoped Cloudflare tokens + Stripe
   role-based access.**
5. **Stripe webhook spoofing** — attacker forges payment events. **Mitigated by
   signature verification + idempotency** (BILLING.md § 10).

**Threat actors we explicitly do not plan for in v1:**

- Nation-state APT
- Sophisticated supply-chain attacks against Cloudflare or Stripe (we trust their
  controls; we monitor their disclosures)
- Insiders at Cloudflare, Stripe, Clerk, Anthropic, OpenAI

---

## 2. What we SHIP — the active controls

### 2.1 Authentication & identity

| Control | Implementation | Why |
|---------|----------------|-----|
| **Clerk** as identity provider | `@clerk/backend` M2M JWT verification at the edge via `CLERK_JWT_KEY` PEM | Networkless verification; sub-1ms; no roundtrip to Clerk for session check |
| **WebAuthn passkeys** | Clerk passkeys enabled per Clerk Dashboard | Phishing-resistant; preferred factor over passwords |
| **TOTP 2FA** | Clerk TOTP enabled; mandatory for any tenant with a connected Stripe payout account | Reduces ATO; targeted at the assets that matter (money) |
| **SMS 2FA** | Disabled. TOTP only. | SIM swap risk; SMS 2FA is a downgrade from no-2FA in some threat models |
| **Session rotation on privilege change** | Clerk session rotates on any role transition, Stripe payout connect, or password change | Limits the impact of session theft prior to escalation |
| **Magic link sign-in** | Clerk magic links with 10-minute expiry, single-use | Default sign-up flow; supplements password+passkey for users who lose access |

**Session lifetimes:**

- Web session: 7 days idle / 30 days absolute
- Mobile session: 30 days idle / 90 days absolute
- Service account / M2M token: 1 hour, auto-rotated

### 2.2 Network & edge

| Control | Implementation | Why |
|---------|----------------|-----|
| **TLS everywhere** | Cloudflare-managed certs, TLS 1.3, HSTS preload | Mandatory |
| **HSTS** | `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` on every response | Stops downgrade attacks |
| **X-Content-Type-Options** | `nosniff` on every response | Stops MIME confusion |
| **X-Frame-Options** | `DENY` on admin/control-plane; `SAMEORIGIN` on tenant runtime | Stops UI redress / clickjacking on auth surfaces |
| **Referrer-Policy** | `strict-origin-when-cross-origin` | Reduces referrer leakage to third parties |
| **Permissions-Policy** | `camera=(), microphone=(), geolocation=(), interest-cohort=()` baseline; extended per route | Disables features we don't use |
| **Turnstile** | Cloudflare Turnstile on every public form (signup, contact, marketplace booking) with `data-appearance="interaction-only"` (invisible) | Stops automated abuse without UX cost |
| **Cloudflare WAF** | Default ruleset enabled at the zone level | Catches OWASP Top 10 surface attempts |
| **Cloudflare Bot Management** | Free tier (managed-bots rule) enabled; paid tier deferred | Filters obvious bot traffic |

**Security headers implementation lives in:** `apps/control-plane/src/middleware/security_headers.ts`
and `apps/web/src/server.ts` (Angular SSR Worker). Headers are applied uniformly; per-route
overrides go through the middleware factory.

### 2.3 Rate limiting & abuse prevention

| Control | Implementation | Why |
|---------|----------------|-----|
| **Workers Rate Limiting** on auth endpoints | 10 requests / 60 seconds per IP on `/api/auth/*` | Brute-force defense |
| **Workers Rate Limiting** on AI generation | 5 requests / 60 minutes per tenant on `/api/sites/generate` | Cost control + abuse prevention |
| **Workers Rate Limiting** on contact forms | 5 submissions / 10 minutes per IP per tenant site | Spam control |
| **Per-tenant request quotas** | Tier-based (free: 10k/mo, solo: 100k/mo, etc) enforced via KV-backed counter | Cost containment per BILLING.md |
| **Stripe webhook replay window** | 6-minute max (Stripe signs for 5; we add 1 min grace) | Prevents replay |
| **D1 query timeout** | 5 seconds per query (default) | Limits DoS surface via expensive queries |

Rate limit configuration: `apps/control-plane/src/middleware/rate_limit.ts`. Counter
storage: Cloudflare Workers Rate Limiting API (built-in) for the simple cases; KV-backed
sliding window for tenant quotas where tier complexity demands it.

### 2.4 Secrets management

| Control | Implementation | Why |
|---------|----------------|-----|
| **Workers Secrets** for runtime values | `wrangler secret put` per environment | Never in source, never in env files committed to git |
| **chezmoi** for developer-machine secrets | `~/.local/share/chezmoi/home/.chezmoitemplates/secrets/*` (age-encrypted) | Per `~/.claude/plugins/heymegabyte-claude-skills/rules/secret-provisioning.md` |
| **Two-way mirror** prod ↔ chezmoi | `scripts/lib/secrets.mjs` writes both sides atomically | Prevents drift; preserves recoverability |
| **No secrets in `wrangler.toml` `[vars]`** | `[vars]` is for non-secret config only; everything sensitive uses `secret put` | `[vars]` is committed to git; `secret put` is encrypted at CF |
| **Scoped Cloudflare API tokens** | Per [secret-auto-provisioning.md](file:///Users/Apple/.claude/plugins/heymegabyte-claude-skills/rules/secret-auto-provisioning.md) Tier 2 — mint scoped tokens via parent global key, never deploy with global key | Least-privilege at runtime |
| **Stripe restricted keys** | Production uses restricted keys with only the resources we need (no `account.read`, no `application.read`) | Limits blast radius of key compromise |
| **Audit on secret access** | `scripts/check-secrets.mjs --audit` runs in CI; reports any wrangler secret not mirrored to chezmoi (and vice versa) | Drift detection |

### 2.5 Data protection

| Control | Implementation | Why |
|---------|----------------|-----|
| **Per-tenant D1 isolation** | ADR-0008. One D1 per tenant; binding-level separation. | Hardware-level isolation; can't query what isn't bound |
| **D1 Time Travel** | 30-day PITR enabled per database | Ransomware / accidental delete recovery |
| **Nightly D1 → R2 backup** | Workflow exports each tenant DB to R2 nightly; 90-day retention | Long-term archival |
| **MCP encryption-at-rest** | OAuth tokens for tenant-connected MCP servers (Mailchimp, HubSpot, etc) encrypted via AES-GCM with per-record IV in D1 | Compromised D1 export doesn't expose third-party credentials |
| **PII redaction in logs** | `apps/control-plane/src/lib/redact.ts` redacts email, phone, payment-card-number patterns before logs ship to Sentry/PostHog | Reduces accidental PII exfil |
| **R2 default deny** | All R2 buckets are private; public objects served via Worker-proxied signed URLs | No accidental public exposure |
| **No card data on our servers** | Stripe Link tokenizes client-side; only `payment_method` IDs touch our backend | PCI scope: SAQ-A |

### 2.6 Auditing

| Control | Implementation | Why |
|---------|----------------|-----|
| **Audit log** | `audit_log` table in platform D1: `actor_id`, `actor_type`, `action`, `target_type`, `target_id`, `metadata_json`, `ip`, `user_agent`, `created_at` | Forensic capability |
| **Payment audit log** | `payment_events` table (see BILLING.md § 10) | Money-event source of truth |
| **Auth audit log** | Sign-in, sign-out, 2FA enable/disable, password change, passkey add/remove — all rows in `audit_log` with `actor_type='user'` | ATO investigation |
| **Admin action audit log** | Every super-admin action (tenant suspend, manual refund, role grant) — `actor_type='admin'` | Insider risk |
| **Append-only enforcement** | `audit_log` has no UPDATE / DELETE access from any Worker route. Only the migration runner can modify. | Tamper resistance |

### 2.7 Dependency hygiene

| Control | Implementation | Why |
|---------|----------------|-----|
| **Renovate** | Configured in `.github/renovate.json` — weekly PRs for non-major bumps, monthly for major | Steady patching cadence |
| **Dependabot** | GitHub Dependabot enabled for security advisories only — fires immediately on critical CVEs | Catches what Renovate's weekly cadence misses |
| **`npm audit` in CI** | CI fails on high-severity advisories on a deployed package | Build gate |
| **Lockfile required** | `package-lock.json` committed; CI fails if `npm ci` produces a different tree | Reproducible installs |
| **No direct `package.json` edits in PRs without lockfile** | CI checks that any `package.json` diff has a matching `package-lock.json` diff | Prevents drift |

### 2.8 Operational

| Control | Implementation | Why |
|---------|----------------|-----|
| **`.well-known/security.txt`** | Published at `/.well-known/security.txt` with `mailto:security@projectsites.dev`, expiry, scope | RFC 9116; lets researchers contact us |
| **Coordinated vulnerability disclosure** | 90-day disclosure window, credit by default unless researcher prefers anonymity | Standard CVD practice |
| **Sentry release tracking** | `SENTRY_RELEASE` env var set per deploy; source maps uploaded | Stack traces map to commits |
| **Workers Tracing OTLP** | `[observability] enabled = true` on every Worker | Free I/O span tracing; surfaces unusual patterns |
| **Quarterly secret rotation** | Calendar reminder; rotate Tier-1 generated secrets every 90 days; long-lived API keys every 180 days | Limits exposure window |

---

## 3. What we SKIP — and why

The v2 doctrine (§17, §25) explicitly defers a set of controls that would be standard
in a regulated-industry product. Each skip is recorded here with the reasoning so we can
audit the decision later and re-enable when our threat profile changes.

### 3.1 CSP Level 3 with strict-dynamic + per-response nonce — **SKIPPED for v1**

**What it is:** A per-response Content-Security-Policy header using a cryptographically
random nonce on every `<script>` and `strict-dynamic` to delegate trust to those scripts.

**Why we skip it:**

1. **Stripe Link + Clerk + PostHog + Sentry + Workers Analytics all inject scripts.**
   Each requires either an explicit hash allowlist or a nonce propagated through their
   loader. CSP Level 3 with strict-dynamic only works cleanly if every third-party script
   plays nice with the nonce model. As of 2026-05, Stripe.js does (when wired correctly),
   Clerk's auth scripts do, but PostHog's session replay snippet and Sentry's BrowserSDK
   bundle each ship inline event handlers in their bootstrap that break under `strict-dynamic`
   unless you also allow `'unsafe-inline'` which defeats the purpose.

2. **Angular SSR templates** can compose nonces (Angular 19+ supports `CSP_NONCE` provider)
   but the wrap layer for PrimeNG components and the `tailwind-primeng` preset both ship
   utility classes that include inline `style="..."` attributes for some components. CSP
   `style-src 'nonce-{x}'` would require manually patching every PrimeNG component.

3. **Trusted Types** (the natural pair with strict-dynamic) requires every DOM mutation
   to flow through a Trusted Type policy. Many of our third-party scripts call
   `innerHTML` directly. Wiring this without breaking them would require either fork or
   wrap each.

4. **The cost-benefit math.** Implementing strict-dynamic + Trusted Types correctly is
   ~80 hours of engineering. The XSS attack surface we'd cover is dramatically reduced by
   (a) Angular's default template sanitization, (b) the fact that user-generated content
   on tenant sites is rendered through a separate Worker with no auth context, (c)
   Cloudflare WAF stopping the obvious vectors, and (d) Turnstile blocking automated
   probes. The marginal risk reduction at our scale doesn't justify 80 hours pre-launch.

**What we ship instead:**

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://js.stripe.com https://challenges.cloudflare.com
             https://app.posthog.com https://*.sentry.io https://clerk.projectsites.dev;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  img-src 'self' data: blob: https:;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://api.stripe.com https://api.posthog.com
              https://*.ingest.sentry.io https://clerk.projectsites.dev wss://*.cloudflare.com;
  frame-src 'self' https://js.stripe.com https://challenges.cloudflare.com
            https://hooks.stripe.com;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
```

This is **CSP Level 2 with `'unsafe-inline'`** — weaker than strict-dynamic but
practical with our third-party surface. Documented as a known gap.

**When we'll reconsider:** Either (a) when our threat profile moves into regulated
industry (HIPAA, finserv beyond marketplace scale), or (b) when all four third-party
scripts (Stripe, Clerk, PostHog, Sentry) ship clean nonce-compatible loaders. Tracking
in BACKLOG.md § 4.

### 3.2 Trusted Types — **SKIPPED for v1**

Same reasoning as 3.1. They are a pair.

### 3.3 Build-time validators for security headers — **SKIPPED for v1**

**What it is:** A Playwright + curl gate that asserts every deployed route returns the
full set of security headers with correct values, fails CI if any drift.

**Why we skip it:**

1. We have **one** Worker rendering all admin routes and **one** Worker rendering all
   tenant runtime routes. Headers are set in one middleware file each. Drift surface
   is tiny.
2. A unit test of the middleware factory (which we ship — see § 5) gives 95% of the
   coverage at 5% of the cost.
3. Build-time validators add 30–60 seconds to CI per deployed route, and we'd need to
   spin up a Wrangler dev server to test against. Marginal value.

**What we ship instead:**

- Unit test of `security_headers.ts` middleware that asserts the headers object shape.
- Post-deploy smoke test (Playwright) that hits `/`, `/api/health`, and `/admin` and
  asserts the presence of `Strict-Transport-Security`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and CSP. Three assertions, not one per
  header per route.

**When we'll reconsider:** When we add a third deployable Worker, or when a header drift
incident teaches us the unit-test surface wasn't enough.

### 3.4 Security+ / SOC 2 / ISO 27001 controls — **SKIPPED for v1**

**What it is:** Formal compliance frameworks with prescribed control catalogs (access
review cadences, change management process, vendor risk assessments, data classification
schemes, BCP/DR documentation, formal incident response playbooks).

**Why we skip it:**

1. We are a consumer SaaS + small-business marketplace. We do not process PHI, we do not
   handle classified data, we do not have enterprise customers requiring SOC 2 in v1.
2. SOC 2 readiness is ~6 months of part-time work for a solo founder. The customer
   pull (Enterprise tier tenants demanding it) does not yet exist.
3. The underlying controls (access logging, encryption at rest, vendor management) are
   substantially in place. What's missing is the *formal documentation and audit trail*.

**What we ship instead:**

- The substantive controls (audit log, encryption, scoped tokens, secret management).
- A `docs/security/runbooks/` directory with informal but complete runbooks for the
  five most likely incidents (account takeover, key compromise, D1 corruption, Stripe
  webhook drop, third-party outage).

**When we'll reconsider:** When the first Enterprise-tier prospect requires SOC 2 Type
II. Tracked in BACKLOG.md § 6.

### 3.5 Penetration testing — **DEFERRED to post-launch**

**What it is:** Engagement of a third-party security firm to attempt to break in.

**Why we skip it pre-launch:** A pentest of a product with no users tests our threat
model on the page rather than in production. We ship v1, monitor real abuse patterns
for 90 days, then commission a targeted pentest against the surfaces that actually saw
attempted attacks.

**When:** First pentest scheduled for v1 + 90 days. Vendor TBD; budget $8k.

### 3.6 Bug bounty program — **DEFERRED to post-launch**

Same reasoning. We open a HackerOne bounty (or similar) at v1 + 60 days with a $500–$5k
reward range.

### 3.7 Hardware security keys (FIDO2) **mandatory** for admins — **DEFERRED**

Currently passkeys are *available* on Clerk; making them *mandatory* for super-admins is
the right next step. Mandatory hardware keys (Yubikey) are deferred until we have more
than one admin role.

### 3.8 DLP (Data Loss Prevention) — **NOT PLANNED**

We don't process the kind of structured PII (SSN, health records, classified) where DLP
adds value at our scale. The PII we touch (name, email, address, phone) is redacted from
logs and not actively monitored for exfiltration patterns.

### 3.9 Network segmentation / VPC peering — **N/A**

Cloudflare Workers run on Cloudflare's network. There is no VPC to segment. This is a
feature, not a gap.

### 3.10 SIEM (Splunk, etc) — **NOT PLANNED**

Sentry + PostHog + Workers Tracing cover our use cases. SIEM is over-engineered for our
team size and threat model.

---

## 4. Incident response

### 4.1 Detection

- Sentry alerts on error-rate spikes (>10x baseline in 5 minutes)
- PostHog funnel alerts on conversion-rate drops (>50% in 60 minutes)
- Cloudflare WAF alerts on rule firing spikes
- Stripe Radar alerts on dispute spikes
- Manual: tenants email `security@projectsites.dev`

### 4.2 Triage (target: 1 hour from detection during business hours, 4 hours after-hours)

1. Acknowledge in PagerDuty (free tier, single on-call)
2. Open a private GitHub issue with `incident:` label
3. Spin up a Slack thread (private channel `#incidents`)
4. Pull recent deploys (`wrangler deployments list`) and Stripe webhook events for the
   affected window

### 4.3 Containment

Playbooks per scenario in `docs/security/runbooks/`:

| Scenario | First action |
|----------|-------------|
| Suspected key compromise | Rotate via `wrangler secret put`; chezmoi-mirror; redeploy |
| Suspected ATO of an admin | Force sign-out via Clerk dashboard; require WebAuthn re-enroll |
| Suspected ATO of a tenant | Disable their Stripe payouts; freeze their D1; email |
| D1 corruption | Time Travel restore to pre-incident timestamp |
| Stripe webhook drop | Reconcile via `/v1/events` listing + nightly job |
| Third-party outage | Status page update + degraded-mode fallback in product |

### 4.4 Communication

- **Internal:** Slack `#incidents`, GitHub issue
- **Tenants (P1):** Email + in-product banner
- **Tenants (P2):** Email
- **Public:** `status.projectsites.dev` (Cloudflare Workers-hosted) for outages
  affecting >10% of tenants
- **Regulator:** GDPR Article 33 notification if EU tenant data confirmed exposed
  (72-hour clock starts at confirmation, not at incident)

### 4.5 Postmortem

Every P1 and P2 incident gets a written postmortem within 7 days. Template in
`docs/security/postmortem-template.md`. Postmortems are blameless and shared with
affected tenants on request.

---

## 5. Security testing — what runs in CI

### 5.1 Unit tests

- `security_headers.middleware.spec.ts` — asserts the headers object shape
- `rate_limit.middleware.spec.ts` — asserts allow/deny per quota
- `redact.spec.ts` — asserts PII patterns are redacted from sample log lines
- `webhook_signature.spec.ts` — asserts Stripe signature verification rejects forged
  payloads
- `mcp_crypto.spec.ts` — asserts encrypt/decrypt round-trip works and detects tamper

### 5.2 Integration tests

- `auth-flow.e2e.spec.ts` — Playwright run through sign-up → 2FA enroll → sign-out → sign-back-in
- `payment-flow.e2e.spec.ts` — Stripe test-mode end-to-end booking
- `tenant-isolation.e2e.spec.ts` — tenant A signs in, queries their data, asserts no
  rows from tenant B leak via any endpoint

### 5.3 Static analysis

- ESLint security plugin (`eslint-plugin-security`) enabled in flat config
- TypeScript strict mode with `noUncheckedIndexedAccess`
- `oxlint` for the pre-commit speed pass
- `npm audit` on every CI run
- Sentry source maps uploaded so stack traces map to commits

### 5.4 Manual review

- Any code touching `apps/control-plane/src/routes/webhooks.ts` requires a Brian sign-off
- Any change to `apps/control-plane/src/middleware/auth.ts` requires a Brian sign-off
- Any change to `scripts/lib/secrets.mjs` requires a Brian sign-off
- Any new third-party script added to the CSP requires a Brian sign-off

---

## 6. Privacy

### 6.1 Data we collect

| Category | Examples | Retention | Legal basis |
|----------|----------|-----------|-------------|
| Account | email, name, password hash, 2FA secrets | Until deletion request + 90d grace | Contract |
| Auth events | sign-in IPs, user agents, timestamps | 12 months | Legitimate interest |
| Billing | Stripe customer ID, payment method ID (not card number), invoices | 7 years (tax law) | Legal obligation |
| Tenant content | Site files, blog posts, uploads | Until tenant deletes | Contract |
| End-user (marketplace) | Booking name, email, phone, address, payment | Per tenant retention; Stripe holds 7y | Contract |
| Analytics | Page views, events (PostHog) | 12 months | Legitimate interest |
| Errors | Stack traces, request IDs, user IDs (redacted PII) | 90 days | Legitimate interest |

### 6.2 Right to access / delete / port

- **Access:** `/api/me/export` returns a JSON dump of all data we hold on the requesting
  user, generated on demand. Targeting 24-hour SLA.
- **Delete:** `/api/me/delete` initiates deletion. 14-day soft delete (recoverable),
  then hard delete. Stripe records preserved per legal obligation.
- **Port:** Same as Access; format is JSON, plus a `wrangler d1 export` if the user is a
  tenant requesting their tenant DB.

### 6.3 Data residency

Cloudflare Workers run globally; data stored in D1 is replicated according to D1's
internal topology (typically nearest-data-center bias). For EU-tenant data residency
guarantees beyond GDPR transfer mechanisms, we use D1's **jurisdiction pinning** (EU)
at create time for tenants who select EU residency in onboarding.

### 6.4 Subprocessors

| Subprocessor | Purpose | DPA | Region |
|--------------|---------|-----|--------|
| Cloudflare | Infrastructure | Yes | Global |
| Stripe | Payments | Yes | US/EU |
| Clerk | Identity | Yes | US |
| Anthropic | LLM (Opus 4.7) | Yes | US |
| OpenAI | LLM (GPT-4o) | Yes | US |
| Resend | Email | Yes | US |
| Sentry | Errors | Yes | US/EU |
| PostHog | Analytics | Yes | US/EU |

Subprocessor list published at `/legal/subprocessors` and updated with 30 days' notice
before any change.

---

## 7. Compliance posture

- **GDPR / UK GDPR / CCPA** — controls in § 6 cover the substantive requirements
- **PCI DSS** — SAQ-A (no card data on our servers; Stripe Link tokenizes)
- **SOC 2 / ISO 27001 / HIPAA / FedRAMP** — not in scope for v1

---

## 8. Reporting

Security issues go to `security@projectsites.dev` (PGP key at `/.well-known/security.txt`).

For non-security bugs, use the public issue tracker on GitHub.

We commit to:

- Acknowledge receipt within 48 hours
- Initial assessment within 5 business days
- Status update at least every 14 days until resolution
- Credit researchers in our hall of fame (if they consent) and in CVE if applicable
- Not pursue legal action against good-faith researchers operating within scope

---

## 9. Review cadence

| Item | Cadence | Owner | Trigger |
|------|---------|-------|---------|
| Full document review | Quarterly | Architect + Brian | Calendar reminder |
| Skip list re-evaluation | Quarterly | Architect | Calendar reminder |
| Threat model refresh | Semi-annual | Brian | Calendar reminder |
| Secret rotation | 90 days (generated) / 180 days (API keys) | Architect | Calendar reminder |
| Subprocessor list audit | Quarterly | Architect | Calendar reminder |
| Dependency major bumps | Monthly | Architect | Renovate PRs |
| Incident postmortem closure | 7 days after P1/P2 | Incident commander | Per-incident |
| Pentest | v1 + 90 days, then annually | Architect | Calendar |
| Bug bounty review | v1 + 60 days launch, then monthly metrics review | Architect | Calendar |

---

## 10. Cross-links

- [ADR-0004](./DECISIONS.md#adr-0004) — Stripe Link only (PCI scope)
- [ADR-0005](./DECISIONS.md#adr-0005) — Cloudflare-native runtime
- [ADR-0008](./DECISIONS.md#adr-0008) — Per-tenant D1 isolation
- [BILLING.md](./BILLING.md) § 10 — Stripe webhook integrity
- [BACKLOG.md](./BACKLOG.md) — CSP L3, SOC 2, pentest, bug bounty
- [ARCHITECTURE.md](./ARCHITECTURE.md) — middleware topology, audit log placement
- `~/.claude/plugins/heymegabyte-claude-skills/rules/secret-provisioning.md`
- `~/.claude/plugins/heymegabyte-claude-skills/rules/secret-auto-provisioning.md`
- `.well-known/security.txt` — RFC 9116 disclosure
