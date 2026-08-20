# Project Sites Frontend — AI Context Guide

> Angular 21 admin SPA + marketing surface served at `projectsites.dev`.
> Talks to the Cloudflare Worker (`apps/project-sites/src`) via `/api/*`.
> Deploys to R2 via `scripts/deploy-r2.mjs`; the worker serves the dist
> assets at edge after each push.

## Quick Start

```bash
cd apps/project-sites/frontend
npm install --legacy-peer-deps           # NOT pnpm (electron-builder breaks workspace)
npm start                                # ng serve at http://localhost:4200
npm test                                 # Karma + Jasmine, watch mode (NOT Vitest / Jest)
npm run test:ci                          # Karma headless one-shot (ChromeHeadless) — 26 tests
npm run build:prod                       # ng build + alt-text gate
npm run deploy:staging                   # R2 push (staging slot)
npm run deploy:production                # R2 push (production slot)
npm run verify:production                # Playwright smoke on https://projectsites.dev
npx tsc --noEmit -p tsconfig.app.json    # Typecheck SPA
```

## Stack

| Concern | Choice | Notes |
|--------|--------|-------|
| Framework | Angular 21 standalone components | No `NgModule` anywhere; signal-first; zoneless; `httpResource()` + incremental hydration; RxJS-first at every backend edge per [[rxjs-first-angular]] |
| Reactivity | Signals + computed + effect | RxJS only at HTTP edges |
| Routing | `@angular/router` standalone | View Transitions enabled in `app.config.ts` |
| Styling | Tailwind v4 + cascade-layered SCSS | `_polish.scss` owns brand tokens + admin chrome |
| Forms | Template-driven `FormsModule` | Reactive forms NOT used; signals + custom validators |
| HTTP | `HttpClient` via `ApiService` | 30s timeout, 401 redirect, toast on error |
| Tests (unit) | Karma + Jasmine (`ng test`) | No Vitest configured |
| Tests (e2e) | Playwright `@playwright/test ^1.58` | 79 specs: `*.spec.ts` (dev/PR, CI) + `*.e2e.ts` (prod, manual) — see "Two E2E suites" below |
| Editor | bolt.diy iframe at `editor.projectsites.dev` | Persistent across admin sub-routes via `BoltEmbedService` |
| PWA | Angular service worker (`ngsw-config.json`) | Manifest + offline kill-switch |
| Translations | `@ngx-translate/core` (`en`, `es`) | `assets/i18n/*.json`; `AppShellService` syncs `<html lang>` |
| Observability | Sentry + PostHog + GA4/GTM | Trifecta wired in `app.config.ts` + `index.html` |

## Source Layout

