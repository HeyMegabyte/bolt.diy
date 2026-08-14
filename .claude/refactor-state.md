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
| worker test suite | CONVERGED | ✅ 670/670 suites green, 10,780 tests, 0 fail (iters 1-3). |
| sidebar / admin shell | AUDITING | Concurrent session LANDED it (`e3a0f8e3` "responsive navigation shell, 3 modes"). Now reviewable — verify 3-breakpoint UX + a11y + E2E, don't reflexively rewrite fresh work. |
| Angular admin | VERIFYING | Spartan/helm partial; ag-grid→TanStack migration pending (`docs/perf-wave-ag-grid-to-tanstack.md`). |
| frontend health | CONVERGED | ✅ iter 4: FE typecheck PASS + Karma **1592/1592** SUCCESS + `build:prod` SUCCEEDS. 2 non-failing build warnings tracked (below). |
| referral_loop feature | AUDITING | Removal candidate (credits unwired). Test red (below). |
| everything else | UNREVIEWED | rotate through per loop priority. |

## Failing tests (live)
None — worker suite 670/670 green (iter 3); frontend types + 1592 Karma units + prod build all green (iter 4).

## Non-failing build warnings (tracked, low priority)
1. `Unexpected "^"` CSS-syntax warning ×2 in `build:prod` (compiled `&:is(data-testid^="sf-card-")`). **Investigated exhaustively iter 4 — NOT a literal in any frontend source** (component styles, all `.scss`, all templates). It is a Tailwind v4 / lightningcss compilation artifact from a generated `:is()`-scoped rule. Cosmetic (one dropped rule), non-failing. Do NOT re-hunt in source; a fix would be Tailwind/lightningcss-config level.
2. `social.component.ts` inline styles 32.86 kB > 28 kB `anyComponentStyle` budget (+4.86 kB). Cold file (not in concurrent set). Real CSS-reduction target for a quiet iteration — trim redundant CSS from the 2349-line component (careful, risk of style breakage).

## Done this session (don't redo)
- Removed 26 off-vision/incomplete features (23 + nl_analytics/customer_portal/ai_payment_command). See `[[offvision-23-features-removed]]`.
- Grouped 13 member flags → 7 anchors, modules kept. See `[[flag-grouping-anchors]]`.
- **iter 1 (2026-08-14):** fixed a real PROD bug — 4 grouped members gated on removed `FLAG_KEY` **constants** (visitor_events_core→site_analytics, prod_readiness_score→site_doctor, platform_mcp+mcp_oauth_provider→mcp_server) → were dark; the group-flags codemod only re-pointed inline `isFlagOn` literals, not named constants. Fixed 6 test suites (visitor_events ×2, openapi /collab, wrangler DO-floor 6→5, flag_route_coherence stale list, features_routes public_api) + deleted orphaned inbox_send_channel.test.ts (service removed).

## iter 2 (2026-08-14)
Reconciled `feature_flags_docs` parity: removed 2 orphan docs (ai_concierge_widget, storefront_ecommerce = removed flags), authored 5 real docs entries (app_launcher, code_export, marketing_dashboard, social_publishing_native, visual_automation) with checklist+explanation+smoke_test. Test green (61), typecheck clean. Cron `ff940094` (every 20m) drives future iterations.

## iter 3 (2026-08-14)
Worker suite → GREEN. Fixed the last red (`referral_loop` "throws when DB fails"): the test mocked `.first()` but the impl reads via `.all()`+data[0] — so it never hit the throw path. Re-mocked `.all()` to set up no-existing-code → site-exists → empty re-read → throw. Test-only change (no deploy). tsc clean.

## iter 4 (2026-08-14)
FRONTEND health verified GREEN (types + 1592 Karma units + prod build). No code change — subsystem already healthy (prevent-oscillation). ⚠️ Tree was DIRTY (29 concurrent changes in flag/dossier/e2e areas) → stayed read-only + cold. Logged the 2 non-failing build warnings above so future iters don't re-hunt the elusive CSS one.

## Next target
When the tree is quieter (fewer concurrent changes): (a) `social.component.ts` CSS budget trim (−4.86 kB, cold, real CSS reduction), then (b) repo-wide **Knip** dead-code pass — BUT vet against built-ahead code (`[[knip-unused-not-always-dead]]`, `[[dead-code-scan-baseline]]`: partysocket/chatwoot_*/deepcrawl are INTENDED, keep). Also review the landed sidebar (`e3a0f8e3`) 3-breakpoint UX/a11y. If the tree is still dirty, pick a cold isolated file. Re-check constant-based FLAG_KEY drift after any concurrent flag change (registry.ts/docs.ts were being edited).
