# Convergence State — projectsites.dev

> Durable brain for the `.claude/loop.md` convergence loop. Convergence MAP, not a journal.
> Reload at the start of every iteration. Statuses: UNREVIEWED · AUDITING · REFACTORING · VERIFYING · CONVERGED · BLOCKED.
> **Per-iteration detail lives in git history — the commits ARE the journal. This file is the MAP.** (Compressed iter 25; iters 1-24 folded into "Converged arcs" below.)

## Repo shape (authoritative)
- **Worker** (`apps/project-sites/src` + `libs/features/*`) — CF Workers + Hono + D1/R2/KV/DO. Jest (`.cjs`, `@swc/jest`). Run from `apps/project-sites` (NOT repo root → babel trap). `npm test` ≈ 670 suites / ~10.7k tests.
- **Frontend** (`apps/project-sites/frontend`) — Angular 21 standalone, signals, Karma+Jasmine units, Playwright E2E. Spartan/helm partial. `npm run build:prod`, `npm run deploy:production` (R2).
- **Feature modules** `libs/features/<slug>/` — manifest (`feature.manifest.ts` OR `manifest.ts`) + flag. Gates: `validate-feature-drift.mjs` + `validate-feature-manifests.mjs` (both have `GROUPED_FLAG_KEYS` + `__core__` exemptions).
- **Flags**: `src/modules/feature_flags/registry.ts` (runtime SoT) mirrors `docs.ts`. Prod D1 `feature_flags` keys on `flag_name` (NOT `key`); overrides on `flag_key`. After a flag change, re-check for constant-based `FLAG_KEY` drift.
- ⚠️ Deploy worker needs Docker + GLOBAL CF key (`get-secret CLOUDFLARE_API_KEY`, email `blzalewski@gmail.com`). Frontend = R2, no Docker. **ALWAYS pass `--config wrangler.toml`** — bare `wrangler deploy` misfires monorepo framework auto-detection (pnpm workspace). `npx wrangler deploy --env production --config wrangler.toml`.
- ⚠️ **Shared working tree, 7+ concurrent sessions + crons.** Stage EXPLICIT paths, never `git add -A`. `pull --rebase --autostash`. Concurrent sessions periodically prettier-reformat my just-shipped files (clean fast-forwards). Sidebar/admin-shell BLOCKED (concurrent session owns `admin.component.*` + `nav-icon` + `admin-navigation-responsive.e2e.ts`).

## Subsystem status
| Subsystem | Status | Notes |
|---|---|---|
| feature flags | CONVERGED | 54→41 grouped (7 anchors) + 26 removed; registry↔docs parity (iter 2). |
| worker test suite | CONVERGED | 670/670 suites green (iters 1-3). |
| data access (`db.ts`) | CONVERGED | dbInsert + dbUpdate SYMMETRIC (both learn-and-retry the timestamp fallback). iter 17 data-loss fix. |
| team/ownership (`team_seats.ts` + ai_admin transfer) | CONVERGED | atomic transfer (18) + soft-delete-scoped owner gate (23). |
| domains/hostnames (`domains.ts`) | CONVERGED | atomic `setSolePrimary` swap (19). Site-serving host resolution filters deleted_at (verified 24). |
| site branches (`site_branches.ts`) | CONVERGED | atomic cross-table `mergeBranch` (20). |
| account deletion (`api.ts DELETE /api/admin/account`) | CONVERGED | atomic 3-table soft-delete batch (21). |
| soft-delete filters (authz) | CONVERGED | 2 membership authz bugs fixed (23-24); sessions/site-serving/subscriptions verified clean. |
| billing/entitlements | CONVERGED | `getOrgEntitlements` requires paid+active+`deleted_at IS NULL` (verified 25); subs never soft-deleted → status-based lifecycle correct. |
| voice conversations (FE↔worker) | CONVERGED | iter 26 added the MISSING `GET /api/voice/conversations/:id` — FE detail fetch 404'd → transcript NEVER showed (list omits transcript). Worker returns mapped `{data: Conversation}` incl. parsed transcript. FE unchanged. 4/4. |
| dead code (`knip`) | CONVERGED | knip hits = only known built-ahead (chatwoot_*/deepcrawl/partysocket) + false-positives (redis_failover/social_queue_enqueuer have real importers). Verified 6+25. |
| billing/wallet (`wallet.ts`) | AUDITING | debit path CORRECT (atomic). SURFACED (approval-tier): `creditWallet` double-credit — see SURFACED below. |
| sidebar / admin shell | BLOCKED | Concurrent session owns it (per loop prompt). Do NOT touch. |
| Angular admin | VERIFYING | Spartan/helm partial; ag-grid→TanStack pending (`docs/perf-wave-ag-grid-to-tanstack.md`). |
| frontend health | CONVERGED | `build:prod` green (9.7s); 243 kB initial bundle; Karma 1592/1592 (iter 4). 2 tracked warnings below. |
| referral_loop feature | AUDITING | Removal candidate (credits unwired). Test GREEN (iter 3). |
| everything else | UNREVIEWED | rotate per loop priority. |

