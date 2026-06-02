# Frontend Feature Inventory

> Authoritative feature → spec map for the **Angular admin + marketing SPA**
> (`apps/project-sites/frontend`). Every feature row maps to ≥1 Playwright spec
> in this directory. Machine-readable mirror: [`COVERAGE.yml`](./COVERAGE.yml).
>
> Counterpart inventories: `apps/project-sites/e2e/FEATURES.md` (worker e2e),
> root `e2e/FEATURES.md` (bolt.diy main app). This file covers the SPA only.
>
> **Run a spec:** `npx playwright test --config=playwright.prod.config.ts <name>`
> All specs are homepage-first and run against the live prod URL.

Status legend: ✅ covered + green · ⚠️ covered, known-blocked dependency · 🔲 gap (no spec yet).

---

## Marketing / public pages

| Feature | Spec(s) | Status |
|---|---|---|
| Homepage hero / features / CTAs | `homepage.spec.ts`, `journey-homepage.spec.ts`, `hero-logo-visual.spec.ts`, `logo-styling.spec.ts` | ✅ |
| Homepage landmarks + JSON-LD | `homepage-landmarks.e2e.ts`, `json-ld-schema.spec.ts` | ✅ |
| Header (auth-aware nav, SPA links) | `header.spec.ts`, `header-auth-state.spec.ts`, `forms-header-button.spec.ts` | ✅ |
| Blog list + post | `marketing-a11y.e2e.ts`, `marketing-responsive.e2e.ts` | ✅ |
| Press | `press.spec.ts`, `marketing-a11y.e2e.ts`, `marketing-responsive.e2e.ts` | ✅ |
| Privacy / Terms (legal) | `marketing-a11y.e2e.ts`, `marketing-responsive.e2e.ts` | ✅ |
| Roadmap | `marketing-a11y.e2e.ts`, `marketing-responsive.e2e.ts` | ✅ |
| Integrations | `marketing-a11y.e2e.ts`, `marketing-responsive.e2e.ts` | ✅ |
| Contact | `marketing-a11y.e2e.ts`, `marketing-responsive.e2e.ts`, `contact-form.e2e.ts` | ✅ |
| Sign-in (magic-link / Google) | `signin.spec.ts`, `marketing-a11y.e2e.ts`, `marketing-responsive.e2e.ts` | ✅ |
| Changelog (worker-served) | `marketing-a11y.e2e.ts` (excluded — documented) | ⚠️ worker/Docker-blocked |
| Status (worker-served) | `marketing-a11y.e2e.ts` (excluded — documented) | ⚠️ worker/Docker-blocked |
| Mobile responsive (all marketing) | `mobile.spec.ts`, `marketing-responsive.e2e.ts` | ✅ |

## Create / build / waiting flows

| Feature | Spec(s) | Status |
|---|---|---|
| Create-from-search wizard | `create-site.spec.ts`, `create-page-fixes.spec.ts`, `create-final-fixes.spec.ts`, `auto-create.spec.ts` | ✅ |
| Create z-index / repopulate edge cases | `create-zindex-repopulate.spec.ts`, `dropdown-zindex.spec.ts` | ✅ |
| Category + special-char inputs | `heyo-category.spec.ts`, `heyo-special-chars.spec.ts`, `when-doody-calls.spec.ts` | ✅ |
| Create journey (end-to-end) | `journey-create.spec.ts` | ✅ |
| Waiting / build progress | `waiting.spec.ts`, `build-pipeline.spec.ts` | ✅ |
| Headless build → editor handoff | `headless-build.spec.ts`, `headless-to-editor.spec.ts` | ✅ |
| Build → edit → snapshot cycle | `build-edit-snapshot-cycle.spec.ts` | ✅ |
| Image discovery during build | `image-discovery.spec.ts`, `white-house-images.spec.ts` | ✅ |

## Admin shell + navigation

