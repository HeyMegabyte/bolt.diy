---
name: projectsites-editor-layout
description: Bolt.diy editor layout conventions — top tabs, bottom panel, hover overlays, .z-workbench
---

# ProjectSites Editor Layout

## Top Tabs (4-tab strip)
- Order: `Code | Preview | Functions | Data`
- Type: `WorkbenchViewType` in `app/lib/stores/workbench.ts` (union: `'code' | 'preview' | 'functions' | 'data'`)
- Each tab: icon + text label + `aria-pressed` + keyboard accessible
- Active: `bg-bolt-elements-terminals-buttonBackground text-bolt-elements-textPrimary`
- Default: `bg-transparent text-bolt-elements-textTertiary hover:bg-bolt-elements-background-depth-3`

## Bottom Panel (icon-only with tooltips)
- Order: `Terminal | Problems | Logs`
- Each tab: icon + Radix Tooltip (400ms delay) + ARIA label
- No visible text labels in tab buttons
- Close panel button: caret-down icon with "Close panel" tooltip

## Removed 2026-08-14 (per Brian) — do NOT restore as "canonical"
- Top tab `Settings` deleted (`SettingsPanel.tsx`) — was a hardcoded bricklabor.com mockup with stub export/import. App-level settings live separately in `@settings/core/ControlPanel`.
- Bottom tabs `SQLite | Postgres | Redis | KV | Search` deleted, plus the now-orphaned `api.bolt-tabs.{sql,kv}` routes. `SqlTab/PostgresTab/RedisTab/KvTab/SearchTab.tsx` are gone.
- ⚠️ `Functions` + `Data` tabs were deleted 2026-08-15 (e41deccd) then **RESTORED 2026-08-17 at Brian's explicit request** — keep them; never re-delete. Their panels hold bricklabor fixture data (known mock, wiring TBD).
- Intentional trim, NOT built-ahead — any NG8113/knip "unused" hit on their remnants is removal drift to finish, never a feature to rebuild.

## .z-workbench
- Full-canvas surface — 100% width/height, no padding, no margin
- Hosts the workbench content area
- Floating overlays (chat, prompt) sit above it
- Theme tokens: `--bolt-elements-*` (bg, text, border, item, terminals)

## White-Box Button Fix
- All icon buttons need `bg-transparent` in default state
- Never hardcode `bg-white`, `text-white`, or raw white backgrounds
- Use `text-bolt-elements-textTertiary` for icons, `text-bolt-elements-textPrimary` for active
- Add `aria-label` to every icon-only button

## Theme Tokens
- Light mode: `--bolt-elements-bg-depth-1: white`, `--bolt-elements-bg-depth-2: gray.50`
- Dark mode: `--bolt-elements-bg-depth-1: gray.950`, `--bolt-elements-bg-depth-2: gray.900`
- Terminal bg: `--bolt-elements-terminals-background` (light=white, dark=gray.950)
- Active tab bg: `--bolt-elements-terminals-buttonBackground`
