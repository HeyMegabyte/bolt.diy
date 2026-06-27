# ADR-0054 — Search engines (Orama/Typesense) + UI libraries (Floating UI / Sonner / Embla)

**Status:** Accepted · **Date:** 2026-06-25 (Brian directive) · **Deciders:** Brian Zalewski
**Series:** convergence (see `DECISIONS.md` § two ADR series note)

## Context

Child sites (`{slug}.projectsites.dev`), the AI concierge, and the platform admin all need
search; the Angular admin + React generated-site template need shared tooltip/toast/carousel
primitives. We want a free/zero-infra default with a paid escalation, and CF-first hosting.

## Decision

### Search — tiered (Orama base/free, Typesense advanced/paid; Typesense on Fly.io)

| Surface / tier | Engine |
|---|---|
| Default child-site search (`{slug}.projectsites.dev`) | **Orama** — zero infra, on-device |
| Advanced paid search add-on (per child site) | **Typesense** (Fly.io) |
| ProjectSites.dev internal / global search (admin + platform) | **Typesense** (Fly.io) |
| AI concierge — base tier | **Orama + CF-native AI/RAG** (Workers AI + Vectorize/AutoRAG) |
| AI concierge — advanced tier | **Typesense** (hybrid) OR a dedicated vector layer |

- **Orama** (`@orama/orama` + `@orama/plugin-data-persistence`): build pipeline emits
  `public/search-index.json` per generated site from `_scraped_content.json.routes[]`; the
  React template's `<SiteSearch>` (Cmd+K) lazy-loads + restores the persisted index, searches
  on-device. Base AI concierge feeds CF-native RAG (`src/services/rag.ts`).
- **Typesense** (Fly.io stateful-VM escape hatch, persistent volume): worker service
  `src/services/search_typesense.ts` indexes with the admin key server-side; mints scoped
  search-only keys for the frontend. Collections: `sites`, `docs`, `admin_entities`, + per
  paid-child-site collections. Admin/global UI call a `/api/search?q=` proxy, never the admin key.
  Add-on is flag/entitlement-gated. Secrets: `TYPESENSE_HOST`, `TYPESENSE_ADMIN_API_KEY`,
  `TYPESENSE_SEARCH_ONLY_API_KEY`.

### UI libraries

| Lib | Angular admin (`frontend/`) | React generated sites (template repo) |
|---|---|---|
| Floating UI (default tooltip, virtual element) | `@floating-ui/dom` → `appTooltip` directive (`computePosition` + virtual ref) | `@floating-ui/react` |
| Sonner (toasts) | `ngx-sonner` / Spartan `hlm-sonner` (admin is Spartan) | `sonner` |
| Embla (carousel) | `embla-carousel-angular` | `embla-carousel-react` |

## Consequences

- Most child sites pay zero search infra (Orama on-device); paid tier and platform-global
  search escalate to one shared Typesense host.
- Adds Fly.io as the Typesense host (one more stateful-VM escape hatch under CF-first).

## Build order (fresh session, Monitor + parallel agents)

1. Worker `search_typesense.ts` + `/api/search` proxy + collection-seed migration (TDD).
2. Angular `appTooltip` (Floating UI virtual) — default tooltip.
3. Angular Sonner (`hlm-sonner`) provider + replace existing toast calls.
4. Angular Embla wrapper component.
5. Template repo: Orama `<SiteSearch>` + build-step index emit + Sonner/Embla/Floating-UI.
6. Provision Typesense (Fly.io) + secrets; deploy + prod-E2E each surface.

⚠️ `npm install` uses `--legacy-peer-deps`; never symlink+install in a worktree (corrupts main).

## Install homes

- Angular admin `frontend/package.json`: `@floating-ui/dom`, `embla-carousel-angular`, `ngx-sonner`.
- Worker `apps/project-sites/package.json`: `typesense`.
- React template repo: `@orama/orama`, `@orama/plugin-data-persistence`, `sonner`, `embla-carousel-react`, `@floating-ui/react`.
