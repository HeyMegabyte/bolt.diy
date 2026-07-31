# Convergence Task List — Populated from Full Repository Scan

Every item below was discovered by cross-referencing admin routes, worker routes, feature flags, E2E specs, admin section components, LOOP_LEDGER items, and FEATURES.md. Status: [ ] = untested, [x] = tested + GREEN, [~] = auth-gate only.

Generated 2026-07-30. Updated each pass.

## P0 — Broken / Critical

- [x] **n8n infra + CF Worker** — deleted infra/n8n/, root n8n/workflows/, apps-catalog→removed. Activepieces also deleted. Worker already gone. ~~autogen, autogenstudio, automate, flows, orchestrate, windmill-scripts~~ — none found (already cleaned). wrangler.toml comments removed.
- [ ] **Google OAuth callback error** — after Google consent, callback redirects to frontend but may show error tooltip. Full E2E test needed: click Google button → Google consent (mock) → callback → session → admin
- [~] **`e2e/helpers/auth.ts` reliability** — context-level addInitScript + route stubs verified working (debug test passes auth guard). Pending: sysAdminGuard-protected routes, E2E_API_KEY pathway.
- [ ] **`@axe-core/playwright` wired into every spec** — installed (v4.11) but needs wiring into e2e/admin-* specs.

## P1 — Admin Sections Without Authenticated E2E

Every admin section must have a spec that signs in, navigates, and asserts content renders.

### Primary Nav (15 items)
- [~] Dashboard (`/admin`) — auth-gate only. Need: sign in → dashboard renders → widgets populated → no stuck skeleton
- [~] Editor (`/admin/editor`) — auth-gate only. Need: sign in → bolt.diy iframe loads → WebContainer boots → file tree populated
- [~] Snapshots (`/admin/snapshots`) — auth-gate only. Need: sign in → snapshot list renders → create/restore actions work
- [~] Analytics (`/admin/analytics`) — auth-gate only. Need: sign in → analytics dashboard renders → real data visible
- [~] Forms (`/admin/forms`) — auth-gate only. Need: sign in → form builder renders → submissions visible
- [~] Apps (`/admin/apps`) — auth-gate only. Need: sign in → catalog grid renders → 30 entries visible → detail page works
- [~] Site Features (`/admin/site-features`) — auth-gate only. Need: sign in → toggle grid renders → flags toggleable
- [~] Social (`/admin/social`) — auth-gate only. Need: sign in → composer renders → 11 platforms visible → scheduler works
- [~] Voice (`/admin/voice`) — auth-gate only. Need: sign in → phone numbers list → test console → agent settings
- [x] Logs (`/admin/logs`) — Log Explorer now works (7 flags added). Need: full authenticated journey test for both Audit Trail + Log Explorer tabs
- [~] Feature Flags (`/admin/feature-flags`) — auth-gate only. Need: sign in → flag list renders → toggle works → stage promotion works → audit timeline visible
- [~] Leads (`/admin/leads`) — auth-gate only. Need: sign in → scan works → leads visible → claim links work
- [~] System Services (`/admin/system-services`) — auth-gate only. Need: sign in → registry renders → REAL probed status → deep-links work
- [~] Docs (`/admin/docs`) — auth-gate only. Need: sign in → OpenAPI explorer renders → Try-It UI works
- [~] Settings (`/admin/settings`) — auth-gate only. Need: sign in → general/AI chat/MCP tabs all render → each functional

### Secondary Routes (10 items)
- [~] Domains (`/admin/domains`) — auth-gate only
- [~] API Tokens (`/admin/api-tokens`) — auth-gate only
- [~] Billing (`/admin/billing`) — auth-gate only
- [~] User Settings (`/admin/user`) — auth-gate only
- [~] Team (`/admin/team`) — auth-gate only
- [~] Auth Security (`/admin/auth-security`) — auth-gate only
- [~] Site Detail (`/admin/sites/:id`) — auth-gate only
- [~] Site Branches (`/admin/sites/:id/branches`) — auth-gate only
- [~] Site Copilot (`/admin/sites/:id/copilot`) — auth-gate only
- [~] Site DNA (`/admin/sites/:id/dna`) — auth-gate only

