# Feature Module Catalog

> Consolidated per-module docs (folded from per-folder `README.md`, 2026-06-27).
> **Project override** of the global "README per module" doctrine — feature docs live HERE,
> one section per module. `validate:features` gates `manifest.ts`, NOT per-folder READMEs.
> New modules: add a section here instead of a `README.md`. Source stays at `libs/features/<slug>/`.



---

## admin-detail

# admin-detail — Admin Site Detail (core surface)

Split-view site detail panel: build status, logs, hostnames, billing, bolt editor.

- **Flag key**: `__core__` (sentinel — always enabled)
- **Lifecycle**: `beta`
- **Owner**: brian@megabyte.space

## Tests
- `e2e/admin-and-billing.spec.ts`
- `e2e/admin-modals.spec.ts`
- `e2e/_fortress/admin-detail/` — adversarial attack surface


---

## aeo_pass

# AEO Pass

Answer Engine Optimization audit module. Scores a published site for AI search
readiness and surfaces actionable issues so owners can improve their ranking in
ChatGPT, Perplexity, and Google AI Overviews.

## Feature flag

Key: `aeo_pass`
Default: `enabled=0, rollout_percent=0, stage='experimental'`

Toggle from `/admin/feature-flags`. Flag-off routes return 404.

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/aeo/audit/:siteId` | Required | Run a new AEO audit |
| GET | `/api/aeo/:siteId` | Required | Fetch the latest audit |

## D1 table

`aeo_audits` — see `migrations/0561_aeo_audits.sql`

## v1 stub

Score is hardcoded at **72** and issues are the three canonical AEO gaps:

- Missing FAQ schema
- No quotable answer blocks
- Insufficient structured data

A real crawl-based scorer replaces the stub when the feature graduates to beta.

## Safe disabled behavior

When the flag is off, both endpoints return `404`. No site data is affected.

## Removal

1. `git rm -r libs/features/aeo_pass/`
2. Remove the `app.route('/', aeoPass)` mount from `src/index.ts`
3. Drop the D1 table via a new migration


---

## ai_concierge_widget

# ai_concierge_widget

Flag key: `ai_concierge_widget` | Stage: alpha | Owner: brian@megabyte.space

Per-site AI chat widget that grounds responses via RAG semantic search and Workers AI LLM.

## Routes

- `POST /api/concierge/:siteId/message` — send a visitor message, get a grounded AI reply
- `GET /api/concierge/:siteId/config` — fetch widget configuration for the site

## Safe disabled behavior

When flag is off, all routes return 404. No data is stored.

## Dependencies

- `site_semantic_search` (RAG index must be populated)
- Workers AI binding (`AI`)
- Vectorize binding (`RAG_INDEX`)


---

## ai_gateway_guardrails

# ai_gateway_guardrails

Flag key: `ai_gateway_guardrails` | Stage: alpha | Owner: brian@megabyte.space

Classifies text via Llama Guard 3-8B, blocking requests that score unsafe at or above 0.85.

## Routes

- `POST /api/guardrails/check` — classify text for safety (body: `{text, threshold?}`)

## Helper export

`guardText(env, text, threshold?)` — convenience inline guard for other modules.

## Safe disabled behavior

Route returns 404 when flag is off. `guardText()` can be called without the flag being on.

## Dependencies

- `AI` Workers AI binding
- Llama Guard model: `@cf/meta/llama-guard-3-8b`


---

## auth

# auth — Authentication (core surface)

Always-on authentication surface: magic-link email, Google OAuth, session management.

- **Flag key**: `__core__` (sentinel — always enabled, never killswitched)
- **Lifecycle**: `stable`
- **Owner**: brian@megabyte.space

## What it does
- Magic-link email sign-in via Resend/SendGrid with 15-minute HMAC tokens
- Google OAuth 2.0 PKCE flow with state stored in `oauth_states` D1 table
- Session creation + renewal with Bearer token in `sessions` table
- `/api/auth/me` returns current user context for the Angular admin

## Routes
- `POST /api/auth/magic-link` — request magic link
- `GET  /api/auth/magic-link/verify?token=` — click-verify + session mint
- `GET  /api/auth/google` — start Google OAuth
- `GET  /api/auth/google/callback` — exchange code → session
- `GET  /api/auth/me` — current user

## Source files
- `src/services/auth.ts` — magic-link token, Google OAuth, session helpers
- `src/routes/api.ts` — auth route handlers
- `src/middleware/auth.ts` — Bearer token → session middleware

## Tests
- `e2e/auth-and-signin.spec.ts` — golden-path signin flows
- `e2e/auth/auth-flows.spec.ts` — expanded auth coverage
- `e2e/_fortress/auth/` — adversarial attack surface

## Known drift
- No TTL cron cleaning up stale `oauth_states` rows
- Magic-link expiry redirects to generic 401 instead of `/signin?expired=1`


---

## billing

# billing — Billing

Stripe checkout, subscriptions, entitlements, and billing portal.

- **Flag key**: `stripe_meters` (metered add-ons gated here; base checkout stable)
- **Lifecycle**: `beta`
- **Owner**: brian@megabyte.space

## Tests
- `e2e/admin-and-billing.spec.ts`
- `e2e/billing/billing-flows.spec.ts`
- `e2e/_fortress/billing/` — adversarial attack surface
- `src/__tests__/billing.test.ts`


---

## cmdk_ai_actions

# cmdk_ai_actions

Resolves natural-language admin commands to structured action intents using Workers AI, powering the Cmd+K command palette.

## Flag

Key: `cmdk_ai_actions`
Default: disabled (`enabled=0, rollout=0, stage='experimental'`)

## API

| Method | Path | Auth |
|--------|------|------|
| POST | /api/cmdk/resolve | Bearer JWT (userId required) |

### Request

```json
{
  "query": "go to analytics",
  "context": {
    "route": "/admin/sites",
    "siteSlug": "my-site"
  }
}
```

### Response (200)

```json
{
  "ok": true,
  "data": {
    "action": "view_analytics",
    "target": "/admin/analytics",
    "label": "View Analytics",
    "confidence": 0.92
  }
}
```

### Supported action tokens

| Token | Meaning |
|-------|---------|
| `navigate` | Navigate to a specific route |
| `create_site` | Open the create-site flow |
| `open_settings` | Open admin settings |
| `search` | Trigger a search |
| `publish_site` | Publish the active site |
| `view_analytics` | Open analytics dashboard |
| `manage_domains` | Open domain management |
| `open_docs` | Open documentation |
| `unknown` | No confident match found |

### Error responses

| Status | code | Cause |
|--------|------|-------|
| 401 | UNAUTHORIZED | No authenticated user |
| 404 | NOT_FOUND | Flag is off |
| 422 | VALIDATION_ERROR | Bad request body |

## Required bindings

- `AI` — Workers AI binding (present when `[ai]` is declared in `wrangler.toml`)

## Model

`@cf/meta/llama-3.3-70b-instruct-fp8-fast`

## Safe disabled behavior

When the flag is off, the endpoint returns 404. The command palette falls back to deterministic search.

## Frontend integration

Check `data.confidence` before acting. When `confidence < 0.5` or `action === 'unknown'`, fall back to showing the regular search results.

## Removal

Drop the `POST /api/cmdk/resolve` handler mount from `src/index.ts` and remove the `cmdk_ai_actions` row from `feature_flags`.


---

## cms_content

# cms_content

The worker-side half of the Payload CMS ↔ generated-site loop. Generated sites
consume an edge-cached blog feed through our own domain, and a publish in the CMS
purges that cache within seconds via an HMAC-signed webhook.

Pairs with the Payload side already shipped: `infra/payload/app/src/hooks/notify-sites.ts`
(the webhook-out) and `infra/payload/app/src/endpoints/blog.ts` (the upstream feed).

## Endpoints

```
GET  /api/cms/blog.json?limit=50      Public (flag-gated). CORS-open, 5-min edge cache.
POST /api/cms/revalidate              Payload notify-sites receiver. HMAC-verified.
```

### GET /api/cms/blog.json

Proxies `cms.projectsites.dev/api/blog.json`, caches the validated result in
`CACHE_KV` for 5 minutes, and serves it CORS-open so any generated site can fetch
it client-side or at build time. Degrades to `{ "count": 0, "posts": [] }` on any
upstream failure — a stale CMS never 500s a consuming site.

### POST /api/cms/revalidate

Receives the `notify-sites` webhook. Verifies `X-PS-Signature`
(`HMAC-SHA256(rawBody, SITES_REVALIDATE_SECRET)`, hex) in constant time, then
purges the cached feed pages.

- Secret unset → `503` (dark-safe; receiver ships ahead of the secret)
- Bad signature → `401`
- Malformed payload → `400`
- Valid → `200 { ok: true, purged: true }`

## Reaching the Access-gated CMS

`cms.projectsites.dev` is behind Cloudflare Access. The service reuses the existing
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` service token (already used for
container builds) as `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers.
Alternatively add a CF Access bypass for the public `/api/blog.json` path.

## Feature flag

Key: `cms_content` — `enabled=0, rollout_percent=0, stage='experimental'`.
When off, both endpoints return `404` (never 403).

## Wire-up

`src/index.ts`:

```ts
import { cmsContent } from '../libs/features/cms_content/handlers.js';
app.route('/', cmsContent);
```

`src/modules/feature_flags/registry.ts` — add a `cms_content` entry.

## Required secret (both sides must match)

```bash
# Generate once, then set the SAME value on the worker and the Payload container:
openssl rand -hex 32
npx wrangler secret put SITES_REVALIDATE_SECRET --env production
# Payload container env: SITES_REVALIDATE_SECRET + SITES_REVALIDATE_URL=https://projectsites.dev/api/cms/revalidate
```

## Safe disabled behavior

Both endpoints 404 when the flag is off. The Payload `notify-sites` hook is itself
a no-op until `SITES_REVALIDATE_URL` is set, so nothing fires before both halves
are configured.


---

## credit_wallet_rollover

# credit_wallet_rollover

Monthly credit wallet that accumulates unused subscription credits up to a 3× monthly cap.
Credits apply toward AI generation and premium features.

## Feature flag

**Key:** `credit_wallet_rollover`  
**Default:** `enabled=0, rollout_percent=0, stage='experimental'`

When the flag is **off**, all routes return **404** (never 403).

## API routes

| Method | Path                     | Auth   | Description                                 |
|--------|--------------------------|--------|---------------------------------------------|
| GET    | `/api/credits/balance`   | Bearer | Current wallet balance + plan metadata      |
| POST   | `/api/credits/apply`     | Bearer | Deduct credits (idempotent via optional key)|
| GET    | `/api/credits/history`   | Bearer | Ledger history, newest first (max 200)      |

## D1 table

### `credit_wallet_ledger`

Append-only double-entry ledger. Positive `amount` = credits added; negative = credits consumed.

| Column            | Type    | Notes                                              |
|-------------------|---------|----------------------------------------------------|
| id                | TEXT PK | UUID                                               |
| org_id            | TEXT    | FK → orgs.id                                      |
| kind              | TEXT    | `earned` \| `rollover` \| `applied` \| `expired`  |
| amount            | INTEGER | Positive for earned/rollover; negative for applied |
| balance_after     | INTEGER | Running balance snapshot after this entry          |
| description       | TEXT    | Human-readable reason (nullable)                   |
| idempotency_key   | TEXT    | Caller-supplied dedup key (nullable, unique)       |
| created_at        | TEXT    | ISO 8601 UTC                                       |

### Balance semantics

- **Balance** = `SUM(amount)` across all ledger rows for the org.
- A `rollover` entry grants `MIN(current_balance + monthly_allowance, 3 × monthly_allowance) − current_balance` credits.
- Credits cannot go below 0; `applyCredits` caps the debit to the available balance.

## Monthly rollover logic

`processMonthlyRollover(env, orgId)` is called once per billing cycle:

1. Resolve monthly allowance from `subscriptions.monthly_credits` (default: 100).
2. Compute cap = `allowance × ROLLOVER_CAP_MULTIPLIER` (3).
3. Grant = `MIN(balance + allowance, cap) − balance`.
4. If grant > 0, insert a `rollover` ledger entry.

Returns the **credits granted this cycle** (0 when the wallet is already at/above
the cap). Read the resulting balance separately via `getBalance` if needed.

## Idempotency

`POST /api/credits/apply` accepts an optional `idempotency_key` (max 128 chars). On retry with the same key the prior result is returned without a second debit.

## Safe disabled behavior

When the flag is off, the billing UI should fall back to showing the base plan credits only. No data is accessible or leaked.

## Removal

1. Drop `credit_wallet_ledger` D1 table via a migration.
2. Remove this module folder.
3. Remove the `app.route` mount from `src/index.ts`.


---

## edge_personalization

# edge_personalization

Flag key: `edge_personalization` | Stage: alpha | Owner: brian@megabyte.space

Rules-based visitor variant selection using geo, device, referrer, time, and return-visitor signals. No PII stored.

## Routes

- `POST /api/personalize/:siteId/variants` — upsert variant rules for a site
- `GET /api/personalize/:siteId/resolve?geo=US&device=mobile&hour=14&isReturn=false` — resolve which variant to show

## D1 Table

`site_personalization_variants` (created in migration 0550).

## Safe disabled behavior

All routes return 404.


---

## feature-flags

# feature-flags — Feature Flags Admin (core surface)

Admin UI for toggling flags, setting rollout %, promoting stages, and managing overrides.

- **Flag key**: `__core__` (sentinel — always enabled)
- **Lifecycle**: `stable`
- **Owner**: brian@megabyte.space

## Tests
- `e2e/features/all-endpoints.spec.ts`
- `e2e/_fortress/feature-flags/` — adversarial attack surface


---

## mcp_oauth_provider

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


---

## native_booking_engine

# native_booking_engine

Self-hosted appointment booking that replaces the Calendly dependency. Tenants define availability slots; visitors reserve appointments stored in D1.

## Feature flag

**Key:** `native_booking_engine`  
**Default:** `enabled=0, rollout_percent=0, stage='experimental'`

When the flag is **off**, all routes return **404** (never 403 — feature existence is not leaked).

## API routes

| Method   | Path                        | Auth   | Description                         |
|----------|-----------------------------|--------|-------------------------------------|
| GET      | `/api/booking/slots`        | Bearer | List available slots for the org    |
| POST     | `/api/booking/reserve`      | Bearer | Reserve a slot (create appointment) |
| DELETE   | `/api/booking/cancel/:id`   | Bearer | Cancel an appointment               |
| GET      | `/api/booking/appointments` | Bearer | List all appointments (owner view)  |

## D1 tables

### `booking_slots`

Availability windows defined by the tenant.

| Column             | Type    | Notes                          |
|--------------------|---------|--------------------------------|
| id                 | TEXT PK | UUID                           |
| org_id             | TEXT    | FK → orgs.id                  |
| site_id            | TEXT    | FK → sites.id                 |
| start_at           | TEXT    | ISO 8601 UTC                   |
| end_at             | TEXT    | ISO 8601 UTC                   |
| duration_minutes   | INTEGER |                                |
| label              | TEXT    | Optional display label         |
| max_bookings       | INTEGER | Default 1                      |
| current_bookings   | INTEGER | Incremented on reserve         |
| deleted_at         | TEXT    | Soft-delete                    |
| created_at / updated_at | TEXT |                              |

### `booking_appointments`

Confirmed (or cancelled) visitor appointments.

| Column         | Type    | Notes                                         |
|----------------|---------|-----------------------------------------------|
| id             | TEXT PK | UUID                                          |
| org_id         | TEXT    | FK → orgs.id                                 |
| site_id        | TEXT    | FK → sites.id                                |
| slot_id        | TEXT    | FK → booking_slots.id                        |
| visitor_name   | TEXT    |                                               |
| visitor_email  | TEXT    |                                               |
| notes          | TEXT    | Optional                                      |
| status         | TEXT    | `confirmed` or `cancelled`                    |
| cancelled_at   | TEXT    | Nullable; set on cancellation                 |
| created_at     | TEXT    |                                               |

## Safe disabled behavior

When the flag is off, the booking widget on generated sites should render nothing (empty div). No data is accessible or leaked.

## Removal

1. Delete `booking_slots` and `booking_appointments` D1 tables via a migration.
2. Remove this module folder.
3. Remove the `app.route` mount from `src/index.ts`.


---

## payments_rail

# payments_rail

Unified payment rail abstracting Stripe and Square into a single API surface.

## Flag key

`payments_rail`

## Rollout defaults

`enabled=0, rollout_percent=0, stage='experimental'`

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/payments/methods` | List stored payment methods for the org |
| POST | `/api/payments/intent` | Create a payment intent (Stripe or Square) |
| GET | `/api/payments/history` | Paginated payment event history |

