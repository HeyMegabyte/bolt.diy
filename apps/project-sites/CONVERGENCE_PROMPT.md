Finish projectsites.dev. Not audit. Not catalog gaps. FINISH IT.

You are a Distinguished Web Application Engineer completing a product for launch. Your work is indistinguishable from a principal engineer — except massively faster. Every pass ships something. Every pass verifies it works.

## The Standard

After this convergence loop completes, a human must be able to:
1. Go to https://projectsites.dev, see a gorgeous marketing homepage
2. Sign up / sign in via Google or GitHub — no errors, no blank pages, no broken tooltips
3. Reach the admin dashboard with every section populated and functional
4. Create a site, deploy it, see it live on a subdomain
5. Use voice, social, billing, analytics, feature flags — all working
6. Find zero console errors, zero axe violations, zero visual slop

If a human can't do those 6 things, the convergence loop isn't done.

## How To Work

Each pass picks the highest-impact gap and closes it with TDD:

1. **Visual Discovery** (Stagehand/Browserbase on prod): Navigate the app AS A USER. Sign in with real credentials. Click every nav item. Observe every error — a hover tooltip with error text, a blank section, a console.error, a 404 in the network tab, a "Too many requests" on a legitimate action.

2. **Write Failing Test**: Playwright spec that starts at `PROD_URL` homepage, signs in via `e2e/helpers/auth.js` `signInAsTestUser(page)`, navigates via UI clicks to the broken surface, and asserts the fix.

3. **Fix Root Cause**: Read the error, fix the SOURCE (not the symptom), verify the fix locally.

4. **Deploy + Verify**: Deploy backend + frontend. Run the spec against prod. Confirm GREEN. Stagehand visual verify.

## Critical Rules

**No single-fix passes.** Minimum 3 distinct fixes per 20m window. Parallel where possible.

**No "visual scan found nothing" passes.** If no visual gaps remain, fix code gaps (TSC errors, missing E2E tests, unintegrated features, feature flags still experimental, console errors, axe violations). There are ALWAYS gaps until the DONE conditions are met.

**Feature flags: promote to production.** When the loop verifies a feature works end-to-end (real data renders, E2E GREEN, Stagehand verified, no console errors), autonomously promote its flag to `stage='stable', enabled=1, rollout_percent=100`. The finished app has NO features hidden behind experimental flags — everything works, everything is visible. Exception: flags explicitly marked as `killswitch` or `deprecated` in their description.

**Real auth for E2E: use `e2e/helpers/auth.js`.** The auth helper has 3 fallback paths: mock cookie → email/password POST → magic-link verify. Provision `E2E_API_KEY` via `wrangler secret put` if not already set. If sign-in breaks, fix the auth helper FIRST — every other E2E test depends on it.

**Test data: create it.** Use the `/api/*` endpoints to seed test data on the `brian@megabyte.space` account: create a test site, generate analytics events, create a subscription, set up voice numbers, create social posts, add feature flag overrides. Every admin section must show REAL data, not empty states.

**Every console error is a bug.** Stagehand must check `page.evaluate(() => (window as any).__consoleErrors || [])` on every section. Any error → write a failing E2E → fix → verify.

**Deploy when ready.** Batch deploys as the loop nears completion. Use `CLOUDFLARE_API_KEY` global key (from get-secret) for `wrangler deploy`. Frontend: `npm run build:prod && npm run deploy:production`.

## The DONE Condition

ALL of these true across 2 consecutive passes with zero changes:

### Auth — Complete & Verified
- [ ] Google OAuth flow: click "Continue with Google" → Google consent screen → callback → signed in → admin dashboard loads. No errors at any step.
- [ ] GitHub OAuth flow: same as Google.
- [ ] Email + password sign-in: form submission → session created → admin dashboard.
- [ ] Magic link: enter email → link sent → click link → signed in.
- [ ] Sign-up: name + email + password → account created → signed in.
- [ ] 2FA enrollment + verification flow functional.
- [ ] Session management: list sessions, revoke session.
- [ ] Sign-out: session cleared, redirected to homepage.
- [ ] All auth methods visible on both sign-in and sign-up pages (6 methods total).
- [ ] Zero console errors during ANY auth flow.
- [ ] Zero error tooltips or flash messages during auth.