### Other Admin Routes (5 items)
- [~] Super Admin (`/admin/super-admin`) — auth-gate only
- [~] Editor Native (`/admin/editor-native`) — auth-gate only
- [~] Accept Invite (`/admin/accept-invite`) — auth-gate only
- [~] Snapshots Diff (`/admin/snapshots/diff`) — auth-gate only
- [~] Domain Stack (`/admin/domains/:id/stack`) — auth-gate only

## P2 — Auth Surface Without Authenticated E2E

- [~] Sign-in Google OAuth — button redirect verified (302→Google). Need: full flow test (mock OAuth → callback → session)
- [~] Sign-in GitHub OAuth — button redirect verified. Need: full flow test
- [ ] Sign-in email+password — form submission → session → admin
- [ ] Sign-in magic link — enter email → link sent → verify → signed in
- [ ] Sign-up — name+email+password → account created → signed in
- [ ] Sign-up Google/GitHub OAuth buttons — redirect verified. Need: full flow test
- [ ] 2FA enrollment — TOTP setup flow
- [ ] 2FA verification — TOTP challenge flow
- [ ] Session management — list, revoke
- [ ] Sign-out — session cleared → homepage

## P3 — Marketing Surface

- [x] All 13 public routes 200 verified
- [ ] SEO metadata on every route: title 50-60, meta 120-156, canonical, OG, JSON-LD
- [ ] sitemap.xml, robots.txt, humans.txt, security.txt, llms.txt verified
- [ ] PWA: manifest + sw.js + offline.html + installable at 6bp
- [ ] CSP strict-dynamic + all security headers on every page
- [ ] LCP ≤ 2.0s, CLS ≤ 0.05, INP ≤ 100ms verified

## P4 — Code Quality

- [ ] TSC 0 errors in both packages (currently 0, must maintain)
- [ ] Feature-drift 0 violations (currently 0, must maintain)
- [ ] No bare `as`-cast reading request bodies without Zod validation
- [ ] No `console.log` in source (blocked by ESLint)
- [ ] ag-grid → TanStack Table migration (205 KB initial bundle overage)
- [ ] All 90 feature flags have non-empty `e2e_tests` column in D1
- [ ] All 90 feature flags have non-empty `smoke_steps` column in D1

## P5 — Platform Services

- [ ] Integration health probes cover all 14 services
- [ ] System Services admin shows REAL probed status (not static planned/scaffolded)
- [ ] Inngest container + secrets deleted, CF Workflows v2 binding active
- [ ] Postiz Fly machine deleted, native social on CF Workflows v2
- [ ] Lago Fly app + billing proxy deleted
- [ ] Unkey self-hosted Fly app deleted, managed Cloud active
- [ ] All Novu references removed from codebase
- [ ] All Nango references removed, native OAuth adapters canonical
- [ ] Zero Fly.io instances ($0/mo Fly spend)

## P6 — Visual Polish

- [ ] AI vision ≥9/10 on ALL surfaces at ALL 6 breakpoints
- [ ] Brand tokens consistent: --ps-bg, --ps-ink, --ps-accent
- [ ] Every interactive element: data-testid + aria-label + focus-visible ring
- [ ] Every async surface: loading skeleton → content or calm empty state → zero errors
- [ ] No hard-coded colors outside _polish.scss tokens
- [ ] All modals use DialogShellComponent
- [ ] Compact density: less whitespace, more data per viewport

## P7 — Postiz/Inngest/Plane/Activepieces CF Workers to Delete

