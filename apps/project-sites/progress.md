# progress.md — Supreme-Polish / Visual-Perfection Campaign (handoff)

> **Why this file exists:** the campaign below was requested from a context-SATURATED
> session. Heavyweight specialist sub-agents (visual-qa / a11y / perf / seo /
> completeness) fail to spawn here with **"Prompt is too long"** (`subagent_tokens: 0`)
> — proven twice, even with tight briefs; only a 4-word haiku probe spawned. Per
> `~/.claude/.../rules/parallel-subagent-economy.md` § Fresh context by default
> (saturation hard-stop), the correct move is: **checkpoint → run in a FRESH session.**
>
> **HOW TO RESUME:** open a new Claude Code session in this repo and say:
> *"Execute apps/project-sites/progress.md."* Clean context → the fan-out spawns fine.

## Current production state (verified live 2026-06-08, all deployed)
- **Feature-flag 401 fix** — live (super-admin mutations carry the bearer).
- **Share link feature** — worker live (version `7ad8c0a7`); D1 `0537` applied
  (`review_tokens.password_hash`/`password_salt` present); modal live in admin.
  Reviewer-side password gate UI NOT built yet (see Rec R2).
- **Automation Builder (#11)** — fully removed (frontend + worker), deployed;
  D1 `0538` applied (`automation_recipes` absent). Verified gone from live bundle.
- Flags 32, manifests 22, worker routes 59 — drift validators green.

## THE CAMPAIGN — run as a fresh-session parallel fan-out (tight briefs, small waves)
Spawn specialists in waves of 2-3 (NOT 5 at once — that overflowed). Each gets a
≤90-word self-contained brief, read-only, returns ≤150 words. Assignment table:

| Wave | Agent (type) | Scope | Deliverable |
|---|---|---|---|
| 1 | visual-qa (sonnet) | prod marketing `https://projectsites.dev` @ 375/768/1280/1920 | prioritized visual-perfection defects + fixes |
| 1 | completeness-checker (sonnet) | repo code-level: undone TODO/stub/dead-button/lying-UI/off-brand-hex/missing states | prioritized punch-list |
| 2 | accessibility-auditor (sonnet) | prod marketing + authed admin (seed `E2E_API_KEY`) @ 6bp, axe + WCAG 2.2 manual | violations + fixes |
| 2 | performance-profiler (sonnet) | prod marketing `/` + key admin routes — CWV/Lighthouse | LCP/CLS/INP + fixes |
| 3 | seo-auditor (haiku) | prod routes — title/meta/JSON-LD/OG/sitemap/robots/llms.txt | gaps |
| 3 | visual-qa (sonnet) | **authed admin** shell + top sections (dashboard/sites/feature-flags/settings/media/social) @ 6bp — seed `ps_session` from `E2E_API_KEY` | admin visual defects |

After each wave: fold the ≤150-word findings, implement every ≥7/10 "just-feels-right"
fix on disjoint files, `ng build` + Karma + worker Jest, deploy worker+frontend,
re-verify. Loop until the supreme-polish 100-ideas audit returns zero implementable items.
Auth seed for admin agents: `localStorage.ps_session = {token: E2E_API_KEY, identifier:'test@megabyte.space', createdAt: Date.now()}` (see `e2e/navbar-site-actions.e2e.ts`).

## Outstanding recommendations (implement all)
- **R1 — Perf-wave (P1, dedicated):** both live `ag-grid` admin grids →
  TanStack. `audit.component.ts` + `ai-logs.component.ts` import ag-grid at module
  top-level → ~782KB EAGER in initial bundle → 205KB over the 1.6MB budget. Blueprint:
  `apps/project-sites/docs/perf-wave-ag-grid-to-tanstack.md` (read it; dead-ends are
  documented — `@defer`/single-importer do NOT work, only removing ag-grid does).
  TanStack already in prod (`api-tokens` + `content-freshness` use `createAngularTable`).
- **R2 — Reviewer password-gate UI — ✅ DONE + DEPLOYED (83609dc4, 2026-06-08).**
  `ReviewComponent` (`/review/:id`) now reads `password_required` and shows an
  unlock form → `POST /api/review/:id/unlock` before revealing status/approve/reject
  (401→inline error, 429→rate-limit notice). +4 Karma tests; 1393 green; frontend
  deployed to R2; route serves 200 live. REMAINING for a fresh session: a live
  Playwright E2E of the full password flow (needs `approval_workflow` ON + a created
  protected link via authed admin).
- **R3 — Re-run prod gates:** after today's deploys, re-run `npm run test:e2e:prod`
  (marketing-a11y/responsive, admin-a11y/reflow, contact-form) with `E2E_API_KEY`;
  re-check Lighthouse on `/`. Wire the `*.e2e.ts` prod suite into CI (decision +
  the `E2E_API_KEY` GitHub secret — tracked in `frontend/CLAUDE.md`).
- **R4 — Optional schema tidy:** the `recipes`/automation D1 tables were never in
  prod (no-op); only relevant for local/dev cleanliness. Low priority.

## Verified findings this checkpoint (2026-06-08 prod smoke)
- ✅ Discovery files all 200: robots.txt, sitemap.xml, humans.txt, security.txt,
  llms.txt, site.webmanifest, favicon.ico. JSON-LD = 5 blocks. canonical + og:image present.
  title ~46 chars (ok; could grow toward 50-60). meta description 144 chars (in range).
- ◐ **P1 — homepage static `<h1>` — STOPGAP SHIPPED (7f2c63ae, 2026-06-08).** A
  `<noscript>` SEO/a11y fallback (real hero `<h1>` + description + links) now lives
  in `frontend/src/index.html`; deployed + verified live (`curl /` → exactly 1 real
  `<h1>`, status 200). This closes the immediate gate for no-JS/social crawlers.
  **DURABLE FIX still open:** real SSG/prerender of the marketing route (the SPA shell
  is still empty for JS-rendering crawlers' first paint / LCP) — fresh-session work.

## QUEUED (2026-06-08, from a saturated session — fresh-session work)

### ✅ DONE 2026-06-09 (deployed)
- **Q1 dashboard redesign** — SHIPPED (28fa5a35): hero+banner removed, live search
  (filter/highlight/match-count/no-match/`/`-focus/Esc), pinned + recently-opened
  rows, keyword pills, operator FF card, gorgeous 0.333s treatment. 1396 Karma + AOT.
- **Q2 batch A** — SHIPPED (4d0d4952, worker `8df0d0cc` live): removed
  **trust_center**, **section_marketplace**, **alias_inbox** (registry+routes+services+
  libs modules+tests+index mounts+docs). `/api/feature-flags` confirms gone live.
  4315 jest + drift errors=0.
- **`.ff-head-right` toolbar** — SHIPPED (d7c545be): mode switcher + Refresh +
  Emergency removed from the Feature Flags header.

### ⏳ Q2 batch B — REMAINING (1 of 3 left; contacts_core)
- ✅ **data_export** — DONE (c7beb3ca, worker `1d3f384b` live; confirmed gone).
- ✅ **seo_autopilot** — DONE (eb34ef4e, worker `3257a56f` live; confirmed gone from
  flags). Now a site-FEATURE: route gate reads the tenant `flag_overrides` toggle
  (`autopilotOn` helper) instead of isFlagOn; registry + stale libs manifest removed;
  kept feature.schemas.ts + the site-features catalog entry. Route tests SQL-keyed.
- ⚠️ **contacts_core** — LAST ONE. ⚠️ gates the LIVE `src/routes/forms.ts` +
  `services/big_bets.ts` + is in `flag_route_coherence.test.ts` LIVE_ROUTE_FLAGS +
  3 libs tests (`libs/features/contacts_core/__tests__/`). Rewire/remove the forms.ts
  + big_bets.ts call-sites FIRST (forms MUST still capture submissions — just without
  the contacts-dedup arm), then delete `libs/features/contacts_core/` + registry +
  index import/mount + the LIVE_ROUTE_FLAGS entry. Verify `forms_routes.test.ts` +
  `big_bets.test.ts` stay green. Note: `isFlagOn` returns false for unregistered keys,
  so any leftover `isFlagOn('contacts_core')` call becomes a silent no-op (safe-ish)
  but should be removed cleanly. The cron keeps firing this until done.
- **contacts_core** — ⚠️ gates the LIVE `src/routes/forms.ts` + `services/big_bets.ts`
  + in `flag_route_coherence.test.ts` LIVE_ROUTE_FLAGS. Rewire/remove those call-sites
  FIRST (forms must still work), then delete `libs/features/contacts_core/` + 3 libs
  tests + registry + index + `feature_guard_gating.test.ts` case. Verify forms_routes.test.
- **seo_autopilot** — NOT a deletion: remove from `feature_flags` REGISTRY only; KEEP
  `routes/seo_autopilot.ts` + service + the site-features catalog entry; flip its gate
  from `isFlagOn('seo_autopilot')` to the site-feature entitlement check so that turning
  it on in Features = fully automatic (no sub-toggles). Update `seo_autopilot.test.ts`.

### Q1 — Dashboard redesign (`pages/admin/sections/dashboard.component.ts`) [DONE — see above]
- Remove EVERYTHING above the "Build your site" group: the `<header class="hero">`
  block AND the `<section class="features-banner">` block (+ their CSS). The first
  visible thing becomes the "Build your site" content.
- BEFORE deleting features-banner: fold its 2 discovery links into the card groups so
  they're not lost — "Features" card already exists in the "Account & help" group;
  add a Feature Flags card gated by `isSysAdmin()` to a group (operator-only).
- Add a **search bar** at the new top that live-filters ALL section cards by
  label/desc + new per-card `keywords: string[]`; show match count + a "no matches"
  empty state w/ Clear; `/` focuses it, Esc clears; highlight matched text; when a
  query is active render a single flat result grid instead of the groups.
- Measurably improve + make gorgeous per [[gorgeous-by-default]]: keyword pills per
  card, 0.333s transitions, hover lift, focus-visible rings, staggered reveal,
  localStorage "Pinned"/favorites row + "recently opened" row (self-contained).
- Plus brainstorm + implement 14 best dashboard improvements (search is #1).
- Spec asserts to keep green: `dashboard.component.spec.ts` checks groups>0, cards
  have real routes+glyphs, no dup links, tips, site-count, Feature-Flags-card gated.

### Q2 — Remove 6 feature flags (each = cross-layer; do one at a time, gate-verify)
Per-flag removal recipe: delete `libs/features/<slug>/` module + `src/routes/<slug>.ts`
+ `src/services/<slug>*.ts`; remove the `app.route('/', <x>)` mount + import in
`src/index.ts`; remove the registry entry in `src/modules/feature_flags/registry.ts`;
remove from `src/routes/features.ts` catalog + `frontend` site-features catalog +
`app.routes.ts`; remove from `flag_route_coherence.test.ts` `LIVE_ROUTE_FLAGS`;
add a `DROP TABLE IF EXISTS` migration if it owns a table; run worker jest +
`npm run validate:features` (feature-drift) + frontend Karma; deploy.
- **trust_center** — full module + route + service exist → full removal.
- **section_marketplace** — remove module/routes/services (marketplace + submissions);
  the intent is "users see modules via template.projectsites.dev" instead. Also drop
  the `section_marketplace` branch in `components/states/flag-gate-notice.component.ts`.
- **data_export** — `libs/features/data_export/` + `src/lib/feature_guard.ts` ref.
- **contacts_core** — ⚠️ gates a LIVE path (`src/routes/forms.ts` + `services/big_bets.ts`
  reference it) — must rewire/remove those call-sites first or forms breaks.
- **alias_inbox** — ⚠️ MEMORY [[feedback_alias_modules_intentional]] says inbox/public-api/
  swarm-editor aliases are deprecated drift-SHIMS, "never delete". USER OVERRIDES: remove
  it. Canonical is `unified_inbox` — confirm nothing routes through `libs/features/inbox`
  before deleting; keep `unified_inbox` intact.
- **seo_autopilot** — NOT a deletion: remove from the `feature_flags` REGISTRY (so it's
  not a platform flag) but KEEP it as a Features (site-features) capability that, when
  ON, is "fully automatic" (assume autopilot — no sub-toggles). Keep `src/routes/seo_autopilot.ts`
  + service; flip the gate from `isFlagOn('seo_autopilot')` to the site-feature check.

## Known-clean (per prior convergence — do NOT re-churn)
Lying-UI catchError class, redundant-toast, dead class-bindings, error-card
standardization, premature-stat-during-load, icon-button a11y names, flag links,
17 admin routes console-clean. Mass `#00E5FF`→token conversion = explicitly
"not worth the churn" (`admin-brand-token-drift` memory). Brand is CYAN/black
(NOT orange). Don't rebuild admin-v2 (reverted; legacy /admin is live).

## Cost discipline for the fresh session
Orchestrator Opus; specialists Sonnet (`CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6`);
keep `CLAUDE_CODE_FORK_SUBAGENT` UNSET (fresh subagents); waves of 2-3, tight briefs,
≤150-word returns; build/deploy once per wave at fold-in. Per `parallel-subagent-economy.md`.