## D1 tables

- `payments_rail_methods` — stored payment methods per org
- `payments_rail_events` — immutable payment event log (intentId, amountCents, status)

## Safe disabled behavior

When `payments_rail` flag is off, all three routes return `404`. The flag existence is never leaked via a `403`.

## Auth requirements

All routes require a valid session (`userId` must be present). Missing session returns `401`.

## Module files

- `feature.manifest.ts` — manifest with 7 required fields
- `schemas.ts` — Zod schemas for all request/response shapes
- `service.ts` — D1 query helpers for methods + event log
- `handlers.ts` — Hono route handlers
- `__tests__/payments_rail.test.ts` — Jest unit tests (D1 mock pattern)

## E2E coverage

`apps/project-sites/e2e/payments_rail/`

## Owner

brian@megabyte.space


---

## platform_mcp

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


---

## prompt_studio

# prompt_studio

Flag key: `prompt_studio` | Stage: alpha | Owner: brian@megabyte.space

Admin interface for browsing, versioning, and A/B testing prompt templates in the registry.

## Routes

- `GET /api/prompt-studio/templates` — list all registered prompt templates
- `POST /api/prompt-studio/:key/variant` — update A/B variant weights for a prompt
- `POST /api/prompt-studio/:key/rollback` — roll back a prompt to its previous version