```
src/
├── index.html                          # Shell + analytics snippets + meta
├── main.ts                             # bootstrapApplication(AppComponent, appConfig)
├── app/
│   ├── app.config.ts                   # Providers (router, http, animations, sentry, i18n)
│   ├── app.routes.ts                   # Top-level routes (lazy-loaded per page)
│   ├── app.component.ts                # Root shell — header, router-outlet, toast layer
│   ├── animations/                     # Reveal-on-scroll, count-up, ripple directives
│   ├── components/
│   │   ├── agent-message/              # Streaming Markdown primitive (live agent output, code-fence aware)
│   │   ├── ai-chat-widget/             # AI dock — Cmd+K opens, asks AdminStateService
│   │   ├── before-after-slider/        # Cinematic comparison slider (keyboard + pointer)
│   │   ├── bg-orbs/                    # Marketing background motion
│   │   ├── command-palette/            # Cmd+K palette (admin + marketing)
│   │   ├── delete-confirm/             # Site-delete confirmation dialog
│   │   ├── dialog-shell/               # ONE primitive every modal uses
│   │   ├── domain-picker/              # Vanity domain suggestions + RDAP availability
│   │   ├── easter-eggs/                # Konami/ascii eggs
│   │   ├── env-vars-manager/           # CRUD UI for /api/env-vars (org/site/mcp scope)
│   │   ├── fullscreen-overlay/         # Reusable modal-takeover surface
│   │   ├── global-drop-zone/           # Drag-anywhere uploads → /api/media/upload
│   │   ├── header/                     # Marketing nav + admin shell header
│   │   ├── network-status/             # Online/offline banner + retry queue
│   │   ├── notification-bell/          # In-app notifications popover
│   │   ├── rolling-counter/            # Tabular-num count-up tied to IntersectionObserver
│   │   ├── section-error-boundary/     # Per-section crash isolation + RxJS bus
│   │   ├── shortcuts-overlay/          # `?` shortcut help overlay
│   │   ├── side-panel/                 # Right-rail drawer (audit/preview)
│   │   ├── stripe-checkout/            # Embedded checkout iframe host
│   │   ├── task-tray/                  # Inbox of agent-posted human-in-the-loop questions
│   │   ├── toast/                      # Toast layer (deduped, action-armed)
│   │   └── trust-strip/                # "Built on" logo strip for marketing surfaces
│   ├── directives/
│   │   └── focus-trap.directive.ts     # WCAG 2.4.3 keyboard trap for modals/popovers
│   ├── guards/                         # Route guards (auth-required, paid-required)
│   ├── interceptors/                   # HTTP interceptors (auth header injection)
│   ├── pages/
│   │   ├── homepage/                   # Marketing hero + features + CTAs
│   │   ├── create/                     # Create-from-search wizard
│   │   ├── search/                     # Business + pre-built site search
│   │   ├── signin/                     # Magic-link / Google OAuth entry
│   │   ├── waiting/                    # Real-time build progress
│   │   ├── admin/                      # Dashboard shell + sub-routes
│   │   │   ├── admin.component.ts      # Owns the persistent <iframe #boltFrame>
│   │   │   ├── admin-state.service.ts  # Sites + analytics + polling (visibility-aware)
│   │   │   └── sections/               # forms, snapshots, billing, audit, docs,
│   │   │                               # ai-endpoints, ai-logs, settings, analytics,
│   │   │                               # mcp, user-settings, editor (iframe-host),
│   │   │                               # apps, social,
│   │   │                               # voice, dashboard, domains, seo, sites,
│   │   │                               # feature-flags (System Administrator layer +
│   │   │                               # feature-flags/ primitives), site-features
│   │   │                               # (Features layer — site-scoped, plan-aware)
│   │   ├── blog/, changelog/, status/, privacy/, terms/, content/, contact/
│   ├── services/
│   │   ├── api.service.ts              # HttpClient wrapper — typed endpoints, 30s timeout
│   │   ├── app-shell.service.ts        # `<html lang>` + language persistence
│   │   ├── auth.service.ts             # Session + localStorage state container
│   │   ├── blog.service.ts             # Blog post fetch + caching
│   │   ├── bolt-embed.service.ts       # Persistent bolt.diy iframe lifecycle
│   │   ├── error-handler.service.ts    # OWNED by Sentry agent — do not edit
│   │   ├── geolocation.service.ts      # Haversine + browser-geo prompt
│   │   ├── loading.service.ts          # Global + per-key loading signals
│   │   ├── meta.service.ts             # Per-route SEO/OG tag application
│   │   ├── sentry.service.ts           # OWNED by Sentry agent
│   │   ├── stripe.service.ts           # Lazy Stripe.js loader + embedded checkout
│   │   ├── telemetry.service.ts        # OWNED by analytics agent (PostHog/GA4)
│   │   └── toast.service.ts            # Dedupe-aware toast queue (action-armed)
│   └── utils/
│       ├── safe-parse.ts               # JSON-safe parse with default fallback
│       └── validators/
│           ├── email.ts                # SSOT email validator (mirrors shared/base)
│           └── email.spec.ts           # Jasmine unit coverage
└── assets/
    ├── i18n/{en,es}.json               # @ngx-translate dictionaries
    └── images/                         # Static SVGs / logos / OG cards
```