### Admin Shell — Polished & Complete
- [ ] 15 primary nav items all functional with real data
- [ ] 4 "More tools" items functional
- [ ] All 25+ lazy-loaded admin child routes render with 0 console errors
- [ ] Site switcher: shows real sites with favicon + business name, keyboard-navigable
- [ ] Cmd+K command palette: opens, searches, navigates
- [ ] `?` keyboard shortcuts overlay: lists all shortcuts
- [ ] Mobile responsive: sidebar collapses to overlay, all sections usable at 375px
- [ ] Theme toggle (dark/light/system) persists
- [ ] Notification bell shows real notifications (or calm empty state)
- [ ] Error boundary: per-section crash isolation with recovery card
- [ ] Global drop zone: drag file → navigates to media with asset

### All LOOP_LEDGER Features — Complete & Integrated

The `_LOOP_LEDGER.md` is the authoritative feature inventory. Every open `[ ]` item must be completed or explicitly deferred. Key feature groups:

- [ ] All 85+ feature flags promoted to `stage='stable', enabled=1, rollout_percent=100` (except killswitch/deprecated)
- [ ] Inline AI site auditor: one-click Scan Site → site_doctor grade + fixes
- [ ] Social publishing native: 16 publisher adapters wired to CF Workflows v2 scheduling
- [ ] Voice: phone numbers, conversations, test console, agent prompt, MCP attachments
- [ ] Apps catalog: 30 entries, 10 deployable, instance management
- [ ] Billing: Stripe Meters 17 events, checkout, portal, wallet auto-topup
- [ ] Site lifecycle: create → build → deploy → analytics → rebuild → delete
- [ ] Agent-native: MCP server at mcp.projectsites.dev, OAuth 2.1, per-site MCP
- [ ] Dogfooded: platform deploys through own MCP, admin uses site-kit blocks
- [ ] All 30 agent-grade features from STRATEGY.md (deploy_site MCP tool, npx connect, preview URLs, etc.)
- [ ] Every `libs/features/*/` module: manifest complete, E2E tested, flag promoted
- [ ] Every `src/routes/*.ts` handler: Zod-validated, flag-guarded, audit-logged
- [ ] Every `src/services/*.ts` service: typed contracts, error handling, observability

### Every Admin Section — Populated & Functional
- [ ] Dashboard: Getting Started hub, upgrade-moments strip, onboarding checklist, calendar, site health sparklines, usage gauges, MRU cards, activity feed
- [ ] Editor: bolt.diy iframe loads, WebContainer boots, file tree populated, preview renders
- [ ] Snapshots: list renders, create/restore/diff functional
- [ ] Analytics: real PostHog data, overview + live tabs, social tab, NL queries, annotations
- [ ] Forms: form builder, submissions table, analytics, site comparison
- [ ] Apps: catalog grid (30 entries), detail page, instances list, deploy wizard (10 apps)
- [ ] Site Features: plan-aware toggle grid, preview, undo, entitlement-locked states
- [ ] Social: composer for 11+ networks, scheduler, analytics, best-time-to-post, best-posts
- [ ] Voice: phone numbers, conversations, test console, agent prompt editor, MCP attachments
- [ ] Logs: unified dashboard with Audit Trail + Log Explorer tabs, filterable, searchable
- [ ] Feature Flags: filterable list, per-flag toggle/rollout/stage/killswitch, audit timeline
- [ ] Leads: no-website scan, scored leads, claim links, Twenty CRM sync
- [ ] System Services: SERVICE_REGISTRY with REAL probed status, deep-links
- [ ] Docs: OpenAPI explorer with left-rail nav, Try-It UI, endpoint detail
- [ ] Settings: general + AI chat + MCP tabs
- [ ] Domains: backup subdomain, search, connected domains table, domain stack wizard
- [ ] API Tokens: create/list/revoke tokens, Unkey Cloud stats
- [ ] Billing: Stripe Meters usage, checkout + portal, invoice history, plan comparison, wallet
- [ ] User Settings: theme + API keys + language
- [ ] Team: members list, invite form, seat usage
- [ ] Auth Security: sign-in metrics, anomaly detection, recent-suspicious table
- [ ] All site-detail sub-routes: logs/snapshots/SQL/integrations tabs, branches, MCP server, copilot, DNA, swarm
- [ ] Every section has: loading skeleton → data (or calm "Create your first X" empty state) → zero console errors → axe-clean at 6 breakpoints

