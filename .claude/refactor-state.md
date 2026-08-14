# Convergence State — projectsites.dev

> Durable brain for the `.claude/loop.md` convergence loop. Convergence MAP, not a journal.
> Reload at the start of every iteration. Statuses: UNREVIEWED · AUDITING · REFACTORING · VERIFYING · CONVERGED · BLOCKED.

## Repo shape (authoritative)
- **Worker** (`apps/project-sites/src` + `libs/features/*`) — CF Workers + Hono + D1/R2/KV/DO. Jest (`.cjs`, `@swc/jest`). Run from `apps/project-sites` (NOT repo root → babel trap). `npm test` = 670 suites / ~10.7k tests.
- **Frontend** (`apps/project-sites/frontend`) — Angular 21 standalone, signals, Karma+Jasmine units, Playwright E2E. Spartan/helm partial. `npm run build:prod`, `npm run deploy:production` (R2).
- **Feature modules** `libs/features/<slug>/` — manifest (`feature.manifest.ts` OR `manifest.ts`) + flag. Gates: `validate-feature-drift.mjs` + `validate-feature-manifests.mjs` (both have `GROUPED_FLAG_KEYS` + `__core__` exemptions).
- **Flags**: `src/modules/feature_flags/registry.ts` (runtime SoT) mirrors `docs.ts`. 41 flags after grouping. Prod D1 `feature_flags` keys on `flag_name` (NOT `key`); overrides on `flag_key`.
- ⚠️ Deploy worker needs Docker + GLOBAL CF key (`get-secret CLOUDFLARE_API_KEY`, email `blzalewski@gmail.com`). Frontend = R2, no Docker. **ALWAYS pass `--config wrangler.toml`** — bare `wrangler deploy` misfires monorepo framework auto-detection ("multiple frameworks found: … apps/chrome-extension, apps/desktop, apps/mobile, packages/*") since the repo is a pnpm workspace. `npx wrangler deploy --env production --config wrangler.toml`.
- ⚠️ **Shared working tree, 7+ concurrent sessions + crons.** Stage EXPLICIT paths, never `git add -A` (grabs others' untracked files). `pull --rebase --autostash`.

## Subsystem status
| Subsystem | Status | Notes / next step |
|---|---|---|
| feature flags | CONVERGED | 54→41 grouped (7 anchors) + 26 removed. registry↔docs parity restored (iter 2). |
| worker test suite | VERIFYING | 8→1 failing suite (iters 1-2). Only referral_loop left (below). |
| sidebar / admin shell | BLOCKED | ⚠️ Concurrent session actively editing `admin.component.*`, `nav-icon`, `admin-navigation-responsive.e2e.ts`. DO NOT TOUCH until it lands. |
| Angular admin | UNREVIEWED | Spartan/helm partial; ag-grid→TanStack migration pending (bundle-budget doc `docs/perf-wave-ag-grid-to-tanstack.md`). |
| referral_loop feature | AUDITING | Removal candidate (credits unwired). Test red (below). |
| everything else | UNREVIEWED | rotate through per loop priority. |

## Failing tests (live)
1. `referral_loop.test.ts` — "throws when DB fails after insert" resolves. Impl now returns empty for no-site orgs (deliberate, see service.ts:25 comment); test's mock hits that path. Removal-candidate feature → fix test OR remove feature. NOT blindly change expectation. **LAST remaining red suite.**

## Done this session (don't redo)
- Removed 26 off-vision/incomplete features (23 + nl_analytics/customer_portal/ai_payment_command). See `[[offvision-23-features-removed]]`.
- Grouped 13 member flags → 7 anchors, modules kept. See `[[flag-grouping-anchors]]`.
- **iter 1 (2026-08-14):** fixed a real PROD bug — 4 grouped members gated on removed `FLAG_KEY` **constants** (visitor_events_core→site_analytics, prod_readiness_score→site_doctor, platform_mcp+mcp_oauth_provider→mcp_server) → were dark; the group-flags codemod only re-pointed inline `isFlagOn` literals, not named constants. Fixed 6 test suites (visitor_events ×2, openapi /collab, wrangler DO-floor 6→5, flag_route_coherence stale list, features_routes public_api) + deleted orphaned inbox_send_channel.test.ts (service removed).

## iter 2 (2026-08-14)
Reconciled `feature_flags_docs` parity: removed 2 orphan docs (ai_concierge_widget, storefront_ecommerce = removed flags), authored 5 real docs entries (app_launcher, code_export, marketing_dashboard, social_publishing_native, visual_automation) with checklist+explanation+smoke_test. Test green (61), typecheck clean. Cron `ff940094` (every 20m) drives future iterations.

## Next target
Resolve `referral_loop.test.ts` (fix the throw-path mock OR remove the feature — it's a removal candidate per the flag audit). Then rotate to the first UNREVIEWED subsystem that is NOT the blocked sidebar (candidates: Angular admin ag-grid→TanStack bundle-budget wave; dependency/Knip audit; API client). Re-check constant-based FLAG_KEY drift after any flag change.
