# Full-Flow E2E Coverage — projectsites.dev

Living map for the **finish-everything + prove-it** loop (cron `a9127245`). Each row
is a SURFACE; the target is the number of **elaborate, realistic full-flow** tests
that surface needs. A full-flow test = a specific multi-step USER JOURNEY:

> `seedSession → gotoAdmin → navigate by UI → act → assert UI → assert ground-truth
> via apiFetch → snap (visual)`.

NOT element-presence. Files: `*.flow.e2e.ts` (run under `playwright.prod.config.ts`).
Harness: `_flow-helpers.ts`. Auth: Pathway C (`E2E_API_KEY`, e2e-test-org owner — not
super-admin). Screenshots → `e2e/screenshots/flows/`.

**Target: 500+ full-flow tests.** Update the Done column + the total each fire.

Run all: `E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test --config=playwright.prod.config.ts *.flow`

---

## Coverage map

| # | Surface | File | Target | Done | Status |
|---|---------|------|-------:|-----:|--------|
| 1 | Auth + session + admin-shell nav | `flows-auth-admin.flow.e2e.ts` | 20 | 20 | ✅ green (prod) |
| 2 | Site create (search→signin→details→build→waiting) | `flows-site-create.flow.e2e.ts` | 22 | 0 | ⬜ todo |
| 3 | Sites list + detail (filter/sort/branches/snapshots/reset/delete) | `flows-sites.flow.e2e.ts` | 26 | 19 | 🟡 3 fixme (row selector) |
| 4 | Settings (general/AI-chat/MCP/env-vars/domains/api-tokens/deliverability) | `flows-settings.flow.e2e.ts` | 30 | 21 | 🟡 1 fixme (parallel contention) |
| 5 | Billing (checkout/portal/subscription/entitlements/upgrade) | `flows-billing.flow.e2e.ts` | 20 | 0 | ⬜ deferred (agent saturated → deleted) |
| 6 | Media library (upload/stock/generate/send-to-bolt/delete) | `flows-media.flow.e2e.ts` | 24 | 17 | 🟡 1 fixme (upload selector) |
| 7 | Domains (search/purchase/hostname/primary/delete) | `flows-domains.flow.e2e.ts` | 20 | 0 | ⬜ todo |
| 8 | Analytics (overview/tabs/live/funnel/events) | `flows-analytics.flow.e2e.ts` | 30 | 16 | 🟡 6 fixme (see fire log) |
| 9 | SEO toolkit + local-SEO | `flows-seo.flow.e2e.ts` | 16 | 0 | ⬜ todo |
| 10 | Forms + form-analytics + leads | `flows-forms.flow.e2e.ts` | 20 | 0 | ⬜ todo |
| 11 | Feature-flags admin (list/filter/toggle/rollout/stage/override) | `flows-feature-flags.flow.e2e.ts` | 18 | 0 | ⬜ todo |
| 12 | Social / Pulse (connect/compose/schedule/best-time/best-posts) | `flows-social.flow.e2e.ts` | 24 | 0 | ⬜ todo |
| 13 | Voice agent | `flows-voice.flow.e2e.ts` | 10 | 0 | ⬜ todo |
| 14 | MCP (connect/paste-key/oauth/per-tenant) | `flows-mcp.flow.e2e.ts` | 20 | 0 | ⬜ todo |
| 15 | Editor (bolt iframe boot + generate + publish) | `flows-editor.flow.e2e.ts` | 12 | 0 | ⬜ todo |
| 16 | Apps (catalog/detail/instances/launcher) | `flows-apps.flow.e2e.ts` | 20 | 0 | ⬜ todo |
| 17 | Docs + audit log + AI endpoints/logs | `flows-observability.flow.e2e.ts` | 18 | 0 | ⬜ todo |
| 18 | Dashboard hub (getting-started/widgets/chat) | `flows-dashboard.flow.e2e.ts` | 16 | 0 | ⬜ todo |
| 19 | `libs/features/*` dark-launch modules (flag-off 404 + flag-on flow) | `flows-features-{a..d}.flow.e2e.ts` | 90 | 0 | ⬜ todo |
| 20 | Marketing (home/blog/changelog/status/privacy/terms/contact) | `flows-marketing.flow.e2e.ts` | 24 | 24 | ✅ green (prod) |
| 21 | Error/empty/loading states + 404 recovery | `flows-states.flow.e2e.ts` | 26 | 0 | ⬜ todo |
| 22 | Notifications / task-tray / command-palette / network-status | `flows-shell-widgets.flow.e2e.ts` | 16 | 0 | ⬜ todo |
| — | **TOTAL** | | **520** | **117** | 🟡 117 green + 11 fixme |

Legend: ⬜ todo · 🟡 in progress · ✅ complete (Done ≥ Target, all green on prod).

---

## Finish-the-feature backlog (partial code → complete, then flow-test)

Discovered from the 88 `libs/features/*` modules + admin sections. As each is finished
(flag wired end-to-end + sample-data seed + UI reachable), move its flow to the map above.

- Surveyed 2026-08-13: 88 `libs/features/*` modules exist; `audit-feature-flags` reports
  **69 IMPROVE** = "wired via manifest, no `isFlagOn` reader" — i.e. the module has a
  manifest + handlers but the route/UI isn't gated/reachable yet. Those are the primary
  finish-the-feature targets (gate the route + surface the UI + seed sample data).
