# Functions (Code Endpoints on WfP) — Convergence Ledger

> Spec: `docs/decisions/0035-custom-code-endpoints-wfp.md` (ADR — every decision + rationale).
> This ledger is the **live acceptance-criteria checklist** the convergence loop drives to zero.
> Each AC ships TDD-first (failing test → implement → green) → typecheck → unit → build → **deploy
> (worker `wrangler deploy --env production`; frontend `build:prod` + `deploy:production`)** →
> **prod-verify the changed surface** → check the box + note the commit → conventional-commit + push.
> One coherent AC per pass. Never break the build. Do NOT touch files dirty in a concurrent session
> (currently `admin.component.html`, `referral-card.component.ts`) — the removal doesn't need them.

**Status:** 🟡 in progress · **Started:** 2026-08-28 · **Owner:** convergence loop

---

## STAGE 0 — Remove "AI Agents" (clean break)
- [x] **0.1 Frontend removal.** — done `fb522f12` (deployed + prod-verified: served `main-U4DJ5RQ3.js` matches, `/admin` 200, ai-endpoints chunk gone). Delete `sections/ai-endpoints.component.ts`(+spec); remove the `ai-endpoints` route in `app.routes.ts`; remove `nav-endpoints`+`act-add-endpoint` from `command-palette-actions.service.ts`(+ its spec test); remove `ai-endpoints` from `admin-section-labels.ts`, the `not-found.component.ts` hint, the `forms.component.ts` empty-state link, the `onboarding-checklist.component.ts` step, the ai-endpoints methods in `api.service.ts`, the label in `ai-budget-meter.component.ts`, and refs in `docs.component.ts` + `empty-state.component.spec.ts`. **KEEP** `ai-logs`/Traces — only strip its endpoint-navigation refs. Typecheck + `test:ci` + `build:prod` green.
- [x] **0.2 Backend removal.** — done `1c87f17c` (deployed worker v`c2a2e287`; prod-verified `/api/sites/:id/ai-endpoints` + public `/api/ai/:slug/:endpoint` → 404, kept `/api/sites/:id/ai-logs` → 200; 10821 tests + validate:features green). Note: `wfp_dispatch.ts` + `ai_endpoints_ide.test.ts` KEPT (WfP infra reused by Functions Stages 1-4); `token_burn_meter` flag KEPT (not ai-endpoints-specific, description de-referenced). Delete `libs/features/ai_endpoints/`; delete `src/routes/ai_endpoints_public.ts`; surgically remove ai-endpoints handlers from `src/routes/ai_admin.ts`, `libs/features/admin_ai/handlers.ts`, `src/lib/ai_admin_kit.ts`; remove the route mounts in `src/index.ts`; drop the flag(s) in `src/modules/feature_flags/registry.ts`; remove refs in `src/routes/docs.ts` + `src/routes/feature_e2e.ts`. `npm test` + `typecheck` + `validate:features` green.
- [ ] **0.3 D1 + infra drop.** New migration `DROP TABLE ai_endpoints` (prod audit 2026-08-27: 6 rows, ALL test data — `org-brian-001` + `e2e-test-org`; **zero real customers**). Delete the uploaded WfP script `ai-e2e-site-e2e-probe` from the dispatch namespace. Apply to prod D1 + verify the table is gone.
- [x] **0.4 Propagate the decision** — done: ROOT `CLAUDE.md` "Removed — never reintroduce" (worker `CLAUDE.md` had no ai-endpoints refs — the Removed list lives in ROOT), `DECISIONS.md` **ADR-0055** (references folder ADR-0035 by path, next free convergence number — 0035 there is OTel), frontend `CLAUDE.md` sections comment, `SCOPE.md` monumental-initiative #1 → Functions. to `DECISIONS.md`, `SCOPE.md`, `apps/project-sites/CLAUDE.md` (+ frontend CLAUDE.md): AI Agents removed → Functions on WfP; add to "Removed — never reintroduce" with the ADR link.

