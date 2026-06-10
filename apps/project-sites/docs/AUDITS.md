# Audits — projectsites.dev Worker

Open and actionable findings from three audit passes. Resolved items have been dropped.

---

## AI Wave Audit (2026-05-28)

3 feature modules shipped dark (flag `enabled=0`): `review_synthesis`, `seo_autopilot`, `conversational_editing`. 59 new unit tests passing; typecheck clean; drift validator 0 violations.

### Open broken-flow items

1. **`super_admin.ts:583`** — Stripe refund handler is stubbed; never calls Stripe. Refunds silently no-op.
2. **`super_admin.ts:827`** — JWT signing for admin impersonation is unimplemented. Security-critical; blocks the impersonate feature entirely.
3. **`agency.ts:97,121`** — Resend email invites are stubbed. Agency invitations fail silently.
4. **`templates.ts:128`** — Wallet debit on paid template purchase is unimplemented. Pro templates are effectively free.
5. **`workflows/site-generation.ts:867`** — Empty `catch {}` swallows build and render failures. Errors are lost, no Sentry capture, no status update.
6. **`feature_flags/services.ts` + `search.ts`** — ~140 `.catch(() => {})` suppressions swallow errors silently. Add Sentry capture + structured telemetry at each site.

### Before enabling the three dark flags

- Apply migrations `0517`, `0518`, `0519`.
- Add E2E specs for `review_synthesis`, `seo_autopilot`, `conversational_editing`.
- Wire `seo_autopilot.applyToSite` + `review_synthesis` JSON-LD injection into `site_serving.ts`.

---

## Code Duplicates (jscpd)

228 clone pairs · 2,690 duplicated lines · 63,856 scanned lines · **4.21% duplication rate** (target: ≤1%).

### Open items

**Item #35 — Jest fixture boilerplate (~240 lines)**
`createMockEnv()`, `createMockContext()`, and D1 mocks are copy-pasted across test suites. Consolidate into `src/__tests__/_fixtures.ts` and import from there.

**Item #36 — `services/external_llm.ts` provider clones (13 pairs)**
Each provider branch repeats fetch → retry → JSON-parse. Extract a single `callProvider(config, payload)` façade; provider branches pass a config object.

**Item #37 — `frontend/.../homepage.component.html` marketing card markup (10 pairs)**
Repeated card HTML. Extract a `<app-feature-card>` standalone component.

### Intentional twin (do not deduplicate)

`safe-parse.ts` exists as both a backend and a frontend copy. Angular cannot consume Worker-side ESM; the duplication is load-bearing.

---

## Org Isolation Audit

74 queries carry `org_id = ?` filter (verified). 22 are legitimately unscoped (public endpoints, cron jobs, webhook receivers). 10 require parent-row pre-verification before the org_id scope is applied.

### ESLint enforcement

Rule: `project/no-unscoped-d1-query` in `eslint-rules/no-unscoped-d1-query.mjs` — currently set to `warn`. Promote to `error` once the 10 parent-verification flows are documented in tests.

Audit script: `node scripts/audit-org-isolation.mjs` → `/tmp/audit_findings.json`

### Org-scoped tables (reference)

`sites` · `api_keys` · `audit_logs` · `hostnames` · `subscriptions` · `ai_settings` · `ai_endpoints` · `forms_inbox` · `ai_traces` · `usage_events` · `milestone_events` · `weekly_digest_sent` · `site_kb_chunks` · `site_products`

### Flows requiring parent-row pre-verification (documentation gap)

These flows are correct in production but lack explicit test coverage of the pre-verification step:

- Hostname webhook flow
- Analytics endpoint
- GitHub OAuth callback
- Public site serving (slug → org resolution)
- Domain uniqueness checks
- Public form ingest
- Internal job (cron + queue handlers)
