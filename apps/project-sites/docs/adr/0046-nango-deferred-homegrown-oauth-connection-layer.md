# 0046 — Homegrown OAuth connection layer (Nango deferred)

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§46 of the convergence include-list calls for Nango (managed OAuth /
third-party-connection infrastructure). ProjectSites already owns two working,
Worker-native OAuth connection layers that do exactly what Nango does — the
authorize → callback → token-exchange → encrypted-storage → refresh lifecycle
across many third-party providers:

- **`routes/mcp_oauth.ts`** — per-site MCP provider connections:
  `GET /api/mcp/:provider/connect` (builds the authorize URL **or** a paste-key
  spec) + `/callback` (exchanges the code, **encrypts + upserts** tokens into
  `mcp_connections`). Falls back to a paste-key flow when a provider's
  `{PROVIDER}_OAUTH_CLIENT_ID` secret is absent — no broken popup.
- **`routes/social_oauth.ts`** — social-platform OAuth (`/api/social/:platform/connect`
  + `/callback`), same exchange/encrypt/upsert shape, with paste-key fallback for
  non-OAuth platforms (Bluesky/Mastodon/Telegram/Discord).
- Supporting: `mcp_pkce.ts` (PKCE), `mcp_client.ts`, AES-GCM token encryption.

Adopting Nango would mean either self-hosting its container+Postgres stack (wrong
for a CF-first edge app, per the hosting doctrine) or routing every OAuth dance
through a managed third party — replacing working, encrypted, edge-native code
with a vendor dependency for no capability gain.

## Decision

**Defer Nango.** Keep the homegrown OAuth connection layer as the source of truth.
Do NOT build a port now: unlike the flag/api-key/tracing cases, there is no single
clean call-site contract to wrap — `mcp_oauth` and `social_oauth` are full Hono
route groups with provider-specific adapters, encryption, and paste-key fallbacks
already in place. A premature `OAuthConnectionProvider` abstraction over two route
groups would add indirection without removing duplication.

If a future need arises (a provider Nango supports that we don't, or OAuth-refresh
volume that justifies offloading), introduce a managed-Nango adapter behind a new
`OAuthConnectionProvider` port at that time, gated on `NANGO_SECRET_KEY`.

## Consequences

- **Positive:** zero new deps, no container to host, tokens stay AES-GCM-encrypted
  in our own D1, edge-native, paste-key fallback preserved. §46 is addressed with
  an honest "custom equivalent exists" rather than a duplicate.
- **Negative:** we maintain provider adapters ourselves (new providers = new
  adapter code, not a Nango catalog entry). Accepted — the current provider set is
  small and stable.
- **Neutral:** the registry entry `oauth-nango` records status `deprecated`-of-vendor
  / homegrown-live so the architecture-fitness scan doesn't flag §46 as missing.

## Alternatives considered

- **Build an `OAuthConnectionProvider` port over the route groups now** — rejected:
  no single call-site contract to wrap; would be indirection over two full route
  groups, not a thin adapter. Revisit only if a managed-Nango adapter is needed.
- **Self-host or adopt managed Nango** — deferred: replaces working encrypted
  edge-native flows with a vendor/container for no capability gain today.
