# mcp_oauth_provider

OAuth 2.1 authorization server so MCP clients (Claude Code and others) can obtain
access tokens via PKCE flow instead of manually pasting a `psk_` token.

## Flag key

`mcp_oauth_provider` — experimental, disabled by default (`enabled=0, rollout=0`).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/.well-known/oauth-authorization-server` | Public | RFC 8414 metadata |
| `POST` | `/oauth/register` | Public | RFC 7591 dynamic client registration |
| `GET` | `/oauth/authorize` | Public | Browser entry → 302 to `/oauth/consent` |
| `POST` | `/api/oauth/authorize` | Bearer | Issue auth code |
| `POST` | `/oauth/token` | Public | Exchange code for access_token |

All endpoints return `404` when the flag is off (never 403).

## PKCE

Only `code_challenge_method=S256` is accepted. The code verifier must be 43–128 URL-safe
characters. The challenge is `base64url(SHA-256(verifier))`.

## Redirect URIs

Allowed:
- Any `https://` URI
- `http://127.0.0.1[:port]/...`
- `http://localhost[:port]/...`

Non-loopback HTTP URIs are rejected with `invalid_redirect_uri`.

## KV storage

All state is stored in `CACHE_KV` (no D1 migration):

- `oauth_client:<id>` — registered client, TTL 30 days
- `oauth_code:<code>` — single-use auth code, TTL 600 s

## Scopes

Supported: `sites:read`, `sites:write`

## Safe disabled behavior

When the flag is off, all routes return `{ "error": { "code": "NOT_FOUND" } }` with
HTTP 404. MCP clients fall back to the psk_ token paste flow.

## Smoke steps

1. `GET https://projectsites.dev/.well-known/oauth-authorization-server` — assert JSON with `issuer`.
2. `POST /oauth/register` with `{ "redirect_uris": ["http://127.0.0.1:8080/cb"] }` — assert 201 + `client_id`.
3. Use returned `client_id` in `GET /oauth/authorize?...&code_challenge=...&code_challenge_method=S256` — assert 302.
4. `POST /api/oauth/authorize` with Bearer + same params — assert `{ redirect_uri: "...?code=..." }`.
5. `POST /oauth/token` with code + code_verifier — assert `{ access_token, token_type: "Bearer" }`.
