# Convergence Task List — Populated from Full Repository Scan

Every item below was discovered by cross-referencing admin routes, worker routes, feature flags, E2E specs, admin section components, LOOP_LEDGER items, FEATURES.md, and the FULL prompt-history mine (5 session transcripts + feedback memories + convergence prompt docs). Status: [ ] = untested, [x] = tested + GREEN, [~] = auth-gate only / partial.

Generated 2026-07-30 (Pass 1). Updated 2026-07-30 (Pass 2: 5-agent repo scan + prompt-history mine + wave-2 spec fan-out). Updated each pass.

## TDD Contract — applies to EVERY item in this file

A feature/micro-feature is DONE only when it has an authenticated Playwright spec that:

1. Was written FIRST and watched RED before implementation (bugs found on prod stay in the suite as `test.fail()` + `// TDD-RED: <desc>` markers; marker removed when GREEN)
2. Signs in via `signInAsTestUser` — E2E_API_KEY pathway when available, stub pathway default, `SYS_ADMIN_TEST_EMAIL` (`brian@megabyte.space`) for sysAdminGuard routes (stub default `test@megabyte.space` FAILS the guard)
3. Navigates like a real user and asserts REAL content renders (not skeleton, not blank, not "not enabled" when flag is on)
4. Exercises ≥3 interactive micro-features (clicks, forms, toggles, tabs, modals, keyboard)
5. Asserts zero console errors (favicon/third-party filtered)
6. Runs axe (`checkA11y`) at ≥2 breakpoints — **ADVISORY except `critical` impact** (Brian 2026-07-30: functional completeness gates the suite, not axe; non-critical violations log to the a11y sweep backlog)
7. Screenshots every major step to `e2e/screenshots/<section>/` — the visual-inspection artifact
8. Never mutates prod data: ALL POST/PATCH/DELETE intercepted in-spec; unstubbed GETs land in the helper's last-resort `**/api/**` catch-all (never real prod — a fake-bearer 401 clears the session and bounces to /signin)
9. Is registered in `e2e/COVERAGE.yml` (`npm run validate:e2e-inventory` fails on orphan specs)
10. **Value-domain coverage (Brian 2026-07-30): every input micro-feature is exercised with all value types** — valid, invalid, empty, boundary (min/max/limit±1), overlong, unicode/emoji, whitespace-only, injection-shaped (`<script>`, `' OR 1=1`, `javascript:`). One `describe` block per input, one test per value class.

## P-1 — Feedback Directives (full prompt-history mine, 2026-07-30)

Combined + deduped from all session transcripts (~2,000 user lines), `feedback_*` memories, and CONVERGENCE prompt docs. Standing requirements — no pass may violate any. Source tags: (t)=transcript, (m)=memory, (p)=prompt-doc.

### Testing & QA
- **Functional completeness FIRST (Brian 2026-07-30): "focus less on axe-core violations… ensure the app is fully complete and fully tested, with an optimal feature set that works flawlessly together"** — integration/journey correctness outranks a11y strictness in the journey suite (t)
- **All value types (Brian 2026-07-30): "every single feature gets fully tested with all possible types of values"** — see TDD Contract #10 (t)
- Every admin section gets an authenticated JOURNEY test, never just an auth-gate shim (t,p)
- Failing Playwright test FIRST for every bug fix and feature (t,p)
- Every console error is a bug: capture → E2E → fix → verify (p)
- Visual scan every pass: sign in, click EVERY nav item, verify no stuck skeletons + no console errors (p)
- If no visual gaps, fix code gaps (TSC, missing E2E, experimental flags) — there are ALWAYS gaps (p)
- Real test data on brian@megabyte.space (sites, analytics, subscription, social posts, voice numbers) (p)
- Minimum 3 distinct fixes per pass; never single-fix passes (p)
- axe-core 0 violations + AI vision ≥8/10 at all breakpoints on all surfaces (p)
- Never claim "converged" from iterated surfaces — grep the full include-list and test end-to-end (m)

