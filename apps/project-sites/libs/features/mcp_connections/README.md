# mcp_connections

Per-site MCP (Model Context Protocol) connection management — the admin surface that lists a site's connected providers (Mailchimp, Stripe, HubSpot, GitHub, …) and revokes one. Access tokens are NEVER returned.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/sites/:siteId/mcp/connections` | List active MCP provider connections (+ provider catalog) |
| DELETE | `/api/sites/:siteId/mcp/connections/:id` | Revoke a connection + clear its encrypted tokens |

## Provenance

Extracted VERBATIM from `src/routes/ai_admin.ts` (route-decomposition installment 19). Only the route receiver changed (`aiAdmin.` → `mcpConnections.`); handler bodies are byte-for-byte unchanged. Both routes carry no request body → no `schemas.ts`.

## Dependencies

- **Kit** (`src/lib/ai_admin_kit.ts`): `need`, `siteOwned`, `safeJson`, `aiAdminOnError`. No local scaffolding.
- **`allProviders`** (`src/services/mcp_client.ts`): the MCP provider catalog returned by the list route.
- **`auditService`** (`src/services/audit.ts`): the DELETE path audit-logs `mcp.disconnected` via `c.executionCtx.waitUntil`.
- **D1** (`c.env.DB`): `mcp_connections` table.

> Note: the installment-19 brief listed a dynamic `import('../services/notify.js')` dependency for this module — the actual source (`ai_admin.ts` lines 219-278) does NOT use `notify`; the two `notifyOwnerEvent` imports in that file belonged to the team/org routes (NOT moved). This module mirrors the real source verbatim: `auditService` + `allProviders`, no `notify`.

## Wiring

`src/index.ts` mounts `mcpConnections` before both `api` and `aiAdmin`. No feature flag — org+user-scoped via `need()` + `siteOwned()` (404 non-leak), same class as `aiSettings`/`aiEndpoints`/`aiContext`.
