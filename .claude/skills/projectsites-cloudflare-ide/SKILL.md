---
name: projectsites-cloudflare-ide
description: ProjectSites.dev Bolt.diy Cloudflare IDE conventions — editor, database consoles, site workspace
---

# ProjectSites Cloudflare IDE

## Architecture
- bolt.diy Remix app at `app/` — AI code editor with WebContainer preview
- Project Sites Worker at `apps/project-sites/` — Hono API + site serving
- Shared package at `packages/shared/` — Zod schemas, constants, RBAC, utilities
- Cloudflare-first: Workers, D1, R2, KV, Durable Objects, Queues, Workflows

## Editor Layout Conventions
- See `projectsites-editor-layout` skill for tab strip, bottom panel, .z-workbench
- `WorkbenchViewType` in `app/lib/stores/workbench.ts` defines 4 top tabs: `code | preview | functions | data`
- `BottomPanelTabs` in `app/components/workbench/extensions/BottomPanelTabs.tsx` (icon-only: `problems`, `logs`)

## Site Repository Model
- Portable `.zip` export with versioned manifest + checksums
- `functions/` folder for site Worker code (Workers for Platforms)
- `data/` folder for SQLite, Postgres, Redis, KV resources
- `projectsite.json` at root — site manifest (domain, owner, resources, bindings)

## BrickLabor.com Fixture
- Location: `apps/project-sites/fixtures/bricklabor.com/`
- Standalone site repository under `brian@megabyte.space`
- Never hardcode bricklabor.com into shared components

## Key Files
- `app/components/workbench/Workbench.client.tsx` — main workbench with tab strip
- `app/components/workbench/EditorPanel.tsx` — code editor + file tree + bottom panel
- `app/components/workbench/extensions/BottomPanelTabs.tsx` — icon-only bottom tabs
- `app/lib/stores/workbench.ts` — workbench state (views, terminal, files)
- `packages/shared/src/schemas/site-repository.ts` — all site repository schemas
