# Finishing-loop progress — projectsites.dev

> Maintained by the finishing loop (cron `743d6f09`) each fire. Source of truth for
> "what's done / what's left" so completion is verifiable at a glance.
> Goal (Brian, 2026-06-26): **every `[auto]` ledger item shipped + every feature flag
> enabled and E2E-proven on prod**, approval-tier included (safe-by-default).

## Done (this session)
- ✅ Analytics-performance arc: AN5 daily rollup cron + all 5 breakdown columns (paths/channel/device/country/type, full parity) + AN3 read-switch (`getTrafficSummaryFromRollup`, flag `analytics_rollup_read` ENABLED global/beta, equivalence verified pageviews-exact/uniques~2.4%).
- ✅ CI deploy-queue unblock (explicit `quansync` dep) — deploys flowing again.
- ✅ Clipboard flaky-suite root-cause + fix (`utils/clipboard.ts`).
- ✅ #32 Turnstile activation (widget+secret provisioned, gate flipped).
- ✅ ~14 lean frontend slices (AN55/40/42/9/10c/5d, S5b/5c, …).
- ✅ Ops: killed the runaway concurrent session (pid 2813); Stripe key confirmed on the worker.

## In progress — the two campaigns the loop drives to convergence

### A. Flag enablement + E2E proof — IN-SCOPE flags only (Brian 2026-06-26)
**Scope = production-ready flags only.** A flag is in-scope when its feature is genuinely built + validated. The ~33 experimental `features.ts` handlers (unvalidated `as`-cast bodies, CLAUDE.md gotcha #10) STAY DARK — convert each per-feature (colocated Zod + unit test) BEFORE it ever enters scope. Never mass-enable the grab-bag.
Per fire: pick an in-scope not-yet-enabled flag whose code is live → enable it (global `flag_overrides` override via `wrangler d1 execute`, beta/100%) → write+run a Playwright PROD real-user-flow E2E (homepage→click-nav→assert→axe-clean→console-clean) → keep ON only if green, else fix+retest. **Money flows (Stripe charge/refund, wallet debit) use Stripe TEST mode; email/SMS use test recipients — zero real charges/sends.**
- [x] `analytics_rollup_read` — enabled (AN3). E2E pending.
- [x] `turnstile_build_gate` — enabled (#32) + funnel-verified.
- [x] `site_analytics` + `visitor_events_core` — confirmed enabled live (owner-analytics suite).
- [ ] remaining in-scope dark flags — enable + E2E each (see `src/modules/feature_flags/registry.ts`); skip the features.ts grab-bag.

### B. Remaining `[auto]` ledger items (`_LOOP_LEDGER.md`)
Lean frontend vein largely converged; remaining skew backend/approval-tier. Approval-tier (Stripe checkout/refund, wallet debit, outreach/digest email, owner data-delete, impersonation JWT) are APPROVED — build safe-by-default (flag-gated + idempotent + dry-run + audited), enable + E2E in test mode.

## DONE gate (terminal — Brian 2026-06-26) — `scripts/loop-done-check.sh`
The loop self-cancels the instant ALL THREE GATE boxes read `[x]` AND `loop-done-check.sh` prints `DONE` (it then writes the `_LOOP_DONE` sentinel). Human-held items surface as `### ⛔ NEEDS BRIAN` and do NOT block termination.
- [ ] GATE ledger-empty — zero unchecked `[auto]` items in `_LOOP_LEDGER.md`
- [ ] GATE flags-green — every in-scope flag enabled + prod-Playwright-proven
- [ ] GATE smoke-green — consolidated prod Playwright smoke suite GREEN over all enabled features (`cd frontend && npm run verify:production`)

## Loop health
- Cron `743d6f09` — 30-min paced (`:07`/`:37`), durable, worktree-isolated.
- **Three stops (whichever fires first):** (1) `loop-done-check.sh`=DONE → write `_LOOP_DONE` + `CronDelete 743d6f09`; (2) no-progress streak (K=6 passes, no commit, only NEEDS-BRIAN left) → surface blockers + stop; (3) hard ceiling (300 passes) → stop unconditionally.
- Self-re-arm: when within ~12h of the 7-day expiry AND not yet DONE, re-create the cron to extend.
- Uses `wrangler d1 execute` for flag overrides (D1 MCP can disconnect).
