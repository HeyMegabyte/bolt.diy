# Ultimate Completion Prompt — projectsites.dev (ENTIRE PROJECT)

> The canonical guide for COMPLETING THE WHOLE PLATFORM — every feature module shipped
> AND every surface covered by E2E-TDD. Superset of `_ULTIMATE_CONVERGENCE.md` (which stays
> the admin-specifics reference). Each loop fire = ONE round walking the ladder top-down.
> The loop terminates ONLY at the Definition of Done (§6), fully + verifiably true — never on
> time, tokens, or "good enough". Complements `CLAUDE.md` + `CONVERGENCE.md` §6 honesty rules.

> **Locked scope decisions (2026-06-02, Brian):** (1) Scope = **whole platform**. (2) E2E = **TDD-first +
> local dev-server each round + full prod suite push-gated**. (3) Authorized capstone = **Workflow
> dispatcher ONLY** — seat-caps (#8 `maxSeats`) + bulk-republish (#17) stay DECISION-DEFERRED. (4)
> Done bar = **built + 100% unit+E2E green + flag promoted experimental→beta→stable + ENABLED +
> verified live on the prod URL** (except the 2 deferred capstones, which stay flag-dark with a note).

---

## 0. Hard resolved facts (never re-litigate — carried from `_ULTIMATE_CONVERGENCE.md` §0)
- **Brand = CYAN / BLACK** (`--ps-accent` #00E5FF on #060610). NOT orange (that was bricklabor.com contamination).
- **NEVER duplicate existing behavior.** Cross-check `FEATURE_CATALOG.md` + 50 `libs/features/*` + 155 flags + admin sections + snapshots BEFORE building. Extend/polish, never rebuild. (Backup/restore = SNAPSHOTS; team UI lives in `settings.component`; #4 extends `approval_workflow`/`review_tokens`; #8 extends team infra; flags surface via FLAG_REGISTRY not D1.)
- **git worktrees isolate** → commit to `main` always; only avoid racing concurrent R2 deploys.
- **Worker deploys are Docker-gated locally** → commit worker code, it ships on push → Workers Builds. **Frontend ships to R2** (no Docker) — but never deploy mid-swarm (overlap leaves 1-byte objects); commit + let the cycle deploy.
- **Honesty (CONVERGENCE.md §6):** verify before claiming; never fabricate; run the test before recording it green; a stopped-with-evidence round beats a fabricated one.
- **Queues are NOT enabled** → async work uses **Cloudflare Workflows** (the site-generation pattern), never CF Queues.
- **Manifest `description` ≤200 chars** (validator hard-fails). **Mock-D1 in Jest:** `dbQuery`/`dbQueryOne` → mock `.all()`→`{results}`; `dbExecute` → mock `.run()`→`{meta:{changes}}`. **ai_crypto `encrypt(env, s)`** round-trips in Jest with a real 32-byte `MCP_ENCRYPTION_KEY`.
- **Site-scoped sections load via `effect()` keyed on `selectedSite()` + a `loadedSiteId` guard** — NOT `ngOnInit`/constructor-once (empty-on-deep-link + stale-on-switch). See [[admin-section-add-recipe]].

---

## 1. The two pillars (both must reach 100%)

### Pillar A — Feature-module completeness (whole platform)
Every meaningful capability across EVERY surface is a complete feature module per `CLAUDE.md` PART 23: `libs/features/<slug>/manifest.ts` (7 fields) + flag in `registry.ts` + colocated Zod schemas + handlers + service + `__tests__/` + `e2e/<slug>/` + docs + Sentry/log `featureSlug` + lifecycle. No scattered handlers; no flag without a manifest; no manifest without tests. `npm run validate:features` = 0 drift.

### Pillar B — E2E-TDD total coverage
Every clickable element, route, form field, nav link, API endpoint, modal, keyboard shortcut, and error/empty/loading/success state has ≥1 Playwright E2E test that goes RED before implementation and GREEN after. Inventory in `e2e/FEATURES.md` + `e2e/COVERAGE.yml`; CI fails if any feature lacks a passing-test mapping. Per `CLAUDE.md` PART 10-11 + [[e2e-tdd-organization]] + [[e2e-visual-inspection]].

---

## 2. Scope inventory (the WHOLE platform — every surface gets Pillar A + B)
- **Admin SPA** (`/admin/*`) — the 6 Brian modules (#4/#8/#10/#11/#12/#17) + all existing sections (sites, snapshots, analytics, seo, social, voice, apps, mcp, docs, billing, audit, settings, feature-flags, editor, media, …). Cyan/black, site-reactive.
- **Marketing surface** (`/`, blog, changelog, status, privacy, terms, contact) — SSR/SSG, SEO/JSON-LD, a11y, CWV.
- **Public reviewer/utility pages** (`/review/:id`, accept-invite) — token-bearer, rate-limited.
- **AI-generated client sites** — the build pipeline + served sites (build_validators invariants, the 13 BUILD-BREAKING gates in `CLAUDE.md`).
- **bolt.diy editor** (`editor.projectsites.dev` iframe) — persistence, cross-origin, WebContainer boot.
- **Worker API** (`apps/project-sites/src`) — every `/api/*` route: auth, Zod boundary, `assertSiteOwned`, error envelope, idempotency.

---

## 3. Priority ladder — top tier to exhaustion, then descend (per round, pick the highest unmet + reachable + safe)
### P0 — Correctness & security
1. Cross-tenant/ownership leaks (`assertSiteOwned`, 404-not-403). 2. Dead controls / silent failures (wire or graceful coming-soon). 3. Console/CSP/Trusted-Types errors; SPA-only nav (no full reload); **site-scoped sections must `effect()`-load** (sweep: webhooks/recipes/mcp/forms/pseo DONE; verify analytics/social/voice). 4. SSRF on any outbound fetch (`isSafeWebhookUrl`). 5. Rate-limit every public mutation. 6. Zod at every boundary; secrets encrypted at rest.
### P1 — Revenue & core (finish the modules)
7. **The 6 modules to LIVE** (see §5). 8. The AUTHORIZED capstone — **Workflow dispatcher** (§4). 9. CRUD reliability everywhere (real validation + 4-state + safe refresh + useful errors). 10. Highest-ROI client-site revenue modules per `_extra-feature-modules-50.md` §B.
### P2 — Cohesion, a11y, performance
11. Cyan/black design-system cohesion (reusable state/empty/skeleton/error primitives; tokens not hex). 12. WCAG 2.2 AA (axe 0 violations at 6 breakpoints, keyboard, focus, contrast). 13. Perf/CWV (LCP≤2.5/CLS≤0.1/INP≤200; the **ag-grid→TanStack** bundle migration to close the 205 KB overage — a real wave per `frontend/CLAUDE.md`). 14. Responsive at 6 breakpoints.
### P3 — Last
15. Decorative motion beyond the functional set. 16. Secondary verticals / exotic integrations not yet requested.

---

## 4. The AUTHORIZED capstone — Workflow dispatcher (#10 + #11)
Build the shared event-dispatch orchestrator on **Cloudflare Workflows** (Queues are off). Every layer beneath it is built + tested (`planDeliveries`, `attemptDelivery`, `recordDelivery`, `shouldRetry`/`nextRetryDelayMs`, `recipeMatchesEvent`, `isSafeWebhookUrl`, encrypted secrets, the `webhook_deliveries` table).
- A platform event (`form.submitted`, `site.published`, `payment.succeeded`, …) → enqueue a Workflow instance with the event.
- Workflow step: load the site's enabled endpoints (#10) + recipes (#11) → `planDeliveries` / `recipeMatchesEvent` → per delivery: decrypt secret → `hmacSha256(signatureBase)` → `attemptDelivery` (re-check `isSafeWebhookUrl`) → `recordDelivery`. On `shouldRetry`, `step.sleep(nextRetryDelayMs)` then retry (Workflows give durable retry — no inline CPU burn).
- TDD: a Workflow-step unit test (mock the step env) for the per-event fan-out + a prod E2E that creates an endpoint, fires a real event, and asserts a `webhook_deliveries` row + the deliveries panel shows it.
- **DEFERRED (do NOT build — decision-gated):** #8 seat-cap enforcement (needs per-plan `maxSeats` values) + #17 bulk-republish executor ($-cost of N container builds). Leave both flag-appropriate with the note; surface in Recs.

---

## 5. The 6 modules → DONE = built + 100% unit+E2E + promoted LIVE + verified on prod
For each: finish any gap → write/confirm Pillar-B E2E coverage (homepage-first, real prod URL) → promote `experimental→beta→stable` via `/admin/feature-flags` + ENABLE + verify the live surface renders + works at 6 breakpoints.
- **#12 email_deliverability_wizard** — full-stack + `/admin/deliverability` UI. Add E2E; promote live.
- **#17 bulk_site_ops** — preview→confirm→apply UI. E2E the archive/set_flag flow; promote live. (republish executor stays deferred.)
- **#4 review_approval_links** — end-to-end (state machine + routes + `/review/:id` page + rate-limit). E2E the reviewer loop; promote live. Add an admin create-link surface.
- **#8 team_seats_rbac** — invite/remove/transfer-ownership live. E2E those; promote. (seat-cap enforcement stays deferred pending `maxSeats`.)
- **#10 outbound_webhooks** — CRUD + UI + deliveries panel; the Workflow dispatcher (§4) makes it fire. E2E subscribe→event→delivery; promote live.
- **#11 automation_builder** — CRUD + `/admin/recipes` UI; dispatcher (§4) fires actions. E2E create-recipe→event→action; promote live.

---

## 6. Definition of Done (anti-false-convergence) — ALL verifiably true
- Pillar A: every platform surface's capabilities are complete feature modules; `npm run validate:features` = 0 drift; no dead controls / fake-data / silent failures.
- Pillar B: `e2e/FEATURES.md` + `COVERAGE.yml` cover every feature; `npm run e2e:prod` (or the local TDD suite + push-gated prod run) GREEN at 6 breakpoints × 3 browsers; axe 0 violations; console/CSP/network clean; every fixed bug has a regression spec.
- The 6 modules promoted `stable` + ENABLED + verified rendering+working on the live prod URL (except the 2 deferred capstones, flag-dark with a documented reason).
- The Workflow dispatcher live: a real event produces a signed delivery + a `webhook_deliveries` row + a fired automation.
- Zero TODOs in shipped strings / console errors / CSP-TT violations / full-page reloads / untested critical flows. WCAG 2.2 AA clean; perf budgets met (incl. ag-grid→TanStack overage closed); SPA-only nav.
- Marketing + generated-site gates: all 13 `build_validators` BUILD-BREAKING invariants pass; Lighthouse A11y ≥95 / Perf ≥75.

---

## 7. Per-round protocol (TDD-FIRST — ship, don't just report)
1. **Inspect** the highest-priority unmet surface; read `MEMORY.md` + this file + `_ULTIMATE_CONVERGENCE.md` + `_extra-feature-modules-50.md` + `FEATURE_CATALOG.md`.
2. **De-dup check** (mandatory): catalog/modules/flags/snapshots/sections. Extend, never rebuild.
3. **Test FIRST** — write the failing Playwright spec (homepage-first, 6bp, `data-testid`/role selectors, no sleeps, hermetic) + Vitest/Jest unit; run LOCALLY (dev server `scripts/e2e_server.cjs` for frontend; Jest for worker) and watch it RED.
4. **Implement** the smallest correct slice (bottom-up for worker modules: pure core+units → routes+flag+manifest+mount).
5. **Verify** — unit GREEN, local E2E GREEN, `tsc --noEmit`, `npm run validate:features:quick`, build. The full PROD E2E suite (`npm run test:e2e:prod` + `E2E_API_KEY`) runs on push/deploy.
6. **Commit to `main`** (additive/new files preferred; worker ships on push; frontend on the deploy cycle, never mid-swarm).
7. **Promote when a module is complete+green** — flip its flag stage + enable + verify live (the done-bar step).
8. **Summarize** + fold new dedup hazards/lessons into this file + `_ULTIMATE_CONVERGENCE.md` + `MEMORY.md`. At least ONE visible cyan/black UX gain per round unless the round is exclusively a P0 fix or test-coverage.

---

## 8. Coverage inventory + the 50-test-per-area blueprint
Maintain `e2e/FEATURES.md` (row per feature: name · owning dir · spec count · last-pass commit) + `e2e/COVERAGE.yml` (feature→spec map; CI fails on `specs: 0`). Per new area, generate ≥50 homepage-first, parallel-safe, deterministic Playwright tests across Groups A-E (shell/nav/baseline · auth · core domain · deploy/integrations · AI/edge) per `CLAUDE.md` PART 11. Random-snapshot sampling + new-section AI-vision on first render per [[e2e-visual-inspection]].

## 9. Self-improvement + termination
After each round: "what is the single highest-impact unmet Done-bar item?" — do that next. Re-audit finished surfaces against the live site + competitors; a surface that no longer beats best-in-class re-enters the queue. Terminate ONLY when §6 is fully, verifiably true.

---

## 10. The loopable prompt (paste into /loop)
> Run ONE projectsites.dev COMPLETION round following `apps/project-sites/_ULTIMATE_COMPLETION.md` (read it first — canonical). Two pillars: (A) finish every feature module across the WHOLE platform; (B) E2E-TDD total coverage. Walk the ladder top-down (P0 correctness/security → P1 modules+Workflow-dispatcher → P2 cohesion/a11y/perf → P3). Brand = CYAN/BLACK. AUTHORIZED capstone = the Workflow dispatcher (#10/#11); seat-caps (#8 maxSeats) + bulk-republish (#17) stay DEFERRED. NEVER duplicate existing behavior (cross-check FEATURE_CATALOG.md + 50 libs/features + 155 flags + snapshots/sections). Per round: inspect → de-dup → **write the failing Playwright/unit test FIRST (homepage-first, 6bp, local dev-server RED→GREEN)** → implement smallest correct slice → verify (unit+local-E2E green + tsc + validate:features:quick + build) → commit to main (worker ships on push, frontend on deploy cycle; full prod E2E push-gated with E2E_API_KEY) → **promote a completed module's flag to stable + enable + verify live** → summarize. Honesty per CONVERGENCE.md §6: verify before claiming, never fabricate; ship a real slice, not a blocker report. Fold new dedup hazards/lessons into _ULTIMATE_COMPLETION.md + MEMORY.md.

---

## Reference incident (***2026-06-02 — ENTIRE-PROJECT completion prompt***)
Brian: *"create the ultimate convergence prompt about completing the ENTIRE PROJECT (feature modules + E2E TDD testing)."* Decisions: whole platform · TDD-first+local+push-gated prod E2E · authorize Workflow dispatcher only (seat-caps + republish deferred) · done = built+tested+promoted-live. This doc is the superset; `_ULTIMATE_CONVERGENCE.md` stays the admin-specifics reference.