## Converged arcs (don't re-audit without NEW evidence — full detail in `git log`)
- **#12 duplication** (iters 6-16): 1 real dead file deleted + 6 single-file DRYs + 11-module error-envelope→`feature_guard` consolidation. **6 detector gates** now guard convergence classes: fitness, idor, unwired, dbinsert, admin-email, local-error-helpers (`scripts/check-*.mjs` + fixtures + CI `feature-architecture.yml`).
- **Atomicity vein** (iters 17-22): 5 LIVE bugs — all "multi-step D1 mutation that should be atomic but wasn't + swallowed the `{error}`", each fixed with `db.batch([...])` (implicit txn, rejects+rolls-back). db.ts dbUpdate timestamp-fallback (data loss) · team_seats transferOwnership (ownerless org) · domains setSolePrimary (primary-less site) · site_branches mergeBranch (half-merged) · api.ts account-delete (half-deleted acct, sessions kept). Vein verified exhausted (22: remaining consecutive-mutation sites are non-bugs).
- **Soft-delete filters** (iters 23-24): 2 LIVE membership authz bugs (transfer gate + impersonation org-scope missing `deleted_at IS NULL`). Only 2 genuine instances (<3) → no detector (high false-positive risk given legit admin/recovery/serving views).
- **Verified-CLEAN surfaces (do NOT re-hunt):** auth `getSession` (expiry+revocation), webhook dedup (`UNIQUE(provider,event_id)`), site-serving host resolution, subscription→entitlement gate, dead-code (knip).
- **FE↔worker contract** (iter 26, ONGOING): a FE call to a NON-existent worker route (or a response-key mismatch) silently shows empty. Found+fixed the missing `/api/voice/conversations/:id` (transcript detail). ⚠️ The unwired-endpoint gate did NOT catch it (matched the FE dynamic path to the list-route prefix). Sibling precedent: `/api/voice/meta-prompt` (was 404 → stale FE fallback). Class: audit FE `.get`/`.post` paths vs real worker routes (esp. `:id` detail routes the list route omits).

## Lessons (hard-won)
- **`db.batch([stmt,stmt])`** is THE atomic-multi-write pattern (implicit txn, rejects+rolls-back on any failure). Convention ref: `credits.ts`. Test it by giving the D1 mock a capturing `prepare`+`batch` jest.fn (+ `mockRejectedValueOnce` for the atomicity/rollback assertion).
- When a source change alters a function's D1 access pattern (e.g. dbUpdate→batch), grep **ALL** `*.test.ts` calling it + update every mock; verify each **STANDALONE** — co-scheduled `--runInBand` runs mask which suite actually fails (iter-19 regression misdiagnosed as a "flake", caught iter 22).

## ⚠️ SURFACED — Brian decisions (approval-tier, NOT auto-fixed)
- **Wallet credit double-spend** (iter 18): `creditWallet` (`wallet.ts:445`) idempotency TOCTOU — `wallet_transactions.stripe_event_id` is a plain INDEX, **not UNIQUE** (`0036_wallet_billing.sql:80`) → concurrent Stripe webhook replay double-credits. Fix (needs approval + prod migration): `UNIQUE(stripe_event_id) WHERE … NOT NULL` + insert-first/`INSERT OR IGNORE`-guarded credit + read-back post-UPDATE balance for the ledger snapshot.
- **hey@ unlimited?** (iter 11): 1-line in `isUnlimitedOrgOwner` (build_limits.ts) — grants FREE UNLIMITED COMPUTE, a cost decision.
- **site_benchmarks schema** (iter 17, low): lacks `updated_at`+`deleted_at`. Runtime self-healing retry already fixes the data-loss bug; a migration is cosmetic convention-alignment (prod-apply to BOTH D1s).

## Non-failing frontend build warnings (tracked, do NOT re-hunt)
1. `Unexpected "^"` CSS warning ×2 in `build:prod` — a Tailwind v4 / lightningcss compilation artifact (NOT a source literal; exhaustively verified iter 4). Cosmetic, non-failing. Fix would be Tailwind/lightningcss-config level.
2. `social.component.ts` inline styles **32.86 kB > 28 kB** budget. iter-5 proved NOT a safe cold trim (dense CSS, no dead rules; deep authed component). Resolution = god-component SPLIT behind a Browserbase 6bp visual gate (fresh context) — mirror the ag-grid→TanStack perf-wave precedent. Do NOT blind-trim.

## Next target
**FE↔worker contract axis OPENED (iter 26)** — priority #1 user-facing, a productive new vein (1 real bug found). Continue it:
- **Sweep more FE-call-vs-worker-route mismatches**: grep FE `api.get/post/put(...)` paths + `r.data`/`r.items` reads, cross-check each resolves to a real worker route returning that key. Prioritize `:id` DETAIL routes (the list route often omits fields → detail fetch is where the gap hides) + the other unwired-gate FAILs (onboarding checklist/dismiss, site-mcp tokens/tools — verify if genuinely missing or path-normalization false-positives).
- **NOTE**: the check-unwired-endpoints gate has false-negatives on FE dynamic paths that prefix-match a list route (missed voice/conversations/:id) — a detector-precision improvement candidate if the class recurs.
- **Bigger waves (fresh context + Browserbase visual gate):** social.component split; ag-grid→TanStack.
- **Careful-only:** `build_validators` / `voice_webhooks` jscpd clones (sensitive; extract only with full test verification).
- If nothing safe+high-value surfaces: an honest verification checkpoint is legitimate — do NOT force marginal/risky changes. Future ≥3-instance bug classes → add a `check-*.mjs` detector + fixture + CI step.