## Key Services + How They Interact

### `AdminStateService` (admin shell)
Provided at `AdminComponent` level so every sub-section shares one instance.
Holds `sites`, `selectedSite`, `subscription`, `domainSummary`, `analytics`.
Live refresh runs every 30s for sites and every 60s for analytics — pauses
automatically when `document.hidden` flips true (visibility-change listener
attached in `startLiveRefresh`, removed in `stopPolling`).

### `BoltEmbedService` (editor lifecycle)
Owns the bolt.diy iframe across admin routes. The `<iframe>` lives in
`AdminComponent`'s template so it is never destroyed when the user switches
between `/admin/forms` and `/admin/editor`. Pre-boots as soon as
`selectedSite()` resolves so by the time the user clicks "Editor" the
WebContainer is already warm. PostMessage protocol:
`PS_BOLT_READY` → `PS_APP_RUNNING` → `PS_FILES_READY` → `PS_GENERATION_STATUS`.

### `ApiService` (HTTP)
Single source for `/api/*` calls. Injects the bearer token from
`AuthService`, applies a 30s timeout, and routes errors through `ToastService`.
401 from a protected route (`/admin`, `/billing`, `/editor`) bounces the user
to `/signin?returnUrl=`; 401 from public routes silently clears the session.

### `ToastService`
Dedupes identical (message + type) toasts within 2s, supports `action`-armed
toasts ("Retry", "Undo") and `correlationId` for support hand-off. Default
durations: error 7s, warning 6s, info 4.5s, success 4s. `duration: 0` makes a
toast sticky.

### `SectionErrorBus` + `SectionErrorBoundaryComponent`
Decoupled global-error→boundary fan-out. `GlobalErrorHandler` pushes to the
bus; every mounted boundary subscribes and filters by route. Lets us isolate
crashes to a single admin section without nuking the whole page.

## Cmd+K Mandate

Pressing `Meta+K` / `Ctrl+K` opens `CommandPaletteComponent` and immediately
focuses its input. This is a build gate in `e2e/cmdk-focus.spec.ts` — failing
the focus assertion fails CI.

## Design Tokens

Brand tokens live in `src/styles/_polish.scss`:
- `--ps-bg: #060610` (dark-first)
- `--ps-ink: #f4f4ff`
- `--ps-accent: #00e5ff`
- `--ps-z-overlay-takeover: 100000` (above toast 9999, banner 10000, popover 99950)
- `--ps-radius-xl: 22px`
- `--ps-shadow-modal: …`

ALL hard-coded colors should reference these tokens. Drift gets flagged in the
Turn-3 audit doc.

## View Transitions

`app.config.ts` enables `withViewTransitions()`. Named transitions in routes
preserve continuity across hero → sub-page navigations. Pair with
`prefers-reduced-motion` — every animation in `animations/` checks that media
query before scheduling.

## Performance & Preload Doctrine (app principle)

The app must feel **blazing fast** — preloaded, ready, never a needless skeleton.
This is a standing principle, not a one-off; new surfaces follow it.

- **Preload every route after first paint.** `app.config.ts` uses
  `withPreloading(PreloadAllModules)`, so every lazy chunk downloads in the
  background once the shell is interactive — a click never waits on a chunk.
- **Lazy-load heavy libs, never eagerly.** monaco / echarts / ag-grid / uppy /
  jszip live behind `@defer` or lazy-routed sections — never an eager `imports:`
  array. See § Known perf-budget items.
- **Stale-while-revalidate for list pages.** A list surface that is re-visited
  (component re-created on route nav) must paint its **last-known data instantly**
  from an injector-scoped cache, then refresh in the background — no skeleton
  flash on re-visit. Reference impl: `AppsInstancesCache` (a `providedIn:'root'`
  singleton) feeding `apps-instances.component`'s `ngOnInit` SWR path. First
  visit (cold cache) shows the skeleton; every re-visit is instant.
