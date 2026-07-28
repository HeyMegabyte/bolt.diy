# Projectsites.dev Platform Convergence Doctrine

## What this is
The complete doctrine for converging projectsites.dev from "many features coded" to "polished, integrated, E2E-verified platform." The inline prompt at `CONVERGENCE_PROMPT.md` is the loop-ready condensed version. This file is the full reference.

## Scope — the ENTIRE platform
- **Marketing surface**: `/`, `/pricing`, `/blog`, `/press`, `/integrations`, `/developers`, `/changelog`, `/search`, `/create`
- **Auth surface**: `/signin`, `/auth/sign-up`, `/auth/sessions`, `/auth/2fa/enroll`, `/auth/2fa/verify`
- **Admin SPA**: 50+ sections under `/admin/*` (see `frontend/src/app/app.routes.ts` for full route tree)
- **API surface**: 70+ routes under `/api/*` (see `apps/project-sites/src/routes/`)
- **Subdomain services (CF Containers)**: mail (Listmonk), crm (Twenty), cms (Payload), traces (Langfuse)
- **Managed SaaS**: Stripe (billing), PostHog (analytics), Novu (notifications), Unkey Cloud (API keys), Langfuse Cloud (AI quality), Deepgram (STT), SES (email)
- **CF Managed**: AI Gateway (inference), D1 (metadata), R2 (storage), Analytics Engine (events), Browser Rendering (screenshots), Workflows v2 (durable execution)
- **Platform infrastructure**: D1, KV, R2, Queues, Workflows v2, DOs, Containers, AI Gateway, Hyperdrive, Turnstile

## The Six Phases

### Phase 0 — Gap Discovery (first fire only, ~10 min)
Cross-reference every coded artifact against every user-facing surface. The gap matrix is the SSOT for the rest of the loop.

**Discovery sources:**
1. Worker routes: `apps/project-sites/src/routes/*.ts` (70+)
2. Admin sections: `apps/project-sites/frontend/src/app/pages/admin/sections/` (50+)
3. Feature flags: `grep -r "feature_flags\|flagKey\|isFlagOn" apps/project-sites/src/`
4. E2E specs: `apps/project-sites/e2e/**/*.spec.ts`
5. Platform services: `platform_services.ts` `PLATFORM_SERVICES` + `SERVICE_REGISTRY`
6. Apps catalog: `apps-catalog.data.ts` `APPS_CATALOG` + `SUPPORTED_APP_SLUGS`
7. Integration health: `integration_health.ts` `KNOWN_INTEGRATIONS`
8. Memory files: `~/.claude/projects/*projectsites*/memory/` — grep for `LIVE`, `deployed`, `production`

**Gap classification:**
- **P0 — Broken**: 500/404/blank surface, console-error on load
- **P1 — Missing UI**: worker route exists, no admin section renders it
- **P2 — Missing backend**: admin section exists, no worker route handles it
- **P3 — Unintegrated**: feature coded but not reachable via nav/UI (orphan route, dead component, flag-gated-and-forgotten)
- **P4 — Ugly**: renders but AI vision <8/10
- **P5 — Untested**: no Playwright journey spec for the surface
- **P6 — Unmonitored**: live platform service with no admin health visibility

**Output:** `_CONVERGENCE_GAP_MATRIX.md` with every gap ranked.

### Phase 1 — Visual Discovery + Fix Critical (every fire)
Stagehand + Browserbase navigates the platform AS A USER, visually discovering errors no code scan would find.

**The sign-in class of bug (canonical example):**
The `SignInComponent` renders email/password + magic link but NOT Google/GitHub OAuth buttons. The backend Better Auth config (`auth/better-auth.ts:140-148`) conditionally includes `socialProviders: { google, github }` when `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID` are set. But the frontend `AuthApiService` has NO `signInSocial()` method, and the `SignInComponent` template has NO Google/GitHub buttons. This gap is invisible to unit tests (they test the component in isolation) and invisible to code-grep audits (the backend config IS there). ONLY visual inspection catches it.

**Stagehand visual discovery recipe:**
```ts
// 1. Navigate to sign-in and catalog available auth methods
await stagehand.navigate('https://projectsites.dev/signin');
const authMethods = await stagehand.extract(
  'list every authentication button, link, and method visible on the sign-in page. ' +
  'Include the button text, aria-label, and whether it is an OAuth provider button.'
);

// 2. Navigate through every admin nav item
await stagehand.act('click the first nav item in the admin sidebar');
const pageState = await stagehand.extract(
  'describe what is visible in the main content area: is it a dashboard, ' +
  'a blank page, an error message, a loading spinner, or a list of items?'
);

// 3. Check for console errors
const consoleErrors = await page.evaluate(() => {
  return (window as any).__consoleErrors || [];
});
```