| Feature | Spec(s) | Status |
|---|---|---|
| Admin routing (SPA, no full reload) | `admin-routing.e2e.ts`, `admin.spec.ts` | ✅ |
| Admin shell / sidebar / topbar | `admin.spec.ts`, `production-admin.spec.ts` | ✅ |
| User menu | `admin-user-menu.spec.ts` | ✅ |
| User settings · Sessions (toast-clean) | `admin-user-settings.e2e.ts` | ✅ |
| Cmd+K command palette + focus | `admin.spec.ts`, `full-audit.spec.ts` | ✅ |
| Cinematic UI (rolling-counter, reveal) | `admin-cinematic-ui.e2e.ts` | ✅ |
| Dashboard upgrades shell — AI FAB (real `/api/dashboard/chat` SSE) + share-toast (de-faked) | `admin-ai-fab.e2e.ts` | ⚠️ shipped + bundle-verified; shell occluded by editor iframe on `/admin` (see Known gaps) |
| Spartan controls + tooltip | `admin-spartan-controls.e2e.ts`, `admin-tooltip.e2e.ts` | ✅ |

## Admin sections

| Section | Spec(s) | Status |
|---|---|---|
| Dashboard / sites list | `admin.spec.ts`, `production-admin.spec.ts` | ✅ |
| Editor (persistent bolt.diy iframe) | `bolt-embed.spec.ts`, `editor-proxy.e2e.ts`, `production-editor.spec.ts`, `production-editor-prompt.spec.ts`, `production-editor-errors.spec.ts` | ✅ |
| Files explorer | `files-deep.spec.ts` | ✅ |
| Snapshots + diff | `admin-snapshots.spec.ts`, `build-edit-snapshot-cycle.spec.ts` | ✅ |
| Site detail tabs | `admin-site-detail-tabs.e2e.ts` | ✅ |
| Analytics (CF traffic) | `analytics-cf-traffic.spec.ts` | ✅ |
| Billing + Stripe checkout | `stripe-link-inline-checkout.spec.ts`, `production-admin.spec.ts` | ✅ |
| Feature flags (on + off) | `admin-feature-flags.e2e.ts`, `admin-flag-gated.e2e.ts` | ✅ |
| Forms builder | `forms-header-button.spec.ts`, `full-feature-coverage.spec.ts` | ✅ |
| Notifications bell | `notification-bell.e2e.ts` | ✅ |
| Rebuilt sections (Spartan) | `admin-rebuilt-sections.e2e.ts` | ✅ |
| Audit · api-tokens · pseo · seo · content-freshness · import · docs · traces · ai-endpoints · mcp · social · voice · media · apps · settings · user-settings · domains | `full-audit.spec.ts`, `full-coverage.spec.ts`, `full-feature-coverage.spec.ts`, `comprehensive.spec.ts`, `admin.spec.ts` | ✅ broad-suite |
| Super-admin console | `production-admin.spec.ts`, `full-audit.spec.ts` | ✅ |

## Components / states (cross-cutting)

| Feature | Spec(s) | Status |
|---|---|---|
| Dialog (focus-trap + Esc + restore) | `a11y-focus-trap.spec.ts`, `admin-dialog-keyboard.e2e.ts` | ✅ |
| Empty / loading / error / success states | `admin-error-states.e2e.ts`, `admin-section-states.e2e.ts`, `states-kit.spec.ts` | ✅ |
| Network honesty (no fake data) | `admin-network-honesty.e2e.ts` | ✅ |
| API contract (no dead/SPA-HTML endpoints) | `api-contract.e2e.ts` | ✅ |
| Marketing internal links (no 4xx/5xx) | `marketing-links.e2e.ts` | ✅ |
| JSON-LD accuracy (FAQPage only where visible; single route-accurate WebPage + BreadcrumbList, no duplicate/stale-homepage-url node) | `marketing-jsonld.e2e.ts` | ✅ |
| Admin interactions (clicks/keyboard) | `admin-interactions.e2e.ts`, `admin-functional.e2e.ts` | ✅ |
| Universal search (real nav, no fabricated rows) | `admin-universal-search.e2e.ts` | ✅ |

## Production smoke (live URL)

| Feature | Spec(s) | Status |
|---|---|---|
| Production build | `production-build.spec.ts` | ✅ |
| Production end-to-end flow | `production-flow.spec.ts` | ✅ |
| Production heyo create | `production-heyo.spec.ts` | ✅ |

