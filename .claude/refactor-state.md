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

## iter 6 (2026-08-14) — dead-code deletion (clean cold worker win, SHIPPED)
OBSERVE: tree quiet, up-to-date with origin, both drift validators **PASS (0)**, worker green. Ran **knip** and VETTED every hit:
- `chatwoot_analytics`/`chatwoot_translate`/`deepcrawl`/`partysocket` = INTENDED built-ahead → KEEP (`[[dead-code-scan-baseline]]`).
- `redis_failover.ts` (imported by `routes/integration_health.ts`) + `social_queue_enqueuer.ts` (imported by `routes/social_posts.ts`) = knip **FALSE POSITIVES** → KEEP. Confirms `[[knip-unused-not-always-dead]]` — knip's "unused files" list is unreliable here; always grep the actual import before deleting.
- **`src/services/ai_payment_command.ts` = genuine dead code** → DELETED. Orphaned by THIS session's `ai_payment_command` flag+route removal: flag gone from registry.ts, no route mounts `/api/ai-actions/*`, all 9 exports have 0 external refs + 0 imports (triple-confirmed, not trusting knip). Also removed the 5 stale `/api/ai-actions/payment-*` API-doc rows in `apps/project-sites/CLAUDE.md` (doc drift left by the removal).
- VERIFIED: worker `tsc --noEmit` **exit 0 / 0 errors**, jest `referral_loop` **13/13** green, zero references to deleted symbols tree-wide. **No deploy** — an unimported file is tree-shaken out of the bundle → deployed artifact is byte-identical (provable no-op, like iter 3's test-only change).

## iter 7 (2026-08-14) — DRY social_publishers duplication (loop #12, SHIPPED)
OBSERVE: tree quiet, drift validators PASS (0), worker green. Dead-code axis CONVERGED (iter 6 got the one real dead file; remaining knip hits = built-ahead — e.g. `site_dna` has tests+service+migration, `chatwoot_*`/`deepcrawl` intended — OR false-positives). Per loop.md PRIORITIZATION, **#12 duplicated systems > #16 dead code**; jscpd surfaced the `social_publishers/*` cluster (clones up to 204 tokens).
- **DRY'd two identical pure methods** into shared consts in `types.ts`: `noopUploadMedia` (no-op `uploadMedia` — was copy-pasted across **13** publishers) + `getProfileFromContext` (context-reader `getProfile` — across **11**). The 5 real-API `getProfile(env,…)` (google_business/nextdoor/pinterest/tiktok/youtube) correctly kept their own impls.
- **−102 net lines** (76 ins / 178 del, 14 files). Delegated the mechanical bulk to `code-simplifier` (2 background turns → 9 files); I finished the last 4 (threads/twitter/google_business/nextdoor) + removed 1 orphaned comment (facebook).
- VERIFIED: worker `tsc --noEmit` **0 errors**; jest **13 suites / 94 tests pass** (behavior preserved); eslint **0 errors** (333 warnings all PRE-EXISTING perfectionist/sort — confirmed via stash-diff on original slack.ts=19); 0 orphaned comments, 0 unused imports. Deploy: worker (Docker up) — see turn report.

## iter 8 (2026-08-14) — DRY site_analytics handlers (loop #12, SHIPPED)
OBSERVE: tree quiet, drift 0, worker green. jscpd (excluding the iter-7 social_publishers) surfaced two #12 clusters: the cross-module `libs/features/*/handlers.ts` boilerplate (systemic, ~10 modules, higher-risk → deferred) and `site_analytics/handlers.ts` INTERNAL self-duplication (same preamble block repeated 6–7×, bounded, safe). SELECTED the bounded one.
- **Extracted 2 local helpers** in `site_analytics/handlers.ts`: `requireOwnedSite(c)` (flag-gate + `:siteId` resolve + org-ownership → 404; was inline in 7 handlers) + `parseWindowDays(c, param)` (integer 1–365 clamp, default 30; was inline in 5). The public share-token route + its distinct token logic untouched.
- **−18 net lines** (48 ins / 66 del). VERIFIED: worker `tsc --noEmit` **0 errors**; jest **9 suites / 38 tests pass** (incl. `site_analytics_handlers` + `site_analytics_window` — directly exercise the two helpers → behavior preserved); no unused imports; eslint N/A (libs/ outside the src-scoped config). Deployed worker (Docker up) — see turn report.

## iter 9 (2026-08-14) — token_burn_meter admin: DRY to canonical sysadmin + auth-inconsistency FIX + coverage (SHIPPED)
OBSERVE: tree quiet, drift 0, worker green. Investigating the cross-module handler dup, found `token_burn_meter/handlers.ts` was the ONLY module hardcoding an admin email: its local `isPlatformAdmin` allowed **`brian@megabyte.space` ONLY**, duplicating + DIVERGING from canonical `src/services/sysadmin.ts` `isSuperAdmin` (allowlist {brian@, **hey@**}, also honors the `is_super_admin` column). So `hey@megabyte.space` (a legit sysadmin) was WRONGLY 404'd on `/api/admin/usage/budget` — an auth-inconsistency bug (loop **#3**) on a route that was ALSO untested (**#10**) + duplicated (**#12**). Triple-priority hit.
- **TDD**: wrote `__tests__/admin_budget_route.test.ts` (5 cases: 401 unauth / 404 flag-off / 404 non-admin / 200 brian@ / 200 hey@). Ran → `hey@` was **RED (404)**. Applied fix → **GREEN**.
- **REFACTOR**: deleted local `PLATFORM_ADMIN_EMAIL` + `isPlatformAdmin` + now-unused `dbQueryOne` import; route now calls `isSuperAdmin(c.env, userId)`. handlers.ts **−14 net lines**.
- VERIFIED: admin test **5/5**, all token_burn tests **3 suites / 32** green, worker `tsc` **0 errors**, 0 dangling refs to removed symbols. Deployed worker (real functional auth fix) — see turn report.

## iter 10 (2026-08-14) — DRY onboarding_copilot handler preamble (loop #12, SHIPPED)
OBSERVE: tree quiet, drift 0, worker green. Confirmed the 11-module `unauthorized`/`notFound` dup is **MESSAGE-DIVERGENT** (onboarding uses 'Resource not found.'/'Authentication required.'; token_burn uses 'Not found'/'Auth required') → a true cross-module consolidation would UNIFY messages = a behavior change needing per-module test-checking → correctly deferred to a batched fresh session. Did the safe bounded self-dup instead.
- **Extracted a local `gate(c)` helper** in `onboarding_copilot/handlers.ts`: the flag-gate (404) + orgId-resolve (401) preamble was inline+identical in BOTH handlers (checklist + dismiss). Kept the exact codes + messages → behavior-preserving.
- VERIFIED: worker `tsc` **0 errors**; onboarding_copilot **14/14 tests pass** (7 route + 7 service; assert error.CODE, unchanged); jscpd self-clones **1→0**; all imports used. ⚠️ Honest note: net **+7 lines** (the helper's JSDoc exceeds the 2-call-site savings) — a duplication-removal win, NOT a line reduction; modest (only 2 handlers). Deployed worker.

## iter 11 (2026-08-14) — DRY the org-owner unlimited whitelist into one shared helper (loop #12 + #3-adjacent, SHIPPED)
OBSERVE: tree quiet, drift 0, worker green. Ran the iter-9 DETECTOR idea (grep hardcoded sysadmin emails outside sysadmin.ts) → found the ≥3-instance pattern: `build_budget.ts` + `build_limits.ts` BOTH hardcode `owner?.email === 'brian@megabyte.space'` to grant unlimited AI budget / builds (build_budget's own comment: "Mirrors build_limits' whitelist"). Duplicated + hardcoded in 2 places.
- ⚠️ Unlike iter-9's read-only admin VIEW gate, this grants **FREE UNLIMITED COMPUTE** → broadening to the canonical super-admin set (adds hey@) is a COST/business decision (approval-tier), NOT auto-applied. Did the behavior-PRESERVING DRY (kept brian@-only) + flagged the hey@ decision in the helper's JSDoc.
- **Extracted `isUnlimitedOrgOwner(db, orgId)`** exported from build_limits.ts (the "primary"); build_budget imports it. Whitelist now SINGLE-SOURCE (2 hardcoded copies → 1). Unified to fail-closed `.catch(()=>null)` (build_limits gained it — safe: DB error denies unlimited).
- VERIFIED: worker `tsc` **0 errors**; jest **3 suites / 33 tests pass** (build_limits + build_budget + token_burn build_budget); hardcode **2→1**; no unused imports; no circular import (build_budget→build_limits one-way). Deployed worker.

## iter 12 (2026-08-14) — formalize the hardcoded-admin-email DETECTOR (audit-arc "Codify" step, SHIPPED)
OBSERVE: tree quiet, drift 0, worker green. Per `[[audit-arc-detector-finds-bugs]]` (bug class ≥3 instances → write a detector): iters 9+11 found+fixed 3 divergent hardcoded-admin-email checks (token_burn admin gate wrongly 404'd hey@; build_budget/build_limits duplicated the unlimited whitelist). Formalized the regression gate.
- **`scripts/check-hardcoded-admin-email.mjs`** — flags a sysadmin email (`brian@`/`hey@megabyte.space`) used as a CHECK operand (`=== `/`!== `/`==`/`.includes(`) OUTSIDE the 2 canonical homes (sysadmin.ts + build_limits.ts). Per validator-precision-discipline: does NOT flag manifest `owner:` fields, `mailto:`, prose, or `TEST_LOGIN_EMAIL =` assignments (regex requires a QUOTED email adjacent to a comparison operator). Escape hatch: `check-admin-email-ignore`.
- Exports `isHardcodedAdminCheck(line)` (CLI main-guarded so import is side-effect-free) + **8-case fixture test** (4 positive / 4 false-positive) wired into `test:scripts` (**16/16 green**).
- Wired: `package.json` `check:admin-email` → the `check` aggregator; `.github/workflows/feature-architecture.yml` CI gate (`--ci` exit 1). 0-finding-stable after iters 9+11 → ships as a BLOCKING gate (audit-arc short-path). Self-tested: catches a planted violation, clean on the real tree.
- VERIFIED: detector exit 0 clean; `npm run test:scripts` **16/16 pass**; package.json valid JSON. **NO deploy** — build-time CI gate, zero worker-bundle change.

## iter 13 (2026-08-14) — DRY the OAuth write-endpoint rate-limit preamble (loop #12, SHIPPED)
OBSERVE: tree quiet, drift 0, worker green. Re-assessed the deferred 11-module `unauthorized`/`notFound` consolidation: `notFound` is 100% message-identical across all 11 + `unauthorized` 10/11 identical (only referral_loop diverges: 'Authentication required'). BUT feature_guard's `envelope` adds a `request_id` field → replacing the modules' bare `{error:{code,message}}` with feature_guard CHANGES the response shape (adds request_id) → a real (IMPROVING) behavior change needing per-module test-checking → confirmed it's a batched fresh-session task, deferred. Did the bounded mcp_oauth win.
- **Extracted `oauthGate(c)`** in `mcp_oauth_provider/handlers.ts`: the flagGuard-404 + per-IP `OAUTH_RATELIMIT` (429) preamble was byte-identical in the 2 write endpoints (/oauth/register + /oauth/token — the jscpd 184-token clone). Returns `Response|null`. Behavior-preserving.
- VERIFIED: worker `tsc` **0 errors**; jest **2 suites / 48 tests pass** (oauth_provider + mcp_oauth_routes — register/token/rate-limit covered); jscpd handlers.ts clone **1→0**; all imports used. Deployed worker.

## iter 14 (2026-08-14) — verification checkpoint: #12 clean-wins CONVERGED, baseline healthy
OBSERVE: tree quiet, drift 0. Ran jscpd on `src/routes` + `src/services` for NEW clusters — the clean bounded #12 wins are **EXHAUSTED**: remaining clones are (a) **FALSE-POSITIVES** (`wallet.ts` [33-84] = distinct TYPE interfaces jscpd token-matched by similar field shapes; `build_validators` aggregator/`out.push` patterns — truncated ambiguous pairs), (b) **SENSITIVE/critical** files (`build_validators` build-gate, `voice_webhooks` — high-impact if broken, not worth deep-context risk), (c) the **batched 11-module** error-envelope consolidation (LOW value — experimental features + 2-line helpers; behavior-changing: feature_guard's envelope adds request_id → fresh-session batched task). Per loop.md:397 ("don't polish trivial code while critical paths unverified"), forcing more #12 is wrong.
- VERIFIED baseline HEALTHY after 8 convergence iterations (6-13) + concurrent-session activity: worker `tsc --noEmit` **0 errors**; broad jest **55 suites / 571 tests pass** (ALL feature modules + every service touched this session: build_budget/build_limits/token_burn/mcp_oauth/site_dna). No regression. No code shipped — verify-only is legitimate per the loop when clean wins are exhausted (`[[loop-arc-economics]]`: recognize saturation, don't force marginal DRYs).

## iter 15 (2026-08-14) — CLOSED the #12 axis: 11-module error-envelope consolidation → feature_guard (SHIPPED)
Executed the deferred batched consolidation (iter-14's last #12 item). De-risked FIRST: PROBED by converting `token_burn_meter` alone → tsc 0 + 32 tests pass, proving the request_id addition is transparent (tests assert `.status`/`.error.code`). Then scaled to all 11.
- **11 modules** (abuse_takedown, ai_gateway_guardrails, cmdk_ai_actions, credit_wallet_rollover, observability_gateway, payments_rail, prompt_studio, referral_loop, token_burn_meter, visitor_events_core, wireframe_planning) now import `unauthorized`/`notFound` from canonical `src/lib/feature_guard.ts` instead of local re-defs. Single-source error envelopes + request_id on all these error responses (observability). referral_loop's divergent 'Authentication required' unified to 'Auth required' (test-safe).
- Delegated the bulk to code-simplifier (converted 8, turn-limited); I finished the 3 remaining (referral_loop half-done + observability_gateway/visitor_events_core notFound-only) + FIXED the agent's abuse_takedown regression (it dropped `import type { Context }` that forbidden/badRequest/flagOn/isSuperAdmin still need).
- **−44 net lines** (11 files, 11 ins / 55 del — biggest reduction of the arc). VERIFIED: worker `tsc` **0 errors**; jest **514 feature-module tests + 49 src tests pass**; no unused imports; no local defs remain. Deployed worker.

## Next target
**#12 duplication is now FULLY CONVERGED** (6 single-file DRYs + the 11-module error-envelope consolidation + 1 detector gate, iters 7-15). Remaining/other bands, honestly ranked:
- ⚠️ **Brian decision**: hey@ unlimited? (1-line in the centralized `isUnlimitedOrgOwner`).
- **Batched (fresh session, ~3 agents)**: 11-module `unauthorized`/`notFound` → `feature_guard` (adds request_id; tests assert `.error.code` so mostly safe; LOW value — experimental features).
- **Careful-only**: `build_validators` / `voice_webhooks` clones (sensitive; extract only with a clear need + full test verification, ideally fresh context).
- **Bigger waves (fresh context)**: social.component split (Browserbase 6bp visual gate); ag-grid→TanStack (`docs/perf-wave-ag-grid-to-tanstack.md`).
- If a future iteration finds nothing safe+high-value: a baseline health check + honest report is legitimate — do NOT force marginal/risky DRYs. 5 detector gates now guard convergence classes (fitness, idor, unwired, dbinsert, admin-email); future ≥3-instance finds → add a `check-*.mjs` + fixture test + CI step.