**Common visual-discoverable errors:**
- Missing OAuth buttons (backend configured, frontend never wired)
- Blank admin sections (component loads but API returns 500/401 — no error state)
- Broken nav links (route defined but lazy-load chunk fails)
- Feature flag-gated sections rendering nothing (flag off, no calm empty state)
- Console errors: CSP violations, missing asset 404s, JS exceptions swallowed by error boundary
- Off-brand: wrong colors, broken layout, missing `_polish.scss` design tokens
- Missing accessibility: no `aria-label` on icon buttons, no `data-testid` on interactive elements
- Inconsistent loading states: some sections have skeletons, others flash blank
- Stale data: admin dashboard shows cached data from hours ago with no refresh indicator

**Fix protocol for each finding:**
1. Stagehand screenshot + extract error details
2. Read the source (component, route handler, service)
3. Fix the ROOT CAUSE (not the symptom — e.g., add missing OAuth button + API method, don't just add a placeholder)
4. Deploy + re-verify with Stagehand
5. Gate: surface renders correctly, 0 console errors, axe-clean at 6bp

### Phase 2 — Wire Unintegrated Features
For every P1/P2/P3 gap in the matrix:

**Backend→Frontend wiring (P1):** worker route exists, no admin UI
- Create Angular standalone component in `frontend/src/app/pages/admin/sections/`
- Use Spartan UI primitives + `_polish.scss` tokens + black/cyan cockpit theme
- Wire route in `app.routes.ts` as lazy-loaded child of `/admin`
- Add nav entry in `AdminComponent` template
- Add `data-testid` to every interactive element
- Gate: feature flag controls visibility (404 when off, renders when on)

**Frontend→Backend wiring (P2):** admin section exists, no worker route
- Create Hono route handler with Zod validation (`safeParse` at boundary)
- Add feature flag guard (`isFlagOn` → 404 when off)
- Mount in `index.ts` via `app.route()`
- Add audit log entry on mutations
- Gate: API returns proper JSON with correlation IDs

**Orphan feature rescue (P3):** coded but unreachable
- Trace from the code to the nearest user-facing surface
- Add the missing link/button/nav-entry that makes it reachable
- If the feature is genuinely dead: flag it `killswitch` + add deprecation notice, don't silently orphan

**Sign-in/Auth surface (special focus):**
The `/signin` page is the gateway to the entire admin. Every auth method the backend supports MUST render on this page:
- `AuthApiService` needs: `signInSocial(provider: 'google' | 'github')` → opens popup/redirects to Better Auth OAuth endpoint
- `SignInComponent` template needs: Google button ("Continue with Google"), GitHub button ("Continue with GitHub") in the social-login section (below email/password, above the OR divider)
- Callback route `/auth/sign-in` already exists in `app.routes.ts` — verify it handles the OAuth return
- E2E test: mock the OAuth flow (inject `MOCK_SESSION` cookie simulating a post-OAuth session)

### Phase 3 — Visual Polish
Every surface gets the black/cyan cockpit treatment.

**Polish standards:**
- Design tokens: `--ps-bg: #060610`, `--ps-ink: #f4f4ff`, `--ps-accent: #00e5ff`, `--ps-z-overlay-takeover: 100000`, `--ps-radius-xl: 22px`, `--ps-shadow-modal`
- Compact density: less whitespace, more data per viewport
- Cyan accent: highlights only (primary buttons, active nav, focus rings, selected rows) — never background washes
- Glass/grain: `backdrop-blur` + subtle `bg-white/[0.03]` on cards
- Borders: `1px solid rgba(0, 229, 255, 0.08)`
- Hover: `translateY(-1px)` + `box-shadow: 0 0 20px rgba(0, 229, 255, 0.15)`
- Typography: Sora/Space Grotesk headings, JetBrains Mono for data/code
- Every section header: icon + title + one-line description
- Tables: monospace data cells, human-readable headers, sort indicators, row hover
- Modals: `DialogShellComponent` ONLY — no custom modal implementations
- Focus: `focus-visible:ring-2 focus-visible:ring-[#00e5ff]/50` on every interactive element

**AI vision rubric (0-10):**
- Layout sane (no overflow, no broken grid, responsive at all breakpoints) — 3 pts
- Contrast AA (text legible, brand colors work on dark bg) — 2 pts
- Brand consistency (cyan/black/dark, correct fonts, correct spacing) — 2 pts
- No slop (no raw/unstyled elements, no inconsistent padding, no misaligned icons) — 2 pts
- Delight (subtle animations, glass effects, thoughtful micro-interactions) — 1 pt

Must score ≥9/10 before moving on.

### Phase 4 — E2E TDD Fortress
Every surface gets journey + edge-case Playwright specs.

**Spec structure:**
```ts
import { test, expect } from '../fixtures.js'; // authedPage fixture

test.describe('Admin > {Section}', () => {
  test('journey: renders and is interactive', async ({ authedPage: page }) => {
    // Start at homepage (fixture handles auth)
    await page.goto('/');
    // Navigate to admin
    await page.click('[data-testid="nav-admin"]');
    // Navigate to section
    await page.click('[data-testid="nav-{section}"]');
    // Assert section shell
    await expect(page.locator('[data-testid="{section}-shell"]')).toBeVisible();
    // Assert 0 console errors
    // Assert axe-clean at 6 breakpoints
    // Assert every CTA clickable
    // Assert form validation
    // Assert modal open/close
    // Screenshot every step
  });

  test('edge: empty state', async ({ authedPage: page }) => { /* ... */ });
  test('edge: error state', async ({ authedPage: page }) => { /* ... */ });
});
```

**TDD flow:** Write failing spec → RED → implement → GREEN → refactor → screenshot → commit.

### Phase 5 — Deploy + Verify Live
Every code change deploys to prod and gets verified.

```bash
# Gate checks
cd apps/project-sites && npm run typecheck && npm run lint && npm test
cd apps/project-sites/frontend && npx tsc --noEmit -p tsconfig.app.json

# Deploy backend (needs Docker for container builds)
cd apps/project-sites && npx wrangler deploy --env production

# Deploy frontend
cd apps/project-sites/frontend && npm run build:prod && npm run deploy:production

# Prod smoke
curl -s -o /dev/null -w '%{http_code}' https://projectsites.dev/  # → 200
curl -s -o /dev/null -w '%{http_code}' https://projectsites.dev/signin  # → 200
curl -s -o /dev/null -w '%{http_code}' https://projectsites.dev/api/health  # → 200
curl -s -o /dev/null -w '%{http_code}' https://project-sites.manhattan.workers.dev/admin  # → 200 or 302

# Stagehand smoke: navigate prod, sign in, click 5 key sections, verify 0 console errors
```

### Phase 6 — Stagehand 100-Flow Master Orchestrator
Run after every ~5 items shipped:

```bash
cd apps/project-sites && \
  SHARD_INDEX=0 SHARD_TOTAL=1 \
  npx playwright test e2e/stagehand-master-orchestrator.spec.ts \
  --config=e2e/playwright.prod.config.ts
```

The orchestrator (`e2e/stagehand-master-orchestrator.spec.ts`) defines 100 flows across:
- F001-F005: Auth & session
- F006-F010: Dashboard & navigation
- F011-F030: Sites (CRUD, domains, snapshots, branches, MCP servers)
- F031-F045: Editor & bolt.diy
- F046-F060: Media, forms, billing
- F061-F075: Analytics, logs, audit
- F076-F085: Settings, team, feature flags
- F086-F095: Apps catalog, social, voice
- F096-F100: Integration health, system services, cross-cutting

Pass threshold: ≥95% on non-missing flows. Failures get root-cause fix, never workaround.

## Platform Service Architecture (per ADR-0034)

### Managed SaaS + CF Containers (LIVE, load-bearing)

| Service | Domain | Runtime | Role |
|---------|--------|---------|------|
| **AI Gateway** | (CF managed) | cloudflare-managed | Inference accounting — routing, caching, spend controls, rate limits, diagnostics |
| **Langfuse Cloud** | (managed SaaS) | managed-saas | AI quality — traces, prompt versioning, evals, experiments, feedback |
| **Stripe** | (managed SaaS) | managed-saas | Billing: Stripe Meters (17 `ps_*` events) + Billing (payment collection) |
| **Unkey Cloud** | (managed SaaS) | managed-saas | API keys — issuance, hashing, revocation, rate limiting, analytics |
| **Listmonk** | mail.projectsites.dev | cloudflare-container | Campaign/marketing email — segments, templates, bounces, scheduling |
| **Twenty CRM** | crm.projectsites.dev | cloudflare-container | CRM — leads, contacts, organizations |
| **Payload CMS** | cms.projectsites.dev | cloudflare-container | Content management for marketing surfaces |
| **PostHog** | (managed SaaS) | managed-saas | Product analytics, session replays |
| **Deepgram** | (API, managed) | managed-saas | Speech-to-text for voice features |
| **SES** | (managed SaaS) | managed-saas | Transactional email (primary rail, ADR-0019) |

### Replaced with CF-native primitives (per ADR-0034)

| Removed | Replacement | Why |
|---------|------------|-----|
| **Inngest** | CF Workflows v2 | 2 thin functions → native binding, zero infra |
| **Postiz** | Native social (CF Workflows v2 + Upstash + D1 + Tinybird) | 16 publisher adapters already built; AGPL + $50+/mo eliminated |
| **Lago** | Stripe Meters | Permanent — Stripe owns metering + payment collection |
| **Nango** | Native OAuth (mcp_oauth.ts + D1 AES-GCM tokens) | External token vault unnecessary — PKCE + paste-key already built |
| **Unkey self-hosted** | Unkey Cloud (managed) | Vendor whose product IS key management |
| **n8n** | WorkflowRouter + CF Workflows v2 | Already built, already integrated |
| **Dittofeed** | Novu + Listmonk | No gap — both already cover customer engagement |
| **Plane** | In-repo issue tracking | Doctrine prefers `.claude/issues/` + GitHub Issues |
| **Langfuse self-hosted** | Langfuse Cloud (managed) | Operational simplicity |
| **SearxNG** | CF Browser Rendering + existing search | `search.ts` (118K) handles business search |
| **Activepieces** | WorkflowRouter | Redundant — overlaps n8n + Workflows |

Each service gets:
1. Health probe in `integration_health.ts` `KNOWN_INTEGRATIONS`
2. Admin visibility in `/admin/system-services` with REAL status (probed, not static)
3. Deep-link from relevant admin section
4. E2E journey spec verifying the integration path

## Auth Mock for E2E

`e2e/helpers/auth.js` exports `signInAsTestUser(page)`:
- Primary path: inject `MOCK_SESSION` cookie with pre-signed JWT (when `E2E_API_KEY` is set in wrangler secrets)
- Fallback 1: POST `/api/auth/sign-in/email` with `test@megabyte.space` + `TEST_USER_PASSWORD`
- Fallback 2: POST `/api/auth/sign-in/magic-link`, poll inbox endpoint for token, verify
- After auth: `waitForSelector('[data-testid="admin-shell"]')` or appropriate shell element
- Auth state cached via `storageState` so sequential tests reuse session

If sign-in breaks: FIX THE AUTH HELPER FIRST. Every other E2E test depends on it. This is the single highest-priority fix in the entire convergence loop.

## The DONE Condition

The loop self-terminates when ALL of these are true across 3 consecutive passes with zero changes:

1. `_CONVERGENCE_GAP_MATRIX.md` shows 0 P0/P1/P2/P3 gaps
2. Every `/admin/*` route + every public route renders with 0 console errors
3. Sign-in page shows ALL configured auth methods (email + password + magic link + Google + GitHub)
4. Every admin section has ≥1 Playwright journey spec (homepage-start, UI-navigation, axe-clean at 6bp)
5. Every live platform service has: integration health probe + admin system-services visibility + deep-link from relevant section
6. Stagehand 100-flow orchestrator ≥95%
7. AI vision scores ≥9/10 on all surfaces at all 6 breakpoints
8. `npm run typecheck && npm run lint && npm test` all green in both `apps/project-sites` and `apps/project-sites/frontend`
9. Deploy + prod smoke passes in ≤1 attempt
10. All LLM calls flow through AI Gateway + Langfuse (correlated); all API keys managed through Unkey Cloud; all email flows through SES + Listmonk; platform consolidations complete per ADR-0034

## Autonomous Authority by Risk Tier

- **Autonomous** (just do it): fix bugs, wire features, write tests, polish UI, deploy, verify, create feature flags, add admin sections, add health probes, fix auth flows, add OAuth buttons, update catalog data, add nav entries, fix CSP headers, add data-testid attributes, fix aria-labels, add loading/empty/error states
- **Review-recommended** (proceed, surface in report): new npm dependency, D1 schema migration, new admin section for unbuilt feature, new platform service health probe, new Stagehand flow definition
- **Approval-required** (pause, surface one-paragraph pitch): payment/billing behavior changes, auth provider switching, bulk user data mutations, secret rotation, DNS/domain changes, new subdomain service deployment
- **Blocked** (refuse): destructive D1 ops without backup, R2 bucket deletion, removal of security headers, disabling auth requirements

## Running the Loop

```bash
# One-line launch:
/loop 20m Read /Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/CONVERGENCE_PROMPT.md and execute it. Start with Phase 1 visual discovery — use Stagehand to navigate https://projectsites.dev/signin and catalog every visible auth method. Then proceed through Phases 2-6.

# Longer interval for deeper work:
/loop 30m Read /Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/CONVERGENCE_PROMPT.md and execute the next phase.
```

20 minutes is the sweet spot — enough for one coherent fix cycle (discover → fix → deploy → verify) without drifting. Switch to 30m when doing deeper multi-file wiring work.