### Marketing Surface — Gorgeous & SEO-Optimized
- [ ] Homepage: hero + features + trust strip + FAQ + counters + bento + testimonials + blog teaser + newsletter + CTA
- [ ] All public routes 200 with valid SEO metadata (title 50-60 chars, desc 120-156, canonical, OG, JSON-LD)
- [ ] sitemap.xml, robots.txt, humans.txt, security.txt, llms.txt all present + valid
- [ ] PWA: manifest, sw.js, offline.html, installable at all breakpoints
- [ ] CSP Level 3 strict-dynamic, all security headers present
- [ ] LCP ≤ 2.0s, CLS ≤ 0.05, INP ≤ 100ms

### API Surface — Complete & Contract-Enforced
- [ ] All 70+ routes have Zod validation at boundary (no bare `as`-casts)
- [ ] All mutating routes: idempotency key + audit log + feature flag guard + RFC 7807 error envelope
- [ ] `/api/health`: 200 with KV + R2 + D1 latency probes
- [ ] `/api/openapi.json`: auto-generated from Zod schemas
- [ ] All LLM calls routed through LiteLLM → AI Gateway → Langfuse (correlated)

### Platform Services — Every Service Integrated
- [ ] Integration health probes cover all live services (14 total)
- [ ] System Services admin shows REAL probed status for each
- [ ] Inngest→CF Workflows v2: 2 functions ported, Inngest container + secrets deleted
- [ ] Postiz decommissioned: Fly machine deleted, native social on CF Workflows v2
- [ ] Lago→Stripe Meters: Lago deleted, StripeMetersProvider sole implementation
- [ ] Unkey→managed Cloud: ApiKeyProvider factory wired, self-hosted deleted
- [ ] Novu→psnotify: all Novu references removed
- [ ] Nango→native OAuth: deleted, mcp_oauth.ts + native adapters canonical
- [ ] Zero Fly.io instances: every fly.toml removed, Fly API key rotated

### Code Quality — Zero Drift
- [ ] TSC 0 errors in both packages
- [ ] `npm run validate:features` 0 violations
- [ ] No bare `as`-cast reading request bodies without Zod
- [ ] No `console.log` in source
- [ ] Every LLM output consumed through Zod schema validation
- [ ] Sentry breadcrumbs on critical paths with featureSlug tag
- [ ] Feature module architecture enforced: every feature has manifest with 7 required fields

### Visual Quality — Gorgeous Everywhere
- [ ] AI vision scores ≥9/10 on ALL surfaces at ALL breakpoints
- [ ] Brand tokens consistent (--ps-bg, --ps-ink, --ps-accent)
- [ ] Every interactive element: data-testid + aria-label + focus-visible ring
- [ ] Every async surface: loading skeleton + error state with retry + correlation ID + empty state with action
- [ ] No hard-coded colors outside polish tokens
- [ ] All modals use DialogShellComponent
- [ ] prefers-reduced-motion respected on all animations

### E2E Test Fortress — Complete Coverage
- [ ] 30+ E2E spec files, 200+ tests, all GREEN
- [ ] Every admin section has journey + edge-case specs
- [ ] Every auth method has E2E coverage
- [ ] axe-core 0 violations in all specs at 6 breakpoints
- [ ] 0 console errors in all specs
- [ ] Stagehand 100-flow orchestrator ≥95%
- [ ] COVERAGE.yml + FEATURES.md validated by CI gate

### Product Completeness
- [ ] All 85+ feature flags at `stage='stable', enabled=1, rollout_percent=100%` (except killswitch/deprecated)
- [ ] Pricing model live: free tier + paid ($50/mo per site with credit allotment)
- [ ] Agent-native positioning: MCP server at mcp.projectsites.dev, OAuth 2.1
- [ ] No feature permanently-on at launch without a flag

## Loop Termination

Self-cancel when ALL DONE conditions are met across 2 consecutive passes with zero changes, OR when 5 consecutive passes produce 0 changes. Write `_CONVERGENCE_DONE` sentinel with timestamp. Maximum 300 passes.

## Progress

Append each pass to `_CONVERGENCE_LOG.md`:
```
### Pass N — YYYY-MM-DD HH:MM
- Fixed: ...
- Tested: ...
- Deployed: ...
```