## Safe disabled behavior

All routes return 404 when flag is off.


---

## referral_loop

# referral_loop

Viral referral system that credits referrers when their referred user upgrades to paid.

## Feature flag

| Key | Stage | Default |
|-----|-------|---------|
| `referral_loop` | experimental | disabled |

Enable via `/admin/feature-flags`. Do NOT enable in production until the credit
issuance webhook handler is wired and tested end-to-end.

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/referral/code` | Required | Get or create the caller-org referral code |
| POST | `/api/referral/track` | Optional | Record a click on a referral URL |
| GET | `/api/referral/stats` | Required | Caller-org referral stats |

All routes return `404` when the flag is off. `GET /api/referral/code` and
`GET /api/referral/stats` return `401` when called without a valid session.

## D1 tables

- `referral_codes` — one row per org; stores the unique code + click/conversion counters
- `referral_attributions` — one row per click; status progresses `click -> signup -> converted`

Both tables are seeded by migration `0542_native_booking_credit_referral.sql`.

## Credit issuance

Credits are NOT yet issued automatically. The `referral_attributions.status` column
tracks progress. When a referred org upgrades to paid, a Stripe webhook handler
should:

1. Locate the `referral_attributions` row for the org.
2. Update `status = 'converted'` and set `converted_at = datetime('now')`.
3. Increment `referral_codes.conversions`.
4. Insert a `credit_wallet_ledger` row for the referrer org (direction = `credit`).

## Safe disabled behavior

When `referral_loop` is off, all three routes return `404`. No existing data is
modified; the tables remain intact for when the flag is re-enabled.

## Removal

Remove this module, unmount from `src/index.ts`, drop
`referral_codes` + `referral_attributions` tables, and delete the
`referral_loop` feature flag row.


---

## site-create

# site-create — Site Creation (core surface)

Homepage search → select → details → AI workflow pipeline → published site.

- **Flag key**: `__core__` (sentinel — always enabled)
- **Lifecycle**: `beta`
- **Owner**: brian@megabyte.space

## Tests
- `e2e/golden-path.spec.ts`
- `e2e/ai-workflow.spec.ts`
- `e2e/_fortress/site-create/` — adversarial attack surface


---

## site_semantic_search

# site_semantic_search

Flag key: `site_semantic_search` | Stage: alpha | Owner: brian@megabyte.space

Semantic vector search over site content via Vectorize + BGE embeddings.

## Routes

- `POST /api/site-search/:siteId/query` — semantic search over site content
- `POST /api/site-search/:siteId/reindex` — replace all indexed chunks for a site

## Safe disabled behavior

All routes return 404. No vectors are indexed or deleted.


---

## site_thumbnail_grid

# site_thumbnail_grid

Browser-rendered thumbnails for published projectsites.dev sites, cached in R2.

## What it does

- `GET /api/sites/:siteId/thumbnail` checks R2 for a cached PNG thumbnail.
- If found, returns the CDN URL immediately (no generation cost).
- If not found, calls the Cloudflare Browser Rendering screenshot API (1280x720), stores the result in R2, and returns the CDN URL.
- On any error (missing CF credentials, API failure) returns `{ thumbnailUrl: null, generated: false }` — never throws.

## Flag key

`site_thumbnail_grid`

## Rollout defaults

- `enabled: 0`
- `rollout_percent: 0`
- `stage: experimental`

## Safe disabled behavior

When the flag is off the route returns 404. No R2 objects are written. Existing cached thumbnails in R2 remain accessible via CDN directly.

## Required env bindings

- `SITES_BUCKET` — R2Bucket binding (already wired in wrangler.toml)
- `CF_ACCOUNT_ID` — Cloudflare account ID (worker secret)
- `CLOUDFLARE_API_TOKEN` — API token with Browser Rendering permission (worker secret)

## R2 paths

Thumbnails are stored at `thumbnails/{siteId}.png` and served from `https://cdn.projectsites.dev/thumbnails/{siteId}.png`.

