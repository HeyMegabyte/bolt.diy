# platform_mcp — projectsites.dev MCP server for Claude Code & friends

**Flag:** `platform_mcp` (alpha, `enabled=0`). **Why it exists:** a *distribution*
play — let developers who live in **Claude Code / Cursor / Cline** drive
projectsites.dev without leaving their editor. Connect once, manage your sites,
deploy. Meets a new market where they already are.

## How a developer connects (Claude Code)

1. Mint a scoped token at **https://projectsites.dev/admin/api-tokens** (`psk_…`).
   Scopes: `sites:read` (inspect) and/or `sites:write` (deploy/create).
2. Add to `.mcp.json` (project) or `~/.claude.json` (global):

```jsonc
{
  "mcpServers": {
    "projectsites": {
      "type": "http",
      "url": "https://projectsites.dev/api/mcp",
      "headers": { "Authorization": "Bearer psk_YOUR_TOKEN" }
    }
  }
}
```

3. `/mcp` in Claude Code → `projectsites` connected. Ask: *"list my projectsites,"*
   *"what's the build status of acme,"* and (next slice) *"deploy ./dist to acme."*

`GET /api/mcp` returns the discovery manifest (server info, auth how-to, tool
catalog) — curl it to verify the connection is live.

## Auth model

- **API key (v1, primary):** `Authorization: Bearer psk_…`, verified by
  `verifyApiToken` → org + scopes; every tool is `hasScope`-gated. Simplest for
  Claude Code (paste a key). Mint read-only keys for inspection-only agents.
- **OAuth 2.1 (roadmap):** the existing `mcp_oauth.ts` (PKCE + RFC 8707 resource
  indicators) extends to a one-click "Connect projectsites" consent so tools can
  mint per-audience tokens without a manual paste. Wire after deploy_site.
- `initialize` + `tools/list` are open (static catalog, zero data) per MCP
  convention; all **data** tools require a valid token. Unauthorized `tools/call`
  → JSON-RPC `-32001`. Flag off → HTTP 404 (never 403 — no existence leak).

## Tools

| Tool | Scope | Status |
| --- | --- | --- |
| `whoami` | sites:read | ✅ live |
| `list_sites` | sites:read | ✅ live |
| `get_site` | sites:read | ✅ live |
| `get_build_status` | sites:read | ✅ live |
| `deploy_site` *(args: site_id, files[])* | sites:write | ✅ live — writes files to R2 sites/{slug}/{version}/…, points _manifest at it, busts cache; returns `live_url` + a stable version-pinned `preview_url` (`{slug}-{id}.projectsites.dev`, served via the snapshot host path, unaffected by later deploys). Paths are traversal-validated + size-capped (500 files · 2MB/file · 20MB total) |
| `create_site` *(args: business_name, slug?)* | sites:write | ✅ live — creates a draft site (unique slug), returns site_id + URL; then deploy_site to publish |
| `list_snapshots` *(args: site_id)* | sites:read | ✅ live — lists saved snapshots for a site (id, snapshot_name, build_version, description, created_at) |
| `get_research` *(args: site_id)* | sites:read | ✅ live — returns AI research data collected for a site (business profile, brand, selling points), keyed by task_name |
| `tail_logs` *(args: site_id, limit?)* | sites:read | ✅ live — returns recent build/workflow log entries from `workflow_jobs` newest-first (`{status, step, updated_at}`); default limit 20, max 100 |
| `set_domain` *(args: site_id, hostname)* | sites:write | ✅ live — connects a custom domain (paid plan; requires a DNS CNAME `hostname → projectsites.dev` set first), provisions the CF custom hostname + SSL, returns status |

**Scope discipline (the "is it rude to expose the whole API?" answer):** No — the
MCP intentionally exposes a *curated* surface, not the raw 400-route API. Tools
are the safe, agent-shaped subset (read + deploy + create), each scope-gated and
org-isolated. Destructive/billing/admin routes stay out of the MCP by design.

## Why read-first

v1 ships the read tools (real, tested, safe for an autonomous agent) so the
connect-from-Claude-Code experience is live today; `deploy_site` is the headline
next slice (it needs the R2-write + publish internals — see ROADMAP TIER 0). No
fake-success stubs: unimplemented tools are simply not advertised.