- **Visibility-gated background sync.** Polling pauses when `document.hidden` and
  catches up on return (mirrors `AdminStateService`) — fresh without burning
  requests on a backgrounded tab.
- **Per-route `<head>` is owned server-side** by the Worker's `HTMLRewriter`
  pass (title/desc/canonical/OG per route) — never client-only, so crawlers +
  scrapers read the right meta. Client `MetaService` is an enhancement, not the
  source of truth.
- **North star: TTFR.** Target LCP ≤ 2.0s. SSR-shell-first for the marketing
  surface; the admin SPA preloads + lazy-loads so navigation feels instant.

## Build + Deploy

```bash
npm run build:prod                       # writes dist/, runs alt-text gate
npm run deploy:staging                   # syncs dist/ → R2 bucket staging slot
npm run deploy:production                # syncs dist/ → R2 bucket prod slot
npm run verify:production                # Playwright smoke on https://projectsites.dev
```

The worker serves the SPA shell at `/` and `/admin/*` from R2 + the marketing
homepage at `/`. Asset paths are CDN-busted via Angular's hashed filenames.

### Known perf-budget items (tracked 2026-06-02 — `ng build` WARNS, does not fail)

- **✅ RESOLVED 2026-08-07 (commit `fe90fa69`) — budget CLOSED, warning GONE.**
  Initial bundle now **1.11 MB raw / 243.6 KB transfer** (was 1.81 MB / 436 KB).
  Fix: moved ag-grid's `ModuleRegistry.registerModules` out of the EAGER `main.ts`
  into a lazy-only `app/pages/admin/sections/_ag-grid-setup.ts` (imported ONLY by
  the two `loadComponent`-lazy grids audit + ai-logs) and removed main.ts's ag-grid
  import entirely → esbuild put ag-grid in an 864 KB LAZY chunk. Deployed +
  Browserbase-as-brian verified both grids still render with 0 console errors (no
  #200). **⚠️ The round-41/42/49 "dead ends" below were CONFOUNDED — they failed
  ONLY because `main.ts` STILL eagerly imported ag-grid the whole time; removing
  THAT was the missing piece.**
- **✅ FINAL RESOLUTION 2026-08-20 (iters 236-237, commits `98e686f4`+): ag-grid
  is REMOVED ENTIRELY.** The perf-wave ag-grid→TanStack migration
  (`docs/perf-wave-ag-grid-to-tanstack.md`, status COMPLETE) migrated `/admin/audit`
  + the traces grid (`/admin/logs?tab=traces`) to inline TanStack Table — the
  864 KB lazy ag-grid chunk is GONE from the build, `npm rm ag-grid-community
  ag-grid-angular`, `_ag-grid-setup.ts` deleted, and the critical
  `aria-required-children` axe violation is fixed at the root (prod E2E asserts
  axe-clean WITHOUT the former `.ag-root` exclusion). The historical
  budget-bug detail below is kept for the record only:
- **Initial bundle 1.81 MB raw / 436 KB transfer — 205 KB over the 1.6 MB
  `initial` budget** (`angular.json` `budgets`). **ROOT CAUSE PINPOINTED (round 41
  via `--stats-json`):** the 800 KB initial `chunk-GGAROBNS.js` is **782 KB of
  `ag-grid-community`, EAGER** — `main` imports it via a static `import-statement`.
  (The earlier "ag-grid is ALREADY lazy" note was wrong.) ag-grid is imported at
  the **module top level** of TWO lazy admin sections — `audit.component.ts`
  (lines 2-22 + `ModuleRegistry.registerModules` side-effect at :28) and
  `ai-logs.component.ts` (:14-41) — and esbuild hoists the dep into the initial
  bundle. That one dep is ~181 KB transfer — fixing it closes the budget.
  **DIAGNOSTIC (round 49):** it is NOT the 2-route sharing — temporarily orphaning
  the ai-logs route (ag-grid → single importer = audit only) left the bundle still
  205.08 KB over (vs 205.13 baseline, unchanged). esbuild promotes the large lazy
  dep to a `main`-imported chunk even from ONE lazy route. So `@defer` AND the
  shared-single-component approach are BOTH dead ends — the only fixes are
  removing ag-grid (TanStack) or ejecting from Angular's builder to configure
  esbuild chunking (huge). Don't re-attempt lazy-load tricks.
  **`@defer` approach FAILED (round 42 — tried + reverted):** converting both
  components to `import type` + async `import('ag-grid-community')` in `ngOnInit`
  + `@defer (when agReady())` on `<ag-grid-angular>` made the bundle WORSE
  (1.81 MB → 2.01 MB; the ag-grid initial chunk grew 800 KB → 1.01 MB). Root
  cause: ag-grid-angular is shared by TWO lazy routes (audit + ai-logs), so
  esbuild's chunk-splitter hoists it into the initial bundle REGARDLESS of
  `@defer`, and the added `await import('ag-grid-community')` just duplicated it
  (ag-grid via the still-eager ag-grid-angular + a new dynamic chunk). `@defer`
  on a component shared across multiple lazy routes does NOT de-hoist it.
  **Fixed 2026-08-20 by the TanStack migration above** (no speculative shared
  abstraction: audit migrated inline first, ai-logs second, and no
  `pages/admin/data-table/` seam was extracted — the two components deliberately
  own their small duplicated table plumbing per the inverted-abstraction pyramid;
  the inline-TanStack `api-tokens.component.ts` pattern remains the copy-source).
  TanStack is headless (~15 KB vs 782 KB) — removal aligned with doctrine
  (package-registry: "ag-grid Community ONLY for 100k+ row enterprise grids" —
  these are admin log tables).
  Secondary (smaller): (a) command-palette/shortcuts-overlay are `@if`-conditional
  but eager in `app.component` — `@defer (when …){ @if(…){…} }` trims ~30 KB but
  risks the SUPREME Cmd+K-focus gate (`e2e/cmdk-focus`, dev-suite, can't gate
  locally); easter-eggs already deferred (round 40, ~1 KB).
- **Initial bundle 1.81 MB raw / 436 KB transfer — 205 KB over the 1.6 MB
  `initial` budget** (`angular.json` `budgets`). **ROOT CAUSE PINPOINTED (round 41
  via `--stats-json`):** the 800 KB initial `chunk-GGAROBNS.js` is **782 KB of
  `ag-grid-community`, EAGER** — `main` imports it via a static `import-statement`.
  (The earlier "ag-grid is ALREADY lazy" note was wrong.) ag-grid is imported at
  the **module top level** of TWO lazy admin sections — `audit.component.ts`
  (lines 2-22 + `ModuleRegistry.registerModules` side-effect at :28) and
  `ai-logs.component.ts` (:14-41) — and esbuild hoists the dep into the initial
  bundle. That one dep is ~181 KB transfer — fixing it closes the budget.
  **DIAGNOSTIC (round 49):** it is NOT the 2-route sharing — temporarily orphaning
  the ai-logs route (ag-grid → single importer = audit only) left the bundle still
  205.08 KB over (vs 205.13 baseline, unchanged). esbuild promotes the large lazy
  dep to a `main`-imported chunk even from ONE lazy route. So `@defer` AND the
  shared-single-component approach are BOTH dead ends — the only fixes are
  removing ag-grid (TanStack) or ejecting from Angular's builder to configure
  esbuild chunking (huge). Don't re-attempt lazy-load tricks.
  **`@defer` approach FAILED (round 42 — tried + reverted):** converting both
  components to `import type` + async `import('ag-grid-community')` in `ngOnInit`
  + `@defer (when agReady())` on `<ag-grid-angular>` made the bundle WORSE
  (1.81 MB → 2.01 MB; the ag-grid initial chunk grew 800 KB → 1.01 MB). Root
  cause: ag-grid-angular is shared by TWO lazy routes (audit + ai-logs), so
  esbuild's chunk-splitter hoists it into the initial bundle REGARDLESS of
  `@defer`, and the added `await import('ag-grid-community')` just duplicated it
  (ag-grid via the still-eager ag-grid-angular + a new dynamic chunk). `@defer`
  on a component shared across multiple lazy routes does NOT de-hoist it.
  **Correct fix (genuinely big — a real wave, NOT a quick win):** migrate both
  grids from ag-grid to **TanStack Table**. **Executable blueprint:
  `apps/project-sites/docs/perf-wave-ag-grid-to-tanstack.md`** (feature inventory,
  TanStack mapping, step-by-step, live-QA checklist, budget-close verification —
  read it before starting; do NOT re-derive or re-attempt the documented dead
  ends). (already a project dep;
  package-registry mandates "ag-grid Community ONLY for 100k+ row enterprise
  grids" — these are admin log tables, so ag-grid is over-engineered here).
  TanStack is headless (~15 KB vs 782 KB) → removes ag-grid entirely → closes
  the budget AND aligns with doctrine. Cost: reimplement the faux master/detail
  (full-width rows), dark-cyan theme, CSV export, pagination in TanStack for
  BOTH `audit.component.ts` + `ai-logs.component.ts`, re-verify both grids live
  (need `E2E_API_KEY`). Until then the 205 KB overage is a build WARNING (not a
  failure) — admin-only feature weight that also (wrongly) loads on marketing.
  Secondary (smaller): (a) command-palette/shortcuts-overlay are `@if`-conditional
  but eager in `app.component` — `@defer (when …){ @if(…){…} }` trims ~30 KB but
  risks the SUPREME Cmd+K-focus gate (`e2e/cmdk-focus`, dev-suite, can't gate
  locally); easter-eggs already deferred (round 40, ~1 KB).
- **`social.component.ts` styles 32.86 KB > 28 KB** `anyComponentStyle` budget
  (+4.86 KB; verified 2026-08-14 build). The component is now **3267 lines**
  (grew from 2349); the real CSS block is lines **1064–1697 (~633 lines)**.
  **INVESTIGATED 2026-08-14 → NOT a blind trim, and NOT a cold quick-win.** The
  CSS is dense + well-written: zero dead rules, zero duplicate selectors, zero
  comment bloat (line 1181 documents already-removed classes). The only
  byte-lever is stripping `var(--ps-accent,#00e5ff)` token fallbacks (~2 KB max
  — insufficient for 4.86 KB) and that's a visual-adjacent change to a deep
  authed component (`::ng-deep`/`innerHTML`-styled classes make static dead-CSS
  detection unsafe). **Correct fix = split the god component** into sub-sections
  (each under budget), verified live via a Browserbase `/admin/social` sweep at
  6 breakpoints — a real wave, mirroring the ag-grid→TanStack `perf-wave`
  handling above. Until then this stays a build WARNING (non-failing).

Heavy libs stay lazy: never add monaco/echarts/ag-grid/jszip/@codemirror to an
eager `imports:` array — they belong in `@defer` blocks or lazy-routed sections.

### Two E2E suites + a CI wiring gap (tracked 2026-06-02)

There are two Playwright suites in `e2e/`, split by config:
- **`*.spec.ts` — dev/PR gate.** Run by `playwright.config.ts` (default
  `testMatch` = `*.spec.ts`) against a local static server (`scripts/e2e_server.cjs`
  on `:4300`). **This is what CI runs** (`.github/workflows/frontend-e2e.yaml`
  → `npx playwright test --shard` with no `--config`).
- **`*.e2e.ts` — prod suite.** Run by `playwright.prod.config.ts`
  (`testMatch: '**/*.e2e.ts'`, `baseURL` = `PROD_URL` ?? `https://projectsites.dev`)
  via `npm run test:e2e:prod`. Holds the live a11y/contrast/reflow gates
  (`marketing-responsive`, `marketing-a11y`, `admin-a11y`, `admin-reflow`,
  `contact-form`, …).

**Now wired (closed):** the frontend `*.e2e.ts` prod suite runs in CI via the
`prod-e2e-frontend` job in `.github/workflows/prod-e2e.yml` — on push to
`frontend/e2e/**` + `frontend/playwright.prod.config.ts`, on the daily 07:13 UTC
schedule, and on `workflow_dispatch`. It uses the **fail-open `E2E_API_KEY`
gate** (`conditional-ci-gates`): when the `E2E_API_KEY` repo secret is unset the
suite step is SKIPPED (a `::notice::`), never failed — so forks + secret-less
runs stay green. **To activate enforcement, add the `E2E_API_KEY` secret** at
`https://github.com/heymegabyte/projectsites.dev/settings/secrets/actions` (its
value is `get-secret E2E_API_KEY`). Until then the job runs but skips the suite.
Not PR-triggered (the prod suite tests live prod, not the PR diff).

## Common Gotchas

1. **`pnpm install` fails** — electron-builder SSH dep breaks the monorepo.
   Use `npm install --legacy-peer-deps` in this sub-package.
2. **No Vitest** — unit tests are Karma + Jasmine via `ng test`. Don't try to
   add Vitest specs; the runner won't find them.
3. **`console.log` blocked** — ESLint blocks `console.log`. Use `console.warn`
   for structured logs.
4. **localStorage in SSR** — `AuthService` and `AppShellService` wrap every
   `localStorage` call in try/catch so private mode / quota errors never throw.
5. **`@ngx-translate` is sync** — `init` runs before bootstrap so the first
   paint is in the right language. Late language changes go through
   `AppShellService.applyLanguage()`.
6. **bolt iframe origin allowlist** — `BoltEmbedService` only listens to
   messages from `editor.projectsites.dev` and `localhost:5173`. Add new
   origins to `ALLOWED_ORIGINS`.
7. **MCP OAuth fallback** — `/api/mcp/:provider/connect` returns
   `501 oauth_not_configured` when the worker lacks the provider's client_id
   secret. The UI must show a paste-key fallback toast instead of opening a
   broken popup.
8. **Sentry agent + analytics agent territory** — `error-handler.service.ts`,
   `sentry.service.ts`, `telemetry.service.ts`, `analytics.service.ts`, and
   the GTM/PostHog snippets in `index.html` are owned by parallel agents.
   Don't edit them in the same turn or you'll merge-conflict.
9. **A Karma spec asserting exact values off a module-global is order-fragile** —
   if a directive/service keeps state at module scope (e.g. `RevealDirective`'s
   stagger counter) and a spec asserts exact derived values, that spec MUST reset
   the global in `beforeEach` AND pin any environment preconditions it depends on
   (`window.matchMedia`, `getBoundingClientRect`, IntersectionObserver). Otherwise
   adding ANY new spec elsewhere shifts Karma's execution order and flakes it (a
   clean tree merely orders favorably by luck). Fix the SPEC's isolation, not the
   feature (root-cause-validator-findings). Reference: `reveal.directive.spec.ts`
   `resetRevealOrderForTest()` + pinned `matchMedia`/`getBoundingClientRect`
   (fire-v2.58 — 3 false failures surfaced when /create claim tests shifted order).

## E2E + Verification

- `playwright.config.ts` at the frontend root targets `https://projectsites.dev`
- `e2e/*.spec.ts` covers create-flow, sign-in, admin shell, snapshots, billing,
  command palette, focus trap, network status
- `e2e/journey-auth-admin.spec.ts` is the long-running stateful journey

## Related Docs

- `apps/project-sites/CLAUDE.md` — Worker API, services, prompt system
- `packages/shared/CLAUDE.md` — Zod schemas, RBAC, constants
- Root `CLAUDE.md` — Monorepo overview + cross-package conventions