## STAGE 1 — `functions/` convention + bundler
- [ ] **1.1 File-based router + bundler.** Define the convention (`functions/api/*.ts` → `/api/*`; `onRequest`/`onRequestGet`/`onRequestPost`; `[id].ts` → `:id`) + an esbuild bundler that `npm install`s a `functions/package.json` and bundles the folder into ONE WfP router-Worker script. Unit tests for route resolution + method dispatch + dynamic params. JS/TS only.
- [ ] **1.2 Template scaffold.** Ship a commented `functions/api/hello.ts` + `functions/README.md` in `template.projectsites.dev` (name: "Functions").

## STAGE 2 — WfP deploy on Publish + preview slot
- [ ] **2.1 Entitlement.** Add `custom_endpoints` entitlement (unlocks on ANY paid plan) to the site-features/entitlements plane; server guard returns **404** (not 403) for `/api/*` dispatch when not entitled.
- [ ] **2.2 Deploy on Publish.** On publish, bundle `functions/` → upload to `env.USER_DISPATCH` as `site-<siteId>` (gated on `custom_endpoints`). Reserved-path collision (`/api/contact-form`, `/api/_ps/*`) → **publish error**. Bad build → **publish static, keep last-good functions live, surface the error**.
- [ ] **2.3 Preview slot `/api/test-publish`.** Deploy the current `functions/` to a **preview** script `site-<siteId>-preview` (separate from live) that the owner hits to test before a real Publish promotes it.

## STAGE 3 — Dispatch in `site_serving`
- [ ] **3.1 Reserved-path guard + dispatch.** In `site_serving`: for a child host (subdomain AND custom domains), if the path matches a reserved platform prefix (`/api/contact-form/*`, `/api/_ps/*` — enumerate + reserve the current platform set) → existing handler; else if `/api/*` + entitled + a deployed script exists → `env.USER_DISPATCH.get('site-<siteId>').fetch(request)`; else → R2 static / 404.

## STAGE 4 — Binding injection + runtime
- [ ] **4.1 Bindings.** Inject `env.AI` (Workers AI, **debits `ai_credits_balance`**, clear error when out), `env.DATA` (typed read-only helpers `forms.list({limit})` + `site()`, tenant-scoped), `env.KV` (per-site namespace), `env.R2` (per-site prefix), `env.SECRETS.<KEY>` (site+org env-vars, site wins).
- [ ] **4.2 Guardrails + helpers.** Optional auth helpers (`ctx.verifyOwnerSession()` + Turnstile-verify); default per-IP edge rate-limit + Turnstile opt-in; **~25 MB** body cap; limits **50 ms CPU/req · 50 subrequests · 100k req/day per site** → 429 past it.

## STAGE 5 — Versioning + observability
- [ ] **5.1 Snapshot versioning.** Snapshot capture includes `functions/`; snapshot restore re-deploys that snapshot's WfP script (front + back roll back together).
- [ ] **5.2 Observability.** User-endpoint invocations + errors flow into the Log Explorer / Traces (`/admin/logs`).

## STAGE 6 — Fast-follow (after v1 core ships)
- [ ] **6.1 Scheduled/cron handlers.** `functions/_scheduled.ts` with a cron expression (WfP per-script cron) — the most-powerful option, sequenced after the HTTP path is green.

---

## Convergence rules
- Pick the **lowest-numbered incomplete AC** whose dependencies are met. Stages 0→5 are ordered; 6 is last.
- Every AC: TDD-first · typecheck · unit · build · deploy · **prod-verify the real surface** · update this ledger (check box + `— done <commit>`) · commit + push. A toast/compile is not proof.
- **Safety gates (approval-required — pause + surface, don't auto-run):** the `DROP TABLE ai_endpoints` prod migration (destructive — pre-cleared as test-data-only, but confirm the count is still ≤6 test rows immediately before) and any WfP dispatch-namespace provisioning that needs CF account setup.
- When **all** ACs are checked: run a completeness + zero-recommendations pass; if genuinely done, mark **Status: ✅ complete** and report DONE. Do not manufacture further work.
- Log each pass in the `always.md` end-of-turn report format (journey/AC/change/verify/next + the ⚡ block).
