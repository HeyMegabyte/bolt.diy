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

## Scope decisions (Brian 2026-06-27) — almost nothing parks anymore
Full: `docs/decisions/voice-architecture.md` + memory `loop-scope-decisions-2026-06-27`.
1. **P1 revenue epics → BUILD AUTONOMOUSLY** (booking engine, growth agent, voice receptionist, AI-GEO/citation, per-visitor personalization). Loop makes its own design calls + builds end-to-end. These are now `[auto]`, NOT parked.
2. **Plan-gate (AN52) → loop PROPOSES + WIRES** a competitor-norm free/Pro split (basic free; goals/funnels/heatmaps/digests/AI-queries → Pro) as the default + surfaces it for one-click confirm. Reversible → doesn't block.
3. **Voice → IN SCOPE, fastest-possible.** ALL secrets present → fully autonomous. ONE stack (Brian refined 2026-06-27): **Deepgram Flux STT (flux-general-en, model-integrated end-of-turn → 200-600ms faster; Nova-3 fallback) → gpt-4o-mini → Piper TTS bundled on the Fly machine** (PCM→μ-law8k local spawn). `EAGER_EOT=1` opts into speculative-LLM. ElevenLabs REMOVED (Piper, per package-registry). Env fallbacks: `STT_PROVIDER=whisper`, `TTS_PROVIDER=openai`. Only Brian-touch: confirm the auto-provisioned Twilio number (~$1/mo, authorized). Plan: `docs/decisions/voice-architecture.md`.