- Order by user value: onboarding_copilot, activity_feed, batch_operations, cmd_k_actions,
  local_seo_suite, marketing_dashboard, customer_portal, referral_loop, then the rest.

---

## Fire log

- **Fire 1 (2026-08-13)** — Backbone (`_flow-helpers.ts` harness + this map) + 3 elaborate
  flow files, **60 tests GREEN on live prod**:
  - `flows-auth-admin.flow.e2e.ts` — 20/20 (session persist, stale-token, unauth bounce,
    shell boot, navigate EVERY section by UI, active-state, aria-live, deep-link, 404
    recovery, back/forward, Cmd+K open+focus+results, keyboard nav, /api/auth/me+/api/sites+
    /api/inbox/tasks ground-truth, dashboard hub, cross-section console hygiene). Authored
    directly; hardened with `reducedMotion:'reduce'` (kills the View-Transition click-flake).
  - `flows-marketing.flow.e2e.ts` — 24/24 (home/blog/changelog/privacy/terms/developers,
    SPA nav, SEO H1+canonical+title, 375px reflow, 404 recovery). Agent `abf584f1`.
  - `flows-analytics.flow.e2e.ts` — 16 green + **6 `.fixme` (tracked RED)**. Agent `a95e008d`.
  - Harness fix: `isRealError` treats `status of 404` as benign (flag-gated reads 404 by
    design, per `admin-nav-links.e2e.ts`).
  - **RED findings to resolve next fire** (all `.fixme` in `flows-analytics`): 03 network-
    overview reconcile (unconfirmed kpi-*/net-* selectors + possible lying-empty vs D1
    `visitor_events`), 07 live-events wrong-source (`analytics_events` vs `visitor_events`),
    09 funnel-tab mount, 10 sections-tab flag-dark graceful state, 15 `?tab=` URL sync,
    21 8-tab tour (confirm real tab set + genuine console error on a tab).
  - **Deferred to next fire** (agents did NOT deliver): `flows-settings.flow.e2e.ts`
    (agent `a6890ee1` context-saturated → 3-line stub) + `flows-sites.flow.e2e.ts`
    (agent `a0f0e362` explored but never wrote the file). Both are high-value built surfaces
    — re-author with tighter, write-first briefs (or directly).
  - Running total: **60 / 500+ green** (+6 fixme tracked).
- **Fire 2 (2026-08-13)** — 4 background agents authored settings/sites/billing/media
  with lean write-first briefs (read only the 2 e2e reference files, NO component source —
  the fire-1 saturation lesson). **Ground-truth cheatsheet for the e2e-test-org bearer**
  (probed via curl, use when folding + fixing reconcile assertions):
  - `/api/auth/me` → 200 `{user_id:e2e-test-user, org_id:e2e-test-org, is_super_admin:false}`.
  - `/api/sites` → 200 HAS data (`e2e-site-3` slug `urban-fitness` "Urban Fitness Co"; phone/
    email/address null) → sites reconcile asserts REAL rows; settings general-save reconcile
    starts from null fields.
  - `/api/billing/subscription` → 200 `data:null`; `/api/billing/entitlements` → 200
    `{plan:free, analyticsEnabled:FALSE, maxCustomDomains:0, chatEnabled:true, maxTeamSeats:1}`
    → billing asserts honest free-plan; domains custom-add is gated off.
  - `/api/media/assets` → 200 key is **`assets`** (NOT `data`; has `pixel-test.png`) →
    media reconcile MUST read `.assets` (response-key-mismatch guard).
  - **Analytics fixme RESOLVED as NOT-a-bug**: `/api/analytics/network` → 404 without a site,
    `/api/analytics-data` → 400 needs `siteId`, and entitlement `analyticsEnabled:false` for
    this org → the 6 analytics fixme are honest gating + missing-param, NOT the lying-empty
    class. Next analytics fire: pass `siteId=e2e-site-3` + assert the entitlement-disabled
    upgrade state (that IS the correct behavior to prove).
  - Fold plan: retrieve each agent worktree → run vs prod → `.fixme` genuine RED → keep green
    → update the map + total → commit.
  - **RESULT: +57 green this fire → running total 117 green / 128 written (11 fixme).**
    - `flows-settings` 21 green + 1 fixme (test 02 passes SOLO but fails under parallel prod
      contention — the flow suite is heavy on prod; run at `--workers≤3`).
    - `flows-media` 17 green + 1 fixme (upload-control selector guessed wrong; reads `.assets` OK).
    - `flows-sites` 19 green + 3 fixme (01/02 reconcile + 05 row-click — the agent's site-row
      selector doesn't match live DOM; these 4 FAIL SOLO too = real selector mismatch, NOT
      contention → next fire: inspect live `/admin/sites` DOM for the real row selector, then the
      reconcile confirms rows vs `/api/sites` real data (`e2e-site-3` exists — so a genuine 0-row
      render would be lying-empty; more likely just the selector).
    - `flows-billing` DELETED — agent context-saturated + authored blind (14/18 RED). Re-author
      next fire with real selectors (probe `/admin/billing` DOM first).
  - **Lesson (fire-2):** lean write-first briefs fixed 3/4 agent saturations vs fire-1's 2/4, but
    the 2 that read/guessed heaviest (settings once, billing) still saturated → next fire give
    agents the EXACT selector list (pre-probe the live DOM myself, pass it in the brief).
