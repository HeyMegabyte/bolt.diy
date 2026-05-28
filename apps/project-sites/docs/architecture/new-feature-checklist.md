# New Feature Checklist — projectsites.dev

> Phase 17 gate. Every new feature must clear every checkbox before it merges.
> Cross-links: [[feature-flags]] · [[e2e-tdd-organization]] · [[verification-loop]] · [[auto-meta-work]]

---

## Phase 0 — Naming + Planning

- [ ] **Slug chosen** — lowercase, snake_case, ≤ 32 chars (e.g. `voice_agent`, `site_dna`).
      Must be unique across `src/routes/*.ts` and `e2e/` directories.
- [ ] **Flag key registered** — slug + `_feature` suffix (or bare slug if it reads naturally).
      Added to the current feature-flag migration or a new `migrations/<NNNN>_<slug>_flag.sql`:
      ```sql
      INSERT OR IGNORE INTO feature_flags (id, key, enabled, rollout_percent, stage, description)
      VALUES (lower(hex(randomblob(16))), '<slug>_feature', 0, 0, 'experimental', 'One-line description.');
      ```
- [ ] **MANIFEST.md written** at `libs/features/<slug>/MANIFEST.md` with: what, why, owner email,
      flag key, status (experimental | beta | stable), and links to spec files.
- [ ] **D1 migration created** (`migrations/<NNNN>_<slug>.sql`) with all tables, indexes, and
      soft-delete `deleted_at` column. Run `npx wrangler d1 migrations apply DB --local` to verify.

---

## Phase 1 — Backend

- [ ] **Hono sub-app created** at `libs/features/<slug>/api/<slug>.ts`.
      Exports a named `const <slug>App = new Hono(...)`.
- [ ] **Flag guard first** — every route starts with `isFlagOn(...)` check; returns 404 (not 403)
      when off per [[feature-flags]].
- [ ] **Zod validators** on every request body via `@hono/zod-validator`. Schemas live in
      `libs/features/<slug>/types.ts`.
- [ ] **Types inferred from Zod** — no manual `interface` duplicating a Zod schema.
      `type MyInput = z.infer<typeof MyInputSchema>`.
- [ ] **Service layer** at `libs/features/<slug>/service/<slug>.service.ts` — all D1 queries
      go here, not inline in the route handler. Uses `dbQuery` / `dbInsert` / `dbUpdate`
      from `src/services/db.ts`.
- [ ] **Error envelope** — all errors returned as `{ error: { code, message, request_id } }`.
      Error codes added to the taxonomy in `packages/shared/src/utils/errors.ts`.
- [ ] **Rate limiting** applied at `src/index.ts` for any public or abuse-prone endpoint:
      ```ts
      app.use('/api/<slug>/*', rateLimitMiddleware({ maxRequests: 30, windowSeconds: 60 }));
      ```
- [ ] **Route mounted** in `src/index.ts`:
      ```ts
      import { <slug>App } from '../libs/features/<slug>/api/<slug>.js';
      app.route('/', <slug>App);
      ```
- [ ] **OpenAPI annotation** — `@hono/zod-openapi` decorators on every route so it appears
      in `/api/openapi.json` and the `/admin/docs` explorer.

---

## Phase 2 — Frontend

- [ ] **Angular component created** at `libs/features/<slug>/ui/<slug>.component.ts`.
      Standalone component, signals-first, zoneless-safe.
- [ ] **Flag gate in template** — `@if (flagOn()) { ... } @else { <app-flag-gate /> }`.
      `flagOn` computed from `useFeatureFlag('<slug>_feature')`.
- [ ] **Route registered** in `frontend/src/app/app.routes.ts` via `loadComponent` (lazy).
      Auth guard added if the route is user-scoped.
- [ ] **Navigation entry** — sidebar item or deep-link added in `admin.component.html`
      or the features hub `features-hub.component.ts`.
- [ ] **Admin nav label i18n** — key added to `assets/i18n/en.json` + `assets/i18n/es.json`.
- [ ] **`data-testid` attributes** on every interactive element, following the pattern
      `<slug>-<element>-<action>` (e.g. `voice-number-buy-button`).
- [ ] **Design tokens used** — no hard-coded hex colors; all colors via `--ps-bg`, `--ps-accent`,
      `--ps-ink`, etc. from `_polish.scss`.
- [ ] **`appReveal` on every section** and `<app-rolling-counter>` on every numeric stat
      per [[cinematic-ui-patterns]].

---

## Phase 3 — Data Contract

- [ ] **Zod schemas in `libs/features/<slug>/types.ts`** exported and used by both the Hono
      route and the Angular `ApiService` call (shared contract).
- [ ] **`packages/shared`** updated if the schema is needed by the shared package
      (billing types, site types, etc.).
- [ ] **No `any` types** — strict TypeScript. `unknown` at boundaries, narrowed immediately.

---

## Phase 4 — Unit Tests

- [ ] **Unit test file created** at `libs/features/<slug>/tests/<slug>.unit.test.ts`.
      Uses Jest (existing runner). Mocks D1, KV, R2 via `jest.fn()`.
- [ ] **Happy path tested** — at least one test per HTTP verb per route.
- [ ] **Error path tested** — 400 on bad input, 404 when flag off, 401 when unauthed.
- [ ] **Flag-off returns 404** — unit test explicitly asserts the 404 response when
      `isFlagOn` returns false.