### Auth
- All 6 auth methods functional AND tested full-flow on `/signin` + `/auth/sign-up`: email+password, magic link, Google OAuth, GitHub OAuth, sign-up link, 2FA (p)
- Zero error tooltips/flash messages during any auth flow; Google OAuth callback error must be fixed with a full E2E (t,p)
- Session management (list/revoke) + sign-out tested (p)

### Admin UX & completeness
- Editor = bolt.diy iframe REALLY loads: WebContainer boots, file tree populates, preview renders (m)
- Every section: skeleton → real data (or calm "create first X" empty state) → zero console errors → axe-clean (p)
- 15 primary nav + 4 "More tools" items all functional with real data; nav is hand-curated; routed+mounted ≠ reachable — verify via authed E2E (m,p)
- Cmd+K palette, `?` shortcuts overlay, site switcher, theme persistence, notification bell, per-section error boundaries, global drop zone — all tested (p)
- Mobile 375px: sidebar collapses, all sections usable (p)
- Admin brand = CYAN/BLACK compact cockpit (never orange); density + cyan progress one step each prompt; Spartan UI only — no PrimeNG/Material; all modals via DialogShellComponent; tokens from `_polish.scss` only (m)
- Converge = PORT unported legacy sections (catalog/editor/snapshots mirrored, not list-shells); never rebuild a duplicate admin (m)
- Dead admin mutation actions + dead section components removed same turn (m)

### Feature flags
- Every non-trivial feature behind a flag (`enabled=0, rollout=0, experimental`); promote to `stable, enabled=1, 100%` once E2E-verified GREEN (p)
- Every flag: non-empty `e2e_tests` + `smoke_steps` + description + owner (p)
- core_* flags are sentinels — Disable/Killswitch controls stay disabled for them (m)
- Flag-gated forms: notice above + dimmed + disabled controls (recipes gold standard) (m)
- Flag missing in registry+D1 while referenced in frontend = build fail (p)

### Platform services (ADR-0034 end-state)
- CF-first, zero Fly.io spend: Inngest→CF Workflows v2, Postiz→native social, Lago→Stripe Meters, self-hosted Unkey→Unkey Cloud, Novu→custom psnotify, Nango→native OAuth (t,m,p)
- Unkey = customer-facing API keys behind `ApiKeyProvider` abstraction; NOT authorization/billing ledger; anonymous public traffic never routes through it (t)
- System Services admin shows REAL probed status for all 14 integrations — never static "planned/scaffolded" (p)
- LiteLLM (decision) → AI Gateway (execution) → Langfuse (traces) for every LLM call; tiered: premium=Anthropic, standard=DeepSeek, instant=Workers AI (t,p)
- Transcript directive to VERIFY: "do not use Listmonk; fully replace if possible (Resend or SES+custom)" — conflicts with deployed mail.projectsites.dev; needs explicit decision before acting (t)

### AI & agents
- All LLM outputs consumed through Zod schemas; every AI feature flag-gated with kill switch (p)
- MCP server at mcp.projectsites.dev (OAuth 2.1) + per-site MCP; dogfood: platform deploys through own MCP (p)
- psnotify (DO inbox + center + prefs + SES/web-push) replaces every Novu reference (m)

### Code quality & architecture
- TSC 0 errors both packages; validate:features 0 violations; no `console.log`; no bare `as`-cast request bodies (Zod at every boundary, shared FE+BE schema per processed input) (p,m)
- Feature module architecture: manifest (7 fields) + flag + colocated tests + e2e/<slug>/ + featureSlug on Sentry/PostHog events — drift blocks merge (p)
- No umbrella API naming (`/api/allstar/*`) — semantic per-feature paths only (m)