## Accessibility / responsive gates (cross-cutting)

| Gate | Spec(s) | Status |
|---|---|---|
| Admin axe (desktop, all sections) | `admin-a11y.e2e.ts` | ✅ |
| Admin axe (mobile 390) | `admin-a11y-mobile.e2e.ts` | ✅ |
| Admin axe (param routes) | `admin-param-routes-a11y.e2e.ts` | ✅ |
| Admin 320px reflow | `admin-reflow.e2e.ts` | ✅ |
| Admin console / CSP / network clean | `admin-console-hygiene.e2e.ts` | ✅ |
| Marketing axe (9 public routes) | `marketing-a11y.e2e.ts` | ✅ |
| Marketing 390 axe + 320 reflow | `marketing-responsive.e2e.ts` | ✅ |
| Mobile layout (34 checks) | `mobile.spec.ts` | ✅ |

## Auth / permissions

| Feature | Spec(s) | Status |
|---|---|---|
| Sign-in flow (magic-link / OAuth) | `signin.spec.ts`, `journey-auth-admin.spec.ts` | ✅ |
| Bearer-auth sweep (no leaks) | `admin-auth-sweep.e2e.ts` | ✅ |
| Header auth state transitions | `header-auth-state.spec.ts` | ✅ |
| Auth-gated admin journey | `journey-auth-admin.spec.ts` | ✅ |

## Broad / regression suites

| Suite | Spec | Tests |
|---|---|---|
| Full audit | `full-audit.spec.ts` | 83 |
| Full coverage | `full-coverage.spec.ts` | 41 |
| Full feature coverage | `full-feature-coverage.spec.ts` | 35 |
| Full user simulation | `full-user-simulation.spec.ts` | 19 |
| Ultimate feature chains | `ultimate-feature-chains.spec.ts` | 15 |
| Quality features | `quality-features.spec.ts` | 18 |
| Requirements | `requirements.spec.ts` | 14 |
| Comprehensive | `comprehensive.spec.ts` | 10 |

---

## Known gaps / blocked (honest — not faked)

- **`/status` + `/changelog` a11y** — these are **worker-served HTML**
  (`apps/project-sites/src/index.ts:513`, `changelog_public.ts`), not Angular
  components. Their `<title>`/lang/link-in-text-block fixes need a **worker
  deploy** (Docker daemon required: `open -a Docker` then deploy, or push →
  Workers Builds). Excluded from `marketing-a11y.e2e.ts` with an in-spec note.
- **`/search` contrast** — a transient loading-skeleton flash (settles clean);
  excluded from the gate to avoid flakiness (documented in `marketing-a11y.e2e.ts`).
- The dense admin sections (audit, pseo, seo, mcp, social, voice, etc.) are
  covered by **broad suites** (`full-audit`, `full-coverage`,
  `full-feature-coverage`). A future round can split these into per-section
  dedicated specs for finer-grained failure attribution.
- **Admin-upgrades-shell occluded on `/admin`** — the 600-line "30 upgrades"
  shell (`components/admin-upgrades/admin-upgrades-shell.component.ts`, hosted in
  `pages/admin/sections/dashboard.component.ts`) mounts ONLY on `/admin`, which is
  an editor route (`pages/admin/admin.component.ts:135` `isEditorRoute`), so the
  persistent `.bolt-frame--visible` iframe (z-stacking) is composited over the
  shell's topbar + FAB — they are present in the DOM but not click-reachable for a
  real user. The AI FAB (now real SSE) + share-toast fixes shipped and are
  bundle-verified by `admin-ai-fab.e2e.ts`, but exercising them via real clicks
  needs the shell re-mounted as persistent chrome ABOVE the iframe in
  `admin.component`, OR excluding `/admin` from `isEditorRoute`. The shell also
  duplicates real chrome (sidebar nav, `notification-bell.component`,
  `command-palette`, `ai-chat-widget`) — so "un-bury vs retire the shell" is a
  product/architecture decision, deferred (entangled with the persistent-iframe
  host; not changed unilaterally under concurrent sessions).