## Routes

| Method | Path                          | Auth     |
|--------|-------------------------------|----------|
| GET    | /api/sites/:siteId/thumbnail  | required |

## Register in index.ts

```ts
import { siteThumbnailGrid } from '../libs/features/site_thumbnail_grid/handlers.js';
app.route('/', siteThumbnailGrid);
```


---

## status_page_live

# status_page_live

Public platform health feed and incident management for projectsites.dev.

## What it does

- Exposes `GET /api/status/feed` — a public endpoint returning the overall platform status and open incidents.
- Exposes `POST /api/status/incident` — an authenticated endpoint for creating new incidents.
- Derives overall status from open incidents: any `critical` incident drives `outage`, any `major` drives `degraded`, otherwise `operational`.

## Flag key

`status_page_live`

## Rollout defaults

- `enabled: 0`
- `rollout_percent: 0`
- `stage: experimental`

## Safe disabled behavior

When the flag is off both routes return 404. No incidents are created or served. The D1 table remains intact for when the flag is re-enabled.

## D1 migration

`migrations/0562_status_incidents.sql` — creates the `status_incidents` table.

## Routes

| Method | Path                 | Auth     |
|--------|----------------------|----------|
| GET    | /api/status/feed     | public   |
| POST   | /api/status/incident | required |

