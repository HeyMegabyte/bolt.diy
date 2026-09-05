# site_mcp_server

Hono routes for the **per-site MCP server** admin surface (#29) — the backend
wiring behind the `/admin/sites/:id/mcp-server` section.

## What it does

Exposes five authed admin endpoints so a site owner can (a) mint/list/revoke the
Bearer tokens external agents (Claude, GPT, Cursor) use to reach the site's MCP
server, (b) see the tool registry that server exposes, and (c) watch 30-day
per-tool usage.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/sites/:siteId/mcp/tokens` | List non-revoked tokens (never the raw/hash) |
| POST | `/api/sites/:siteId/mcp/tokens` | Mint a token (raw returned once) |
| DELETE | `/api/sites/:siteId/mcp/tokens/:tokenId` | Revoke a token |
| GET | `/api/sites/:siteId/mcp/tools` | The site MCP tool registry (`SITE_MCP_TOOLS`) |
| GET | `/api/sites/:siteId/mcp/tool-usage` | 30-day per-tool call/error counters |

## Why it exists

The feature was built end-to-end — service logic (`services/mcp_site_tools.ts`),
D1 tables (`site_mcp_tokens` + `site_mcp_tool_usage`, migrations `0514`/`0625`),
and the full Angular section — but **no route wired the service to the UI**. Every
endpoint 404'd, so the section rendered "Couldn't load tokens / tools" error
cards (caught by `contract-sweep.mjs` `sites-mcp-server`, 2026-09-05). This module
is the missing wiring; it adds no new logic and no new table.

## Auth + safety

- Every route: `need(c)` (401 without orgId+userId) + `siteOwned(c, orgId, siteId)`
  (404 — never 403 — on a missing/foreign site: the IDOR guard).
- Raw tokens are returned exactly once on mint; only the SHA-256 hash is stored.
- Mint + revoke write an append-only audit log (`mcp.token_minted` /
  `mcp.token_revoked`).
- Always-on (no flag) — matches the always-on admin contract row (`flag: null`)
  and the already-shipped unflagged frontend.

## Not in scope (follow-on)

The **public** per-site JSON-RPC endpoint (`POST /:slug/mcp`, token-auth via
`verifySiteMcpToken` → `dispatchTool`) that external agents + the section's
"test tool" button call is a separate public surface, wired in its own slice.
