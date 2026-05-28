# MASTER-AGENT-LOG.md

> Auditable history of the parallel sub-agent fan-out launched 2026-05-28.
> Source of truth = `TEST-PLAN.md`. This log = orchestrator's view of who is
> driving which slice and which branches need merging into `main`.

## Mission
Drive every unchecked checkbox in `TEST-PLAN.md` (~237 features) to wired
or green via 7 parallel specialist agents. Out of scope unchanged:
CSP L3 strict-dynamic, Security+ Trust headers, build validators.

## Hard rules
- NEVER modify, weaken, skip, .only/.skip, or delete a test/spec to make it
  pass. App code satisfies the spec as written.
- Respect `npm run lint` + `npx tsc --noEmit` cleanliness. Don't introduce
  new typecheck errors.
- If a feature is blocked (secret, vendor SLA, hardware): leave its box
  unchecked, write a one-line blocker note next to it in TEST-PLAN.md.
- Each sub-agent commits to its own worktree branch. Master folds branches
  to `main` after acceptance.

## Sub-agents

| # | ID | Slice | TEST-PLAN sections | Owned paths | Status |
|---|----|----|-----|-----|-----|
| 1 | bill-flows | $50/mo + add-ons + metering + rollback + Connect + wallet | BILL-01..BILL-17 | `frontend/src/app/pages/admin/sections/billing.component.ts`, `src/routes/billing_addons.ts` (new), TEST-PLAN BILL rows | spawned |
| 2 | flag-suite | Per-flag verify (103 flags × off=404, on=200, docs JSON) | FLAG-* (103 rows) | `e2e/flags/all-flags.spec.ts` (new), maybe `src/routes/features.ts` GET helper, TEST-PLAN FLAG rows | spawned |
| 3 | admin-specs | Smoke specs for every admin sub-route | ADMIN-01..ADMIN-35 | `e2e/admin/*.spec.ts` (new dir), minimal `data-testid` ADDS to existing admin section components | spawned |
| 4 | pub-home-auth | Marketing + create-wizard + auth flows | PUB-01..PUB-18, HOME-01..HOME-09, AUTH-01..AUTH-09 | `e2e/public/*.spec.ts`, `e2e/home/*.spec.ts`, `e2e/auth/*.spec.ts` (new dirs), light `data-testid` ADDS on homepage/signin/create | spawned |
| 5 | bigbet-hub-ide | Big-bets + features-hub + IDE/multi-agent/progressive | BIG-01..BIG-30, HUB-01..HUB-10, IDE-01..IDE-07 | `e2e/big-bets/*.spec.ts`, `e2e/hub/*.spec.ts`, `e2e/ide/*.spec.ts` (new), `data-testid` ADDS on features-hub.component.ts | spawned |
| 6 | misc-tabs | Site lifecycle + MCP + domain + voice + social + media + env + workflow + webhook + editor | SITE-*, MCP-*, DOMAIN-*, VOICE-*, SOCIAL-*, MEDIA-*, ENV-*, WORK-*, WEBHOOK-*, EDITOR-* | `e2e/{site-lifecycle,mcp,domain,voice,social,media,env,work,webhook,editor}/*.spec.ts` (new) | spawned |
| 7 | lint-cleanup | Fix 15 pre-existing typecheck errors so LINT-01..03 pass | LINT-01..LINT-03 | `src/modules/adapter_core/registry.ts`, `src/services/mcp_client.ts`, `src/types/env.ts` (alias env vars) | spawned |

## Branch fold log

### 2026-05-28T20:22Z — lint-cleanup ✓ landed on main
- Commit: `f42fff9 fix(types): kill 15 pre-existing typecheck errors on main`
- 15 → 0 typecheck errors
- 3 files: `registry.ts` (gate 12 dead adapter imports), `env.ts` (add Mailchimp OAuth aliases), `TEST-PLAN.md` (LINT-02/03 → wired)
- Worker + SPA `tsc --noEmit` both exit 0
- LINT-01..LINT-03 now wired

### 2026-05-28T20:27Z — flag-suite ✓ landed on main
- Commit: `1b04aeb test(flags): parametrized all-flags spec covering all 104 FLAG_REGISTRY keys`
- 1 spec (`e2e/flags/all-flags.spec.ts`, 280 lines) covers all 103 flag rows
- Compile-time `FLAG_REGISTRY` import = new flags auto-tested without spec edits
- `FLAG_PRIMARY_PATH` coverage assertion fails build if a new flag has no mapped endpoint
- 103 FLAG-* rows flipped to wired
- Note: agent flagged pre-existing TS errors in `billing_addons.ts` (bill-flows agent's in-flight work); will resolve when bill-flows commits

### 2026-05-28T20:30Z — misc-tabs ✓ landed on main
- Commit: `5fd157e test(e2e): wire SITE/MCP/DOMAIN/VOICE/SOCIAL/MEDIA/ENV/WORK/WEBHOOK/EDITOR spec suites`
- 38 rows wired across 10 new spec subdirs (`e2e/site-lifecycle`, `mcp`, `domain`, `voice`, `social`, `media`, `env`, `work`, `webhook`, `editor`)
- 3 blockers surfaced and noted inline in TEST-PLAN.md:
  - VOICE-01 — `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` → https://console.twilio.com/us1/account/keys-credentials/api-keys
  - VOICE-02 — same Twilio credentials
  - VOICE-03 — additionally needs `TWILIO_PHONE_NUMBER` → https://console.twilio.com/us1/develop/phone-numbers/manage/active

### 2026-05-28T20:36Z — bigbet-hub-ide ✓ landed on main
- Commit: `5451311 test(e2e): wire BIG-01..30 + HUB-01..10 + IDE-01..07 specs from RED to wired`
- 47 rows wired (30 BIG + 10 HUB + 7 IDE) across 3 new spec subdirs
- features-hub.component.ts gained data-testid attrs (tablist, per-tab, per-card, flag pill, Try button, result panel) — zero structural changes

### 2026-05-28T20:38Z — admin-specs ✓ landed on main
- Commit: `41b6d86 test(admin): wire ADMIN-01..31 smoke specs under e2e/admin/`
- 12 spec files under e2e/admin/ cover ADMIN-01..31
- 6 component data-testid root attrs added
- ADMIN-02 no-full-reload sentinel: `window._spaSessionId = Math.random()` survives nav
- Note: agent flagged `billing.component.ts` syntax error as forbidden — sitting in bill-flows agent's worktree pending its commit

## Blockers surfaced
(populated as agents discover them)

## Quota state
Opus 4.7 main; specialists = Sonnet 4.6 high; per [[opus-quota-fallback]]
fallback flag observed.