## Register in index.ts

```ts
import { statusPageLive } from '../libs/features/status_page_live/handlers.js';
app.route('/', statusPageLive);
```


---

## storefront_ecommerce

# storefront_ecommerce

AI-generated product catalog and storefront with cart state backed by KV.

## Flag key

`storefront_ecommerce`

## Rollout defaults

`enabled=0, rollout_percent=0, stage='experimental'`

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/storefront/catalog` | Paginated product catalog for a site |
| GET | `/api/storefront/products/:id` | Single product detail with related IDs |
| POST | `/api/storefront/cart` | Upsert cart (create or update lines) |

## Storage

- `storefront_products` (D1) — product catalog rows per org/site
- KV `cart:{cartId}` — ephemeral cart state with 24h TTL (`expirationTtl: 86400`)

## Safe disabled behavior

When `storefront_ecommerce` flag is off, all three routes return `404`. No `403` — flag existence is never leaked.

## Auth requirements

All routes require a valid session (`userId` must be present). Missing session returns `401`.

## Cart semantics

- `POST /api/storefront/cart` with no `cartId` creates a new cart and returns a fresh UUID.
- Re-posting with an existing `cartId` replaces the cart lines entirely (upsert).
- Carts expire 24 hours after the last write.
- `siteId` is derived from the first product resolved — all products in a cart must belong to the same site.

## Module files

- `feature.manifest.ts` — manifest with 7 required fields
- `schemas.ts` — Zod schemas for catalog, product, and cart shapes
- `service.ts` — D1 catalog queries + KV cart helpers
- `handlers.ts` — Hono route handlers
- `__tests__/storefront_ecommerce.test.ts` — Jest unit tests (D1 + KV mock pattern)

## E2E coverage

`apps/project-sites/e2e/storefront_ecommerce/`

## Owner

brian@megabyte.space


---

## unified_inbox

# unified_inbox

Big-bets feature #24 — Unified Visitor Inbox. All inbound visitor contact
channels (forms, live chat, voice, email, SMS) are resolved to a single
visitor identity and surfaced in a 3-pane admin UI.

## What it does

- **Cross-channel identity resolution** — `visitor_identities` table matches
  by email, phone, visitor_id, or anon_id across channels.
- **Conversations + messages** — append-only `messages` table; each
  conversation has `assignee_user_id`, `status`, `sla_deadline`.
- **Channel-native replies** — `POST .../reply` dispatches via the original
  channel (form email via Resend, SMS via Twilio, chat via SSE).
- **AI drafts** — `POST .../draft-with-ai` uses Workers AI Llama to suggest
  a reply based on conversation context.
- **3-pane admin** — `/admin/inbox`: list (left) + thread (center) + controls
  (right). Rolling-counter stats, appReveal sections, keyboard nav.

## Where surfaces live

| Surface | Path |
|---------|------|
| Worker routes | `src/routes/inbox.ts` |
| Inbox service | `src/services/inbox.ts` |
| Identity resolver | `src/services/visitor_identity.ts` |
| D1 migration | `migrations/0511_inbox.sql` (visitor_identities, conversations, messages) |
| Angular component | `frontend/src/app/pages/admin/sections/inbox.component.ts` |

## Flag key

`unified_inbox` — default off. Companion feature: `multimodal_copilot` (#25).

## Tests

| Suite | Count | Files |
|-------|-------|-------|
| E2E | 12 tests | `e2e/inbox/inbox.spec.ts` |
| E2E fortress happy | 7 tests | `e2e/_fortress/unified_inbox/happy-path.spec.ts` |
| E2E fortress adversarial | 8 tests | `e2e/_fortress/unified_inbox/adversarial.spec.ts` |
| Unit | **0** | DRIFT — `src/__tests__/inbox.test.ts` missing |

## Drift notes

- **No unit tests** — needs `src/__tests__/inbox.test.ts` covering
  `resolveOrCreateIdentity`, `listConversations`, `appendMessage`, `draftReplyWithAI`.
- SLA timer logic is not yet enforced — `sla_deadline` is set but no cron
  fires on breach (needs a `scheduled` handler or Workflow alarm).
- Push notifications on new conversation not yet wired.

## SLA behavior

Default SLA = 24 h from first message. Overridable per conversation. No
automated escalation yet (see Drift notes).

## How to enable for testing

```bash
curl -X POST https://projectsites.dev/api/super-admin/feature-flags/unified_inbox/override \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -d '{"org_id":"<your_org>","enabled":1}'
```

## Removal

See `removalNotes` in `feature.manifest.ts`.


---

## url_clone_seed

# url_clone_seed

Seeds a new site draft by extracting content from a source URL via Cloudflare Browser Rendering.

## Flag

Key: `url_clone_seed`
Default: disabled (`enabled=0, rollout=0, stage='experimental'`)

## API

| Method | Path | Auth |
|--------|------|------|
| POST | /api/clone/seed | Bearer JWT (userId required) |

### Request

```json
{
  "url": "https://example.com",
  "siteId": "site-abc-123"
}
```

### Response (200)

```json
{
  "ok": true,
  "data": {
    "title": "Example Domain",
    "description": "This domain is for use in illustrative examples.",
    "textLength": 1234,
    "extractedAt": "2026-06-17T00:00:00.000Z"
  }
}
```

### Error responses

| Status | code | Cause |
|--------|------|-------|
| 401 | UNAUTHORIZED | No authenticated user |
| 404 | NOT_FOUND | Flag is off |
| 422 | VALIDATION_ERROR | Bad request body |
| 502 | EXTRACTION_FAILED | Browser Rendering API failed or timed out |

## Required secrets

- `CF_ACCOUNT_ID` — Cloudflare account ID for the Browser Rendering API
- `CF_API_TOKEN` — CF API token with `Browser Rendering: Read` permission

## Safe disabled behavior

When the flag is off, the endpoint returns 404. No content is exposed.

## Removal

Drop the `POST /api/clone/seed` handler mount from `src/index.ts` and remove the `url_clone_seed` row from `feature_flags`.


---

## visual_point_edit

# visual_point_edit

AI-powered in-place node patching for published sites.

## Flag key

`visual_point_edit` — default `enabled=0, rollout=0, stage='experimental'`

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/editor/point-edit` | Bearer required | Patch a DOM node via plain-language instruction |