- [ ] **Coverage** — `npm run test:coverage` in `apps/project-sites/` shows no uncovered
      branches in the new service file.

---

## Phase 5 — E2E Tests (TDD-RED first)

- [ ] **Spec file created TDD-RED** at `libs/features/<slug>/tests/<slug>.e2e.spec.ts`
      (mirrored to `apps/project-sites/e2e/<slug>/`).
      Written and confirmed failing BEFORE any implementation.
- [ ] **Starts at homepage** — `await page.goto('/')` then navigates to the feature
      via UI clicks. No direct `page.goto('/admin/voice')` after initial load.
- [ ] **Happy-path spec** — covers create / read / delete / update as applicable.
- [ ] **Adversarial spec** — covers: flag-off returns 404, missing auth returns 401,
      invalid input shows inline error, empty state shows empty-state UI.
- [ ] **6 breakpoints asserted** — 375, 390, 768, 1024, 1280, 1920.
- [ ] **axe-core clean** — `checkA11y(page)` assertion (requires `@axe-core/playwright`).
- [ ] **Zero console errors** — `page.on('console', ...)` filter for errors.
- [ ] **Zero 4xx/5xx** — `page.on('response', ...)` filter for failed network calls.
- [ ] **`e2e/FEATURES.md` updated** — new row added with `status: TDD-RED` initially,
      flipped to `GREEN` after implementation.
- [ ] **`e2e/COVERAGE.yml` updated** — mapping from feature name to spec file(s).

---

## Phase 6 — Sentry + Structured Logs

- [ ] **`addBreadcrumb` before every risky operation** in the service layer:
      ```ts
      addBreadcrumb(c, { category: 'voice', message: 'Purchasing number', level: 'info' });
      ```
- [ ] **`captureException` in every catch block** that handles unexpected errors.
- [ ] **Structured log line** on every route response:
      ```ts
      console.warn(JSON.stringify({ level: 'info', service: '<slug>', event: 'action_name', ...metadata }));
      ```
- [ ] **PostHog server event** on every state-changing action:
      ```ts
      await captureEvent(c.env, userId, '<slug>_action', { ...properties });
      ```
- [ ] **PostHog client event** in the Angular component on user interactions:
      ```ts
      this.telemetry.capture('<slug>_ui_action', { ... });
      ```

---

## Phase 7 — Documentation

- [ ] **`MANIFEST.md` updated** with implementation status, first-ship date, and known limitations.
- [ ] **`libs/features/<slug>/docs/README.md`** written — user-facing feature doc with:
      screenshots or a usage example, flag key, promotion criteria.
- [ ] **`apps/project-sites/CLAUDE.md`** updated — new route added to the API Surface table
      and new D1 tables added to the database section.
- [ ] **Changelog entry** — one-liner added to `frontend/src/assets/changelog.json` or the
      `/changelog` Angular page data source.
- [ ] **`e2e/_fortress-matrix.md` updated** if the feature is fortress-tier (6 criteria: complex
      state machine, billing-adjacent, auth-adjacent, multi-user race conditions, or flag-gated).

---

## Phase 8 — CI Gate

- [ ] **`npm test`** passes in `apps/project-sites/` (896 + new tests all GREEN).
- [ ] **`npm run typecheck`** passes (`npx tsc --noEmit`).
- [ ] **`npm run lint`** passes (ESLint + Prettier).
- [ ] **Playwright E2E** passes: `npx playwright test --config e2e/playwright.config.ts`
      targeting `PROD_URL=https://projectsites.dev`.
- [ ] **`npx wrangler deploy --env production`** succeeds.
- [ ] **Post-deploy smoke** — curl the new route on prod, assert 404 (flag off) or 200 (flag on).
      Record in Verification Log.

---

## Promotion Path (experimental → beta → stable)

| Stage | Criteria |
|---|---|
| `experimental` | All Phase 0-8 gates above green. Flag default: `enabled=0, rollout=0`. |
| `beta` | Code complete + all unit + E2E GREEN. No P1 incident in 7 days. axe-core clean. |
| `stable` | 2 weeks at beta. Lighthouse ≥ 95. Zero P1 in 14 days. Adversarial spec GREEN. |
| `killswitch` | Any P1 incident — set immediately via `/admin/feature-flags`. No redeploy needed. |

Promotion is a button in `/admin/feature-flags`. After 30+ days at `stable, 100%`, remove the
flag check from code (not the feature). Run a quarterly flag-cleanup migration.

---

## Quick Reference — Commands

```bash
# 1. Create migration
touch apps/project-sites/migrations/0<NEXT>_<slug>.sql

# 2. Apply locally
npx wrangler d1 migrations apply DB --local

# 3. Run unit tests
cd apps/project-sites && npm test

# 4. Run typecheck
npx tsc --noEmit -p apps/project-sites/tsconfig.json
npx tsc --noEmit -p apps/project-sites/frontend/tsconfig.app.json

# 5. Run E2E (local)
npx playwright test --config apps/project-sites/e2e/playwright.config.ts

# 6. Deploy
cd apps/project-sites && npx wrangler deploy --env production

# 7. Smoke prod
curl -s https://projectsites.dev/api/<slug>/ -H "Authorization: Bearer $TOKEN"
```