## Done (this session)
- ✅ Analytics-performance arc: AN5 daily rollup cron + all 5 breakdown columns (paths/channel/device/country/type, full parity) + AN3 read-switch (`getTrafficSummaryFromRollup`, flag `analytics_rollup_read` ENABLED global/beta, equivalence verified pageviews-exact/uniques~2.4%).
- ✅ CI deploy-queue unblock (explicit `quansync` dep) — deploys flowing again.
- ✅ Clipboard flaky-suite root-cause + fix (`utils/clipboard.ts`).
- ✅ #32 Turnstile activation (widget+secret provisioned, gate flipped).
- ✅ ~14 lean frontend slices (AN55/40/42/9/10c/5d, S5b/5c, …).
- ✅ Ops: killed the runaway concurrent session (pid 2813); Stripe key confirmed on the worker.
- ✅ **Stale-ledger audit-and-tick (fire 2026-06-28):** verified-live + ticked 5 unchecked `[auto]` items already built+flag-enabled+deployed (ledger was lagging reality) — **#20** build cost+cap (`checkBuildLimit` gates all create paths + token_burn_meter), **#36** abuse_takedown (`/api/abuse/reports`→403 admin-gated, flag on), **#45** onboarding_copilot (`/api/onboarding/checklist`→200), **#48** "Built with" badge (served-site `ps-bar-brand` backlink LIVE on megabytespace.* + deploy_buttons API), **#49** marketing GEO (live homepage has FAQPage×2 + `data-quotable`). 125→120.
- ✅ **Voice ledger reconciliation (fire 2026-06-28b):** the entire V0/V-cluster described the SUPERSEDED `twilio-labs/call-gpt` → Fly.io approach (ADR-0011) + ElevenLabs — stale since the 2026-06-27 LiveKit Cloud pivot. Rewrote the foundation blockquote + V0a–V0g to LiveKit reality (call-gpt/Fly/ElevenLabs struck; `infra/voice-agent/` + `voice_agent_config`/`voice_transcript`/`voice_webhooks` recorded), marked V0a/c/d/e done-by-supersession, ticked **V0b** (per-number resolver, built+14 tests) + **V33** (in-call AI disclosure = disclosure-as-config #31/#35), added the 3 shipped LiveKit slices (metrics #42 / turn-presets #8 / caller-memory #14-15), fixed #92's stale "V1 ElevenLabs", and parked the single **🔑 Voice go-live (V0g)** blocker under NEEDS BRIAN. 120→119 `[auto]`. (Answers Brian: the LiveKit work now IS in the ledger; detail lives in `docs/voice-leadership-roadmap.md`.)

- ✅ **Fire 2026-06-28 #2 (build + audit, 120→118):** **#29 GDPR Art.17 cascade BUILT** — `visitor_dsar` delete now purges the subject's correlated anonymous `visitor_events` (hard-DELETE on `session_id IN (visitor_id,anon_id)` — that table has no PII col/`deleted_at`) in addition to soft-deleting identities, with a combined audit receipt; TDD +1 cascade test, 13/13 green, tsc 0 (worker → CI push). **AN6 ticked** — its exact route `GET /api/sites/:siteId/analytics` shipped as the canonical `site_analytics` module (flag enabled, verified live), superseding the planned `owner_analytics` flag name. NOTE for next fire: audit-and-tick is thinning — most remaining unchecked items are A-series (Apps `app_*`)/S-series (`snapshot_*`)/AN-series (`analytics_*`) slugs NOT in the enabled-flag set = genuinely unbuilt, need real building (not ticks). #21 container-DLQ is genuinely `[partial]` (retries + typed build.failed notify exist; a true failed-build DLQ capture does not) — real build, don't over-claim.

> **HIGH-YIELD LANE for coming fires — AUDIT-AND-TICK (verify-before-build pays):** prod has **~60 globally-enabled flags** (`flag_overrides` scope=`global`,scope_id=`*`), and MANY unchecked `[auto]` items map to modules that are already built + mounted + flag-on + deployed but were never ticked (the ledger lags the code). Per fire, cross-reference unchecked items against the enabled-flag set + `libs/features/*` mounts, **probe each candidate's REAL mounted route with `E2E_API_KEY`** (200/403/handler-domain-error = live; SPA soft-200 on a wrong path ≠ proof — check `src/index.ts` `app.route()` for the true prefix), and tick the genuinely-live ones with a one-line prod proof. Do NOT blanket-tick on "flag is on" alone (avoids [[feedback_convergence_overclaim]]) — one concrete prod probe per tick. This is the fastest path to GATE ledger-empty.

## In progress — the two campaigns the loop drives to convergence

### A. Flag enablement + E2E proof — IN-SCOPE flags only (Brian 2026-06-26)
**Scope = production-ready flags only.** A flag is in-scope when its feature is genuinely built + validated. The ~33 experimental `features.ts` handlers (unvalidated `as`-cast bodies, CLAUDE.md gotcha #10) STAY DARK — convert each per-feature (colocated Zod + unit test) BEFORE it ever enters scope. Never mass-enable the grab-bag.
Per fire: pick an in-scope not-yet-enabled flag whose code is live → enable it (global `flag_overrides` override via `wrangler d1 execute`, beta/100%) → write+run a Playwright PROD real-user-flow E2E (homepage→click-nav→assert→axe-clean→console-clean) → keep ON only if green, else fix+retest. **Money flows (Stripe charge/refund, wallet debit) use Stripe TEST mode; email/SMS use test recipients — zero real charges/sends.**
- [x] `analytics_rollup_read` — enabled (AN3). E2E pending.
- [x] `turnstile_build_gate` — enabled (#32) + funnel-verified.
- [x] `site_analytics` + `visitor_events_core` — confirmed enabled live (owner-analytics suite).
- [x] `better_auth` — **ENABLED + CUTOVER LIVE (2026-06-28)** (global override). magic-link `{"status":true}` 200, `get-session` JSON, authed API via the new middleware BA-session bridge, `/signin` serves the BA UI (CF Browser Rendering DOM proof). Schema `migrations/0580` (11 tables) on prod D1, 3 users backfilled. Closes ledger A20 + G2.
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

- **🔑 Voice go-live (V0g)** — the LiveKit voice receptionist is fully BUILT + unit-tested on `main` (per-site LiteLLM routing, disclosure-as-config, turn presets, caller-memory, transcript→Conversations, `voice_call_completed` metrics) but is **dark in prod** and cannot be verify-live-ticked until ONE human-gated action: **(1)** `lk agent deploy` the `infra/voice-agent/` agent (needs LiveKit Cloud browser auth — can't run headless), **(2)** set Worker secret `INTERNAL_BUILD_SECRET` (+ `LITELLM_BASE_URL`/`_API_KEY` once the LiteLLM proxy is up), **(3)** wire the Twilio Elastic SIP trunk → LiveKit SIP inbound trunk + dispatch rule, **(4)** dial the number for the live test. This single go-live lights every built-but-dark voice slice at once. The BUILD stays autonomous (2026-06-27 scope decision); only this deploy/verify step needs Brian.

## Loop health
- Cron `1878e26d` — 30-min paced (`:07`/`:37`), durable, worktree-isolated.
- **Three stops (whichever fires first):** (1) `loop-done-check.sh`=DONE → write `_LOOP_DONE` + `CronDelete` (live id via CronList); (2) no-progress streak (K=6 passes, no commit, only NEEDS-BRIAN left) → surface blockers + stop; (3) hard ceiling (300 passes) → stop unconditionally.
- **Completion is guaranteed** (see § Completion guarantee): unchecked-`[auto]` count strictly decreases each fire (ship OR reclassify) → reaches 0 in finite fires → DONE reachable; it cannot stall with `[auto]` work silently stuck.
- Self-re-arm: when within ~12h of the 7-day expiry AND not yet DONE, re-create the cron to extend.
- Worker deploys via CI push (Docker down locally); `wrangler d1 execute` for flag overrides (D1 MCP can disconnect); authed prod E2E via `E2E_API_KEY` (get-secret).

---

## SUPERVISED backlog (folded from `progress.md`, 2026-06-27 — NOT safe for an unattended cron)

These need a focused, attended session — surface, never auto-run mid-loop.

- **R1 — Perf-wave: ag-grid → TanStack (P1).** Both live admin grids import `ag-grid-community` at module top → ~782 KB EAGER (~205 KB over budget). Files: `frontend/src/app/pages/admin/sections/audit.component.ts` + `ai-logs.component.ts`. Pattern in prod: `createAngularTable` (api-tokens + content-freshness). Blueprint + dead-ends (`@defer`/single-importer do NOT work — only removing ag-grid does): `docs/perf-wave-ag-grid-to-tanstack.md`. All-or-nothing; both grids must migrate in one go (esbuild keeps ag-grid eager while either imports it). Done = both on TanStack, ag-grid removed, budget green, re-verified live (`E2E_API_KEY`).
- **P1b — Durable SSG/prerender of the marketing route.** `/` is still an empty CSR SPA for JS-crawler first-paint/LCP (the `<h1>` `<noscript>` stopgap is live, `7f2c63ae`). Fix = real SSG/prerender (`@angular/ssr`); none configured. Verify `curl / | grep -c '<h1'` == 1 in the prerendered shell + CWV (LCP). Architecture change — focused session + full CWV verify. (This + R1 are the two levers behind the homepage Lighthouse-66 / TBT-3010ms ceiling.)
- **R3 — Wire the prod E2E suite into CI.** `*.e2e.ts` (marketing + admin a11y/contrast/reflow) runs only manually. Add a post-deploy CI job running `npm run test:e2e:prod` with `PROD_URL` + the `E2E_API_KEY` GitHub secret (Brian's action). Detail: `frontend/CLAUDE.md` § "Two E2E suites + a CI wiring gap".

## Perfection backlog (folded from `_PERFECTION_BACKLOG.md`, 2026-06-27 — open 🔨 clusters)

The A–L zero-gap inventory; full fire-by-fire history is in git. Dim-I (CWV/a11y/SEO) is the
big one and is **CONVERGED for the in-repo marketing surface** (homepage + /developers /pricing
/blog: LCP/FCP ~0.4–0.8s, CLS 0.002, a11y 100, SEO 100 — gated by `ttfr.spec.ts` + `cwv-gate.yml`).
Remaining open clusters (autonomous-safe unless tagged ⚠):

- **A. Revenue funnel** — opportunity-score→preview auto-gen wiring; checkout→entitlement→generation hop tests; usage→retention surfacing. (⚠ live prod-E2E of the full funnel needs `E2E_TEST_PASSWORD` prod secret — Brian.)
- **C. Cost control** — `assertAiBudget()`/`assertModelAllowed()` middleware before every LLM/browser/Google/email call (#16, as a feature module); usage-ledger reserve→execute→reconcile path per op category; per-build cost accounting (#19).
- **D. Reliability** — client-UUID `Idempotency-Key` on EVERY mutating public endpoint (#26, audit api.ts); every Queue consumer declares DLQ + replay + tenant context.
- **E. Observability** — `trace_id + tenant_id + cost_category` on every handler/job/webhook (sweep + assert); Sentry breadcrumb + PostHog `featureSlug` on every feature path.
- **F. Feature-module completeness** — `npm run validate:features` green tree-wide (7-field manifest + flag + schemas + service + handlers + __tests__ + e2e/<slug>/ + README); reconcile untracked WIP (figma_import / generative_ui_stream / page_audio_summary).
- **G. E2E coverage** — every `e2e/FEATURES.md` feature has ≥1 homepage-start Playwright spec; golden-path funnel E2E.
- **H. Accessibility** — axe 0 @ 6 breakpoints across admin + generated-site templates (authed via `E2E_API_KEY`); manual SC sweep (2.4.11/2.5.7/2.5.8/3.2.6/3.3.7/3.3.8).
- **I. Performance (remaining)** — the gated levers only: R1 perf-wave + P1b SSG above (homepage interactivity TBT/TTI), and the **credit-gated generated-site template app-shell/SSG** (CSR-bound LCP ~4.6s; worker serve-transforms are structurally powerless past FCP — only a build-time bake fixes LCP). Template a11y source fixes already shipped (`role="img"` rating, h4→h3) — existing sites pick them up on rebuild.
- **J. Security** — CSP L3 strict-dynamic + nonce on admin (no raw token/cookie logging, Semgrep rule); Turnstile/Arcjet on claim/signup/public-form/expensive endpoints.
- **K/L. Docs + net-new features** — ADRs present + accurate (note the two-series collision, see `DECISIONS.md`); the §8 "30 brilliant features" set (#4 DLQ-repair UI, #17 site beacon→analytics, #18 owner live-events, #20 abandoned-build recovery, #28 kill-switch console, #29 synthetic provider test-buttons) — each a feature-module cluster, lower priority until A–K green.
- **⚠ Approval-gated (surface, never auto-execute):** §13 InngestContainer DO bind + signing key (watched one-way migration); OpenFGA store provisioning; `E2E_TEST_PASSWORD` + scoped `TINYBIRD_INGEST_TOKEN` prod secrets (Brian runs `wrangler secret put`).
- **⚠ Infra blockers found during the CWV arc:** root-monorepo CI is dead at `pnpm install --frozen-lockfile` (bolt.diy root added `jscpd`+`rollup-plugin-visualizer`, lockfile not regenerated → worker deploys are local-only until fixed via `pnpm install --lockfile-only` at root); template repo CI was fixed (`npm ci` lockfile regen, commit `b3f9b4b`) but its Cmd+K Playwright E2E (`getByRole('dialog')`) is a pre-existing functional bug for the template-maintenance session.
