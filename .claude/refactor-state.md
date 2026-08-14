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
| frontend health | CONVERGED | ✅ `build:prod` SUCCEEDS (verified iter 5, 9.7s); initial bundle **243 kB transfer / 1.11 MB raw** — the ag-grid `initial` budget is RESOLVED (2026-08-07 `fe90fa69`, ag-grid moved to a lazy chunk). FE typecheck + Karma **1592/1592** green (iter 4). 2 non-failing build warnings remain (below) — both cosmetic, neither is the bundle budget. |
| referral_loop feature | AUDITING | Removal candidate (credits unwired). Test red (below). |
| everything else | UNREVIEWED | rotate through per loop priority. |

## Failing tests (live)
None — worker suite 670/670 green (iter 3); frontend types + 1592 Karma units + prod build all green (iter 4).

## Non-failing build warnings (tracked, low priority)
1. `Unexpected "^"` CSS-syntax warning ×2 in `build:prod` (compiled `&:is(data-testid^="sf-card-")`). **Investigated exhaustively iter 4 — NOT a literal in any frontend source** (component styles, all `.scss`, all templates). It is a Tailwind v4 / lightningcss compilation artifact from a generated `:is()`-scoped rule. Cosmetic (one dropped rule), non-failing. Do NOT re-hunt in source; a fix would be Tailwind/lightningcss-config level.
2. `social.component.ts` inline styles **32.86 kB > 28 kB** `anyComponentStyle` budget (+4.86 kB; verified iter-5 build). **iter 5 INVESTIGATED → NOT a safe deep-context trim; DO NOT blind-trim.** The real CSS block is lines **1064–1697 (~633 lines)** — the component is now **3267 lines** (grew from 2349). The CSS is dense + well-written: zero dead rules, zero duplicate selectors, zero comment bloat (line 1181 even documents already-removed classes). The only byte-lever is stripping `var(--ps-accent,#00e5ff)` token fallbacks (~2 kB max — insufficient for 4.86 kB) AND that's a visual-adjacent change to a **deep authed component** (`[[deep-admin-components-need-browserbase]]`) using `::ng-deep`/`innerHTML`-styled classes, so static dead-CSS detection is structurally unsafe. `frontend/CLAUDE.md`'s own guidance for THIS component: **"not a blind trim."** Resolution = the god-component **SPLIT** (a real wave needing a Browserbase visual gate at 6bp) — mirror the ag-grid→TanStack `perf-wave` precedent (documented tracked-warning + blueprint, never blind-trimmed). Leave as a tracked non-failing warning until a fresh-context iteration can split + visually verify.

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

## iter 5 (2026-08-14)
Verify+reclassify iteration (no code shipped — no safe deep-context slice existed). OBSERVE: tree quiet (only cron `scheduled_tasks.json`), worker suite 670/670 green. SELECTED the tracked social.component CSS-budget target → **INVESTIGATED it and proved it is NOT a safe cold trim** (read the real 633-line CSS block: dense, no dead/duplicate rules; only lever = ~2 kB token fallbacks, insufficient + visual-risky on a deep authed component). Verified the baseline is green (`build:prod` 9.7s, exit 0) and captured the exact figure (32.86 kB / +4.86 kB) + the healthy 243 kB initial bundle (ag-grid budget confirmed resolved). Reclassified the target above so no future iteration blind-trims it — resolution is the god-component split behind a Browserbase visual gate (fresh context). Also fixed the stale perf-budget bullet in `frontend/CLAUDE.md` (was 30.18 kB/2349 lines → 32.86 kB/3267 lines). This mirrors the ag-grid `perf-wave` handling: document + defer a wave-sized item rather than ship a risky trim.

## Next target
NOT the social.component CSS trim (reclassified iter 5 — needs a god-component split + Browserbase visual gate, a fresh-context wave; blueprint-style, not a cold iteration). Candidates, in order: (a) repo-wide **Knip** dead-code pass — BUT vet against built-ahead code (`[[knip-unused-not-always-dead]]`, `[[dead-code-scan-baseline]]`: partysocket/chatwoot_*/deepcrawl are INTENDED, keep); baseline says drift/manifest=0, so expect "mostly built-ahead, little safe to delete." (b) review the landed sidebar (`e3a0f8e3`) 3-breakpoint UX/a11y (was AUDITING). (c) a cold isolated worker-side improvement verifiable by the Jest suite (no visual gate needed — safest at depth). Re-check constant-based FLAG_KEY drift after any concurrent flag change (registry.ts/docs.ts). If a fresh session picks up: the social split is the highest-value tracked wave — read `social.component.ts` (3267 lines) + plan the extract-to-subcomponents split, then Browserbase-verify the `/admin/social` section as brian at 6bp.