Remaining unused workers from the earlier inventory. Most already deleted in prior sessions:
- [x] projectsites-plane, projectsites-plane-s3 — NOT in worker list (already deleted)
- [x] projectsites-skyvern — NOT in worker list
- [x] projectsites-langflow, projectsites-dify, projectsites-openhands — NOT in worker list
- [x] projectsites-anythingllm, projectsites-medusa, projectsites-messenger — NOT in worker list
- [x] projectsites-directus, projectsites-teable, projectsites-checkmate — NOT in worker list
- [x] projectsites-subdomain-landing — NOT in worker list
- [x] n8n-automate — NOT in worker list
- [x] autogen, autogenstudio, automate, flows, orchestrate, windmill-scripts — NOT in worker list
- [x] projectsites-litellm — KEPT (decision layer before AI Gateway per user directive)
- [~] projectsites-better-auth — EXISTS, has route `auth.projectsites.dev/*`; needs verification main worker handles all auth before deletion

## P8 — Missing Feature Flags (resolved)

- [x] log_explorer — added to registry + D1 at stable/100%
- [x] domain_stack_wizard — added to registry + D1 at stable/100%
- [x] email_deliverability_wizard — added to registry + D1 at stable/100%
- [x] multimodal_copilot — added to registry + D1 at stable/100%
- [x] outbound_webhooks — added to registry + D1 at stable/100%
- [x] section_marketplace — added to registry + D1 at stable/100%
- [x] site_dna_taste_graph — added to registry + D1 at stable/100%

## P9 — Comprehensive E2E Coverage (FEATURES_TO_TEST.md ~1,200 items)

Every feature, flow, error state, and edge case from FEATURES_TO_TEST.md must be tested against PROD with authenticated Playwright specs:
- [ ] Auth Surface (18 scenarios)
- [ ] Admin Dashboard (12 scenarios)
- [ ] Admin Editor (10 scenarios)
- [ ] Admin Snapshots (8 scenarios)
- [ ] Admin Analytics (12 scenarios)
- [ ] Admin Forms (10 scenarios)
- [ ] Admin Apps Catalog + Deploy (85 apps × 4 = 340 scenarios)
- [ ] Admin Site Features (8 scenarios)
- [ ] Admin Social (10 scenarios)
- [ ] Admin Logs (10 scenarios)
- [ ] Admin Feature Flags (12 scenarios)
- [ ] Admin Leads (6 scenarios)
- [ ] Admin System Services (8 scenarios)
- [ ] Admin Docs (6 scenarios)
- [ ] Admin Settings (25 scenarios)
- [ ] Admin Domains (8 scenarios)
- [ ] Admin Billing (10 scenarios)
- [ ] Admin User Settings (6 scenarios)
- [ ] Admin Team (6 scenarios)
- [ ] Admin Auth Security (6 scenarios)
- [ ] Admin Site Detail (12 scenarios)
- [ ] Admin Site Branches (6 scenarios)
- [ ] Admin Site Copilot (6 scenarios)
- [ ] Admin Site DNA (4 scenarios)
- [ ] Marketing Surface (15 scenarios)
- [ ] API Surface (15 scenarios)
- [ ] Platform Services (8 scenarios)
- [ ] Cross-Cutting (20 scenarios)
- [ ] Full User Journeys (20 scenarios)
- [ ] Feature Flag Impact Matrix (15 scenarios)
- [ ] Error State Testing (15 scenarios)
- [ ] Edge Cases & Stress (12 scenarios)
- [ ] Skeleton & Loading States (8 scenarios)
- [ ] Visual Inspection (56 sections × 10 checks each)
- [ ] CF Container App Compatibility Audit (85 apps)
- [ ] MCP .env export fix (show defaults when empty, not error)

## Progress Metrics

| Metric | Current | Target |
|--------|---------|--------|
| TSC errors | 0 | 0 |
| Feature flags | 90 | 90 |
| E2E specs | 27 | 80+ |
| Authenticated E2E specs | 0 | 200+ |
| Integration health probes | 14 | 14 |
| Console errors on admin | unknown | 0 |
| Axe violations on admin | unknown | 0 |
| CF Workers to delete | 1 remaining (better-auth) | 0 |
| Feature-drift violations | 0 | 0 |
| App deploy flows tested | 0 | 85 |
| Visual inspection passes | 0 | 56 sections × 6bp |