### Request body

```json
{ "nodeId": "#hero-h1", "instruction": "Make the text uppercase", "siteId": "site-abc-001" }
```

### Response

```json
{ "ok": true, "patched": true, "node": "#hero-h1" }
```

## Safe disabled behavior

Route returns `404` when the flag is off. The feature's existence is never revealed.

## Removal

Delete `handlers.ts`, `service.ts`, `schemas.ts`, `feature.manifest.ts` and remove the
`app.route('/api/editor/point-edit', visualPointEdit)` mount in `src/index.ts`.


---

## wireframe_planning

# wireframe_planning

Feature module that generates and stores a structured wireframe plan (ordered section list) for a site before AI site generation runs.

## Feature flag

**Key:** `wireframe_planning`
**Default:** `enabled=0, rollout_percent=0, stage=experimental`

All routes return `404` when the flag is off. Never `403` — do not leak feature existence.

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/wireframe/plan` | Required | Create a wireframe plan for a site |
| `GET` | `/api/wireframe/:siteId` | Required | Fetch the latest wireframe plan for a site |

### POST /api/wireframe/plan

**Request body:**
```json
{ "siteId": "site_abc123", "prompt": "A modern plumbing company site" }
```

- `siteId` — required, non-empty string
- `prompt` — required, minimum 10 characters

**Response (201):**
```json
{
  "ok": true,
  "plan": {
    "id": "uuid",
    "siteId": "site_abc123",
    "prompt": "A modern plumbing company site",
    "sections": ["Hero", "About", "Services", "Contact"],
    "createdAt": "2026-06-17T00:00:00.000Z"
  }
}
```

### GET /api/wireframe/:siteId

Returns the most-recent plan for the site, or `{ ok: true, plan: null }` when none exists.

## D1 table

`wireframe_plans` — see `migrations/0560_wireframe_plans.sql`.

## Safe disabled behavior

When the flag is off:
- Both routes return `404 Not Found`
- The generation pipeline falls back to prompt-only layout (no wireframe consumed)
- No data is read or written

## Tests

Unit tests: `__tests__/wireframe_planning.test.ts`
E2E tests: `e2e/wireframe_planning/wireframe_planning.spec.ts` (pending)
