# Finishing-loop progress — projectsites.dev

> Maintained by the finishing loop (cron `1878e26d`) each fire. Source of truth for
> "what's done / what's left" so completion is verifiable at a glance.
> Goal (Brian, 2026-06-26): **every `[auto]` ledger item shipped + every feature flag
> enabled and E2E-proven on prod**, approval-tier included (safe-by-default).

## Completion guarantee — how the loop is GUARANTEED to reach DONE (Brian 2026-06-26)

The DONE gate (`scripts/loop-done-check.sh`) goes green only when **0 unchecked `[auto]` items remain** (+ flags-green + smoke-green). To make that count provably reach zero, every `[auto]` item must end each fire closer to one of TWO terminal states — never stuck:

1. **DONE** — built + deployed (worker via **CI push**, Workers Builds has Docker; frontend via R2) + verified live (authed prod E2E with `E2E_API_KEY` from get-secret; money/email in TEST mode). Tick `[x]`.
2. **PARKED** — if the item genuinely needs a NEW human decision the loop cannot make (product/UX design, pricing, brand, a real-world fact, an irreversible one-way-door call), the loop **strips its `[auto]` tag and moves it to `## ⛔ NEEDS BRIAN`** below, with the ONE decision required. This is itself a commit = progress, and it removes the item from the gate.

Because every fire either ships an `[auto]` item OR reclassifies a blocked one, the unchecked-`[auto]` count **strictly decreases** → it reaches 0 in finite fires → the gate becomes reachable. Approval-tier items (Stripe/refund/wallet/outreach) are **PRE-APPROVED** — they are DONE-able (safe-by-default + test-mode), NOT parked. Only genuine design/real-world decisions get parked. When `[auto]`=0, the loop self-cancels and `## ⛔ NEEDS BRIAN` is the clean handoff of everything that truly needed a human.

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
Lean frontend vein converged; unit-coverage lane draining fast (~370 tests this session). Remaining skew backend/approval-tier + focused-single-thread (copy, per-flag `as`-cast retrofits — do these foreground when parallel doesn't fit). Approval-tier (Stripe checkout/refund, wallet debit, outreach/digest email, owner data-delete, impersonation JWT) are APPROVED — build safe-by-default (flag-gated + idempotent + dry-run + audited), enable + E2E in test mode. **Worker features ship via CI push (not local wrangler — Docker is down locally; Workers Builds deploys).** Per the Completion guarantee above: any `[auto]` item found to need a genuine human decision → strip `[auto]` + move to `## ⛔ NEEDS BRIAN`.

## DONE gate (terminal — Brian 2026-06-26) — `scripts/loop-done-check.sh`
The loop self-cancels the instant ALL THREE GATE boxes read `[x]` AND `loop-done-check.sh` prints `DONE` (it then writes the `_LOOP_DONE` sentinel). Human-held items surface as `### ⛔ NEEDS BRIAN` and do NOT block termination.
- [ ] GATE ledger-empty — zero unchecked `[auto]` items in `_LOOP_LEDGER.md`
- [ ] GATE flags-green — every in-scope flag enabled + prod-Playwright-proven
- [ ] GATE smoke-green — consolidated prod Playwright smoke suite GREEN over all enabled features (`cd frontend && npm run verify:production`)

## ⛔ NEEDS BRIAN (parked — does NOT block DONE; the loop's clean handoff)

> The loop moves any `[auto]` item it cannot finish autonomously here, stripping `[auto]`,
> with the ONE decision required. Empty for now — the loop populates it as it drains the ledger.
> When the loop self-cancels, THIS is the complete list of what genuinely needed a human.

- _(none yet — autonomous work still draining)_

## Loop health
- Cron `1878e26d` — 30-min paced (`:07`/`:37`), durable, worktree-isolated.
- **Three stops (whichever fires first):** (1) `loop-done-check.sh`=DONE → write `_LOOP_DONE` + `CronDelete` (live id via CronList); (2) no-progress streak (K=6 passes, no commit, only NEEDS-BRIAN left) → surface blockers + stop; (3) hard ceiling (300 passes) → stop unconditionally.
- **Completion is guaranteed** (see § Completion guarantee): unchecked-`[auto]` count strictly decreases each fire (ship OR reclassify) → reaches 0 in finite fires → DONE reachable; it cannot stall with `[auto]` work silently stuck.
- Self-re-arm: when within ~12h of the 7-day expiry AND not yet DONE, re-create the cron to extend.
- Worker deploys via CI push (Docker down locally); `wrangler d1 execute` for flag overrides (D1 MCP can disconnect); authed prod E2E via `E2E_API_KEY` (get-secret).