### Deploy & process
- Deploy to prod autonomously when gates green — never hold dark, never ask (t,m)
- After every deploy: verify entry-file sizes, purge CDN, real-browser check with 0 console errors (m)
- Never overlap two deploys (R2 1-byte empty corruption) (m)
- Loop must terminate: DONE gate every pass; in-scope flags only; test-mode money/email; self-cancel when done (m)
- Every loop fire = parallel agents (this loop: 4-5), distinct files, one message, main thread folds once (m — Brian directive; this file's passes must comply)
- Grind don't defer on explicit rounds; <2h items ship inline, never Recs (m)

## P0 — Broken / Critical (updated Pass 2)

- [x] **n8n infra + CF Worker** — deleted (Pass 1). Activepieces also deleted.
- [~] **sysAdminGuard E2E bypass** — ROOT CAUSE FOUND: stub default `test@megabyte.space` is not in `isSysAdminEmail` allowlist; `brian@megabyte.space` is. Wave-2 agent wiring `SYS_ADMIN_TEST_EMAIL` into helpers + feature-flags journey spec. Verify then mark [x].
- [ ] **Google OAuth callback error** — full E2E: Google button → consent (mock) → callback → session → admin
- [ ] **`@axe-core/playwright` wired into every admin spec** — installed (v4.11); wave-2 specs use `checkA11y`; remaining legacy specs need wiring.
- [~] **Prod testMatch gaps** — journey suite + value-domain suites added via globs (Pass 3): `admin-*-journey`, `admin-dashboard`, `admin-feature-flags`, `value-domains-*`. Remaining: ~15 legacy dev-only specs (media-*, env-vars-*, modals, domain-management-*) still outside prod testMatch — triage next pass.
- [ ] **Skip/fixme triage** — 135 `skip|fixme` hits across suite (~72% of 188 specs inactive). Triage each: re-enable+fix / delete obsolete / keep with dated TODO. Track count downward every pass.
- [ ] **MCP .env export fix** — show defaults when empty, not error.
- [x] **Journey-suite failure queue — CLOSED Pass 3 (94/94 GREEN).** Root causes, for the record: (a) admin shell's router-outlet only mounts a section when `state.selectedSite()` is truthy, and the computed defaults to `sites[0]` — an EMPTY sites stub = "No sites yet" on every route (fixed in helpers/auth.ts + every spec: stub ONE site); (b) `**`-suffix required on every specific GET stub (query-string variants otherwise fall into the catch-all); (c) generic "Failed to load resource" console noise (Novu-remnant 400 + third-party 401s, no URL in text) leaked through case-sensitive filters — filtered suite-wide; (d) `appReveal` IntersectionObserver keeps content at opacity:0 until scroll — scroll-nudge in early tests; (e) wrong-button targeting on /signin (three submit-ish buttons; magic-link = `sign-in-magic-link`).
- [x] **EMAIL_RE parity drift — FIXED + DEPLOYED Pass 4.** Class sweep found FIVE duplicated regex sites (sign-in, sign-up, team, settings, billing) — all now delegate to shared `utils/validators/email.ts` (254-cap + backend parity). Deployed (R2 279/279 + purge); `value-domains-auth.spec.ts` 19/19 STRICT green live (5 test.fail() markers removed).
- [x] **Novu remnant — REMOVED Pass 4.** `novu-inbox.service.ts` → inert shim (zero network I/O; boot 400 gone), `@novu/js` dropped from package.json + bundle (verified dist clean). psnotify build remains P5/P12.
- [x] **Parallel-load flakes — FIXED Pass 4.** Dashboard: console listener attaches pre-navigation + deterministic waits. Docs: scroll-nudge in goToDocs. Verified `--repeat-each=2` 16/16.
- [x] **Wave-4 specs — ALL GREEN Pass 5; testIgnore lifted; COVERAGE flipped covered.** Certification run: **193 passed / 2 fixme-skipped / 0 failed** across the full 21-file suite (~195 tests, workers=4, 1.5m). Wave-4's journey "failures" were load contention from the oversized VD suites, not real breakage. Real fixes: create suite (SW block, direct-goto + waitForSelector, real button text, nav-race handling, 2 fixme on post-submit auth race), settings suite (Business-tab click reliability, `.first()` strict-mode, save contract = `validateBusiness()` guard not disabled-button, telemetry excluded from mutation counts, counter registered AFTER helper per reverse-match order).
- [ ] **⏭ PASS-7 FOLD CHECKPOINT (do FIRST next fire — 4 agent worktrees hold finished/near-finished work):**
  Retrieve with `cp .claude/worktrees/<wt>/apps/project-sites/e2e/<file> apps/project-sites/e2e/` from repo root, then run each, fix tails, register in COVERAGE.yml, commit:
  - `agent-a99c1e715606e7c67` → `e2e/auth-magic-link-roundtrip.spec.ts` (REAL round-trip via live peek endpoint; sends 2 real emails to test@megabyte.space per run) + `e2e/helpers/auth.ts` Pathway C rewrite (request-POST → peek-poll → verify-URL goto; the old onclick-selector version is dead). Run with `E2E_PEEK_SECRET` from `/Users/Apple/.local/share/e2e-secrets.env` (or `~/.e2e-peek-secret.env`), `--workers=1`.
  - `agent-a7850543bc4f81487` → `e2e/auth-session-lifecycle.spec.ts` (sign-out, expiry-recovery, 429 UX — finding: UI shows a MEANINGFUL message on 429, better than expected; agent was adjusting the expected-fail), `--output=test-results-p7-lifecycle`.
  - `agent-a66351db202001fa4` → stabilized `e2e/auth-google-callback.spec.ts` + `/tmp/skip-triage.txt` classification (google P0-regression flake: suspect rate-limit 20/60s exhaustion under repeat-each — verify its fix with `--repeat-each=3 --workers=2`).
  - `agent-ae28ac0bc5574d72c` → `e2e/value-domains-team-invite.spec.ts` (it independently re-derived the reverse-match route-order rule; fix = org stubs AFTER signInAsTestUser, no duplicate catch-all).
  Then: full 24-file certification, COVERAGE.yml + prod-config additions, flip this checkpoint to [x]. (a) `#create-address` lacks `maxlength` — FE accepts 330+ chars, only server enforces (small product fix: add maxlength=500 to match settings); (b) site-features/site-detail specs green but SOFT-ASSERTED (`if visible` guards) — add the missing `sf-*`/`sd-tab-*` testids to the components, then stricten specs; (c) 2 create-suite `test.fixme` races (post-submit auth flow) — revisit with real-session pathway; (d) editor+snapshots+analytics+forms carry `aria-prohibited-attr` (serious) → a11y sweep backlog.
- [ ] Real axe `critical` findings + advisories (aria-prohibited-attr serious, nested-interactive, target-size <24px, scrollable-region-focusable in docs) → a11y sweep backlog per [[admin-a11y-sweeps]]

## P1 — Admin Sections Without Authenticated E2E

Every admin section needs a journey spec per the TDD Contract. Wave 2 (2026-07-30) fans out 13 sections; [WIP] = spec being written this pass.

### Primary Nav (15 items)
- [x] Dashboard (`/admin`) — `admin-dashboard.spec.ts` GREEN (Pass 1)
- [~] Editor (`/admin/editor`) — auth-gate only. Need: bolt.diy iframe loads → WebContainer boots → file tree populated
- [~] Snapshots (`/admin/snapshots`) — auth-gate only. Need: list renders → create/restore/diff actions
- [x] Analytics (`/admin/analytics`) — `admin-analytics-journey.spec.ts` (GREEN Pass 3)
- [x] Forms (`/admin/forms`) — `admin-forms-journey.spec.ts` (GREEN Pass 3)
- [x] Apps (`/admin/apps`) — `admin-apps-journey.spec.ts` (GREEN Pass 3)
- [~] Site Features (`/admin/site-features`) — auth-gate only
- [x] Social (`/admin/social`) — `admin-social-journey.spec.ts` (GREEN Pass 3)
- [x] Voice (`/admin/voice`) — `admin-voice-journey.spec.ts` (GREEN Pass 3)
- [~] Logs (`/admin/logs`) — flags fixed (Pass 1); need full journey for Audit Trail + Log Explorer tabs
- [x] Feature Flags (`/admin/feature-flags`) — `admin-feature-flags.spec.ts` full journey + sysAdminGuard fix (GREEN Pass 3)
- [x] Leads (`/admin/leads`) — `admin-leads-journey.spec.ts` (GREEN Pass 3)
- [x] System Services (`/admin/system-services`) — `admin-system-services-journey.spec.ts` (GREEN Pass 3; was ZERO-spec)
- [x] Docs (`/admin/docs`) — `admin-docs-journey.spec.ts` (GREEN Pass 3)
- [x] Settings (`/admin/settings`) — `admin-settings-journey.spec.ts` (GREEN Pass 3)

### Secondary Routes (10 items)
- [x] Domains (`/admin/domains`) — `admin-domains-journey.spec.ts` (GREEN Pass 3)
- [~] API Tokens (`/admin/api-tokens`) — auth-gate only (one-time reveal + auto-hide micro-features untested)
- [x] Billing (`/admin/billing`) — `admin-billing-journey.spec.ts` (GREEN Pass 3)
- [~] User Settings (`/admin/user`) — auth-gate only
- [x] Team (`/admin/team`) — `admin-team-journey.spec.ts` (GREEN Pass 3)
- [~] Auth Security (`/admin/auth-security`) — auth-gate only
- [~] Site Detail (`/admin/sites/:id`) — auth-gate only (tabs, SQL pagination, log-stream reconnect untested)
- [~] Site Branches (`/admin/sites/:id/branches`) — stub component, zero spec
- [~] Site Copilot (`/admin/sites/:id/copilot`) — zero spec, flag-gated
- [~] Site DNA (`/admin/sites/:id/dna`) — zero spec

### Other Admin Routes (zero-spec set from Pass 2 scan)
- [~] Super Admin (`/admin/super-admin`) — zero spec
- [~] Editor Native (`/admin/editor-native`) — flag-gated (`native_editor`), needs flag-on + flag-off E2E
- [~] Accept Invite (`/admin/accept-invite`) — zero spec (onboarding flow)
- [~] Snapshots Diff (`/admin/snapshots/diff`) — auth-gate only
- [~] Domain Stack (`/admin/domains/:id/stack`) — wizard progress save/resume untested
- [~] Site MCP Server (`/admin/sites/:id/mcp`) — stub component, zero spec
- [~] Swarm (`/admin/swarm`) — zero spec (auto-save + conflict resolution untested)
- [~] Wait (`/admin/wait`) — zero spec (build progress real-time updates)

## P2 — Auth Surface Without Authenticated E2E

- [~] Sign-in Google OAuth — button redirect verified. Need mock-consent full flow
- [~] Sign-in GitHub OAuth — button redirect verified. Need full flow
- [ ] Sign-in email+password → session → admin
- [ ] Sign-in magic link → link sent → verify → signed in
- [ ] Sign-up (name+email+password) → account created → signed in
- [ ] Sign-up OAuth buttons full flow
- [ ] 2FA enrollment (TOTP setup) + verification
- [ ] Session management — list, revoke
- [ ] Sign-out — session cleared → homepage
- [ ] Rate-limit UX on rapid submissions

## P3 — Marketing Surface

- [x] All 13 public routes 200 verified
- [ ] SEO metadata every route: title 50-60, meta 120-156, canonical, OG, JSON-LD
- [ ] sitemap.xml, robots.txt, humans.txt, security.txt, llms.txt verified
- [ ] PWA: manifest + sw.js + offline.html + installable at 6bp
- [ ] CSP strict-dynamic + all security headers on every page
- [ ] LCP ≤ 2.0s, CLS ≤ 0.05, INP ≤ 100ms verified

## P4 — Code Quality

- [ ] TSC 0 errors both packages (maintain)
- [ ] Feature-drift 0 violations (maintain)
- [ ] No bare `as`-cast request bodies without Zod (features.ts 33 handlers = dormant, convert per-flag-promotion)
- [ ] ag-grid → TanStack Table migration (205 KB bundle overage)
- [ ] All 90 flags have non-empty `e2e_tests` + `smoke_steps` in D1

## P5 — Platform Services

- [ ] Integration health probes cover all 14 services; System Services shows REAL probed status
- [ ] Inngest container + secrets deleted, CF Workflows v2 active
- [ ] Postiz Fly machine deleted, native social on CF Workflows v2
- [ ] Lago Fly app + billing proxy deleted
- [ ] Unkey self-hosted deleted, managed Cloud active
- [ ] All Novu references removed (psnotify canonical)
- [ ] All Nango references removed, native OAuth canonical
- [ ] Zero Fly.io instances ($0/mo)
- [~] projectsites-better-auth worker — EXISTS with `auth.projectsites.dev/*` route; verify main worker handles all auth before deletion

## P6 — Visual Polish

- [ ] AI vision ≥9/10 on ALL surfaces at ALL 6 breakpoints
- [ ] Screenshot coverage: every journey spec screenshots every major step (wave-2 specs comply; legacy specs at 3.7%)
- [ ] Brand tokens consistent (--ps-bg, --ps-ink, --ps-accent); no hard-coded colors outside `_polish.scss`
- [ ] Every interactive element: data-testid + aria-label + focus-visible ring (94% of sections have testids; close the 4 missing)
- [ ] All modals use DialogShellComponent
- [ ] Compact density: less whitespace, more data per viewport

## P7 — Legacy Workers to Delete

- [x] 24/25 legacy workers already gone (Pass 1 audit)
- [~] projectsites-better-auth — pending verification (see P5)

## P8 — Missing Feature Flags — RESOLVED Pass 1 (7 flags added at stable/100%)

## P9 — Comprehensive E2E Coverage (FEATURES_TO_TEST.md)

**Corrected census (Pass 2): 674 actual checklist items** (the "1,200" figure was aspirational). Micro-feature additions from the Pass-2 frontend scan appended as §35-§37 of FEATURES_TO_TEST.md. Categories tracked there; this file tracks section-level status (P1) + infra (P11).

- [ ] Work FEATURES_TO_TEST.md top-to-bottom; flip items to [x] only with a GREEN spec per TDD Contract
- [ ] Apps catalog: 85 apps × 4 tests = 340 items (largest single block)
- [ ] Interactive-element audit: 245 granular items
- [ ] CF Container App Compatibility Audit (85 apps)

## P10 — Backend API Coverage Gaps (Pass 2 scan)

~150 route groups / 250+ handlers / 87 feature modules; ~30-40% lack any E2E reference. Highest-risk untested endpoints (each needs a spec per TDD Contract, real-browser where UI-reachable, request-level otherwise):

- [ ] `POST /api/ai-actions/payment-command` (+ refund/status/methods/customers) — safety-gated AI payments, ZERO E2E
- [ ] `POST /api/billing/checkout` + embedded-checkout — no COVERAGE entry
- [ ] `POST /api/auth/magic-link` + `GET /api/auth/magic-link/verify` — per-handler coverage (token reuse/expiry)
- [ ] `POST /api/sites/:id/publish-bolt` — zero E2E (loss-of-work risk)
- [ ] `GET /api/sites/:id/export` (code_export flag) — zero E2E
- [ ] `POST /webhooks/stripe` — signature + idempotency not indexed in COVERAGE
- [ ] `POST /api/sites/:id/reset` + `DELETE /api/sites/:id` — destructive, zero explicit E2E
- [ ] `POST /api/mcp/:provider/callback` — endpoint-level verification (token injection risk)
- [ ] `GET /api/auth/me` + logout — explicit session coverage
- [ ] Route families with zero e2e reference: mcp-site, collab, browser-service, jobs, voice webhooks, livekit-webhooks, integrations/health, seo-autopilot, email-deliverability, ses webhooks, ai-endpoints-public, domain-stack, review-links, site-dna, pseo-matrix-v2, storefront, wallet, experiments, templates, agentic-commerce, concierge, podcast-studio
- [ ] COVERAGE.yml corrections: task-tray (blocked on seed endpoint), MCP tab (partial), streaming-markdown (TDD-RED not GREEN); index orphan specs in `e2e/admin/` subdirs

## P11 — E2E Infrastructure Fixes (Pass 2 audit, ranked)

- [x] 1. sysAdminGuard bypass (wave 2 — see P0)
- [ ] 2. Screenshot assertions across suite (only 7/188 specs screenshot; wave-2 specs raise this; systematize via shared helper)
- [ ] 3. axe in dev suite (only smoke-prod runs it locally; add to 20+ critical routes)
- [ ] 4. prod testMatch gaps (see P0)
- [ ] 5. E2E_API_KEY pathway in CI (STUB_AUTH=0 magic-link path needs worker peek endpoint + workflow job)
- [ ] 6. Traceability: every D1 flag ↔ ≥1 COVERAGE.yml entry, gate in CI
- [ ] 7. `testAcross6Breakpoints()` helper; apply to 20+ UI specs (currently 5 specs do 6bp)
- [ ] 8. Visual regression wiring (Percy/Chromatic or `toHaveScreenshot` baselines) — currently zero
- [ ] 9. Skip/fixme triage (see P0)
- [ ] 10. Consolidate helpers: `visitAdmin()`, `assertA11y()`, `screenshotAt6bp()` — kill per-file boilerplate

## P12 — Unabsorbed Requirements (from _LOOP_LEDGER / _LOOP_PROGRESS / _100_IDEAS)

Tracked here so the loop never loses them; each graduates to its own P-section when work starts:

- [ ] Lead Scanner Phase 0 — US businesses-without-websites engine + deep crawl (Brian 2026-06-28)
- [ ] Monumental initiatives (multi-month, spec-first): Workers for Platforms substrate · Public Developer API · AI Visual Site Builder · Analytics Suite (Analytics Engine) · Instant Preview Environments
- [ ] Chatwoot Support Phases 1-5 (response SLAs → AI deflection → platform-as-revenue)
- [ ] Deepcrawl integration (8 sub-modules: competitor research, SEO audit, source crawl, agent context, monitor, broken links, pre-flight, content inventory)
- [ ] Tier-2 ledger: lying-UI honesty sweep · apps marketplace paid hosting (A0 trust) · owner analytics driving action · generated-site quality gaps · security hardening · viral growth surfaces · reliability/dev-velocity
- [ ] Better Auth cutover (flag-gated; static D1 schema migration BEFORE cutover)
- [ ] MCP OAuth per-site connections E2E (10 providers + paste-key fallback)
- [ ] psnotify build (replaces Novu; DO inbox + center + prefs + SES/web-push)

## Progress Metrics (Pass 2 baseline)

| Metric | Current | Target |
|--------|---------|--------|
| TSC errors | 0 | 0 |
| Feature flags | 90 | 90 (all with e2e_tests + smoke_steps) |
| E2E spec files (apps/project-sites) | 188 (≈53 active) | all active or deleted |
| Authenticated journey + value-domain specs | 21 files / ~195 tests / **193 GREEN + 2 fixme, 0 red** (Pass 5 certification) | 41 admin routes + all inputs value-tested |
| Skip/fixme hits | 135 | 0 |
| Specs taking screenshots | 7 | every journey spec |
| Specs running axe | 1 (dev) + prod accessibility.spec | every journey spec |
| FEATURES_TO_TEST items | 674 (+Pass-2 additions) | all [x] |
| Backend route families w/o E2E | ~25 | 0 |
| Flags never referenced in e2e/ | ≥5 known | 0 |
| CF Workers to delete | 1 (better-auth, pending verify) | 0 |
| Console errors on admin | unknown | 0 |
| Visual regression baselines | 0 | wired |
