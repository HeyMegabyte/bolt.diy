---
name: projectsites-database-tabs
description: REMOVED 2026-08-14 — historical spec for the deleted SQLite/Postgres/Redis/KV editor bottom-panel tabs
---

# ProjectSites Database Tabs — REMOVED 2026-08-14

> These bottom-panel DB tabs (SQLite, Postgres, Redis, KV) and the Search tab were
> **deleted from the bolt.diy editor** per Brian. The bottom panel is now
> `Terminal | Problems | Logs` (see `projectsites-editor-layout`). The tab components
> and `api.bolt-tabs.{sql,kv}` routes are gone. This file is retained ONLY as the
> spec to consult IF database consoles are ever rebuilt — it is NOT a live convention.
> Do not treat the sections below as currently-shipping features.

## SQLite (labeled "SQLite" in UI)
- Local/mock adapter first, D1/Wrangler adapter later
- Schema browser + SQL editor + paginated data grid
- Destructive SQL guardrails: warn on DROP/TRUNCATE/DELETE without WHERE
- Migration manager: create, list, apply, preview wrangler commands

## Postgres
- Connection profile manager with redacted credentials
- Local/mock first, Neon/Hyperdrive later
- Schema explorer + SQL editor with query history, timing, row count
- Never export passwords, tokens, or full private connection URLs

## Redis
- SCAN-style key browser — NEVER KEYS * in real adapters
- Type-aware editors for string/hash/list/set/zset/stream
- Guarded command console with destructive-op warnings

## KV
- Namespace manager with binding preview + mode indicator
- Key browser with prefix search, bulk import/export, snapshot validation
- Avoid unbounded key scans
