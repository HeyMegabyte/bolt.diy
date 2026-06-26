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

### A. Flag enablement + E2E proof (66 flags total: 14 default-on, ~51 dark)
Per fire: pick a not-yet-enabled flag whose code is live → enable it (global `flag_overrides` override via `wrangler d1 execute`, beta/100%) → write+run a Playwright PROD real-user-flow E2E (homepage→click-nav→assert→axe-clean→console-clean) → keep ON only if green, else fix+retest. Money/email flows use Stripe TEST mode + test recipients — never real charges/sends.
- [x] `analytics_rollup_read` — enabled (AN3). E2E pending.
- [x] `turnstile_build_gate` — enabled (#32) + funnel-verified.
- [ ] remaining ~49 dark flags — enable + E2E each (see `src/modules/feature_flags/registry.ts`).

### B. Remaining `[auto]` ledger items (`_LOOP_LEDGER.md`)
Lean frontend vein largely converged; remaining skew backend/approval-tier. Approval-tier (Stripe checkout/refund, wallet debit, outreach/digest email, owner data-delete, impersonation JWT) are APPROVED — build safe-by-default (flag-gated + idempotent + dry-run + audited), enable + E2E in test mode.

## Loop health
- Cron `743d6f09` — 30-min paced (`:07`/`:37`), durable, worktree-isolated, self-terminating at convergence.
- Self-re-arm: when within ~12h of the 7-day expiry, re-create the cron to extend.
- Uses `wrangler d1 execute` for flag overrides (D1 MCP can disconnect).
