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

---

# site_doctor — Owner Health Report

Owner-facing A–F health report with prioritized, plain-English fixes. Translates
the production-readiness signals into language a non-technical owner acts on.

## Feature flag

`site_doctor` — default `enabled=0, rollout=0, stage=experimental`. Owner: brian@megabyte.space.
Depends on `prod_readiness_score` (reuses its ownership check + signal computation).

## Generous-free lock

Failing signals → issues sorted by severity. FREE plan unlocks only the top issue;
the rest carry `locked:true` (`locked_count` drives the upsell). PAID (`starter`/`pro`)
unlock everything. Voice: sharp & professional.

## API route

- `GET /api/sites/:siteId/doctor?plan=free|starter|pro` — A–F report + prioritized fixes
  (401 unauth · 404 flag-off · 404 not-owned).

## Safe disabled behavior

Route returns `404` when the flag is off. The scoring + lock core (`service.ts`) is pure
(no env/IO); unknown signal names fall back to a low-severity issue (forward-compatible).

## Removal

Remove this module, the `app.route()` mount in `src/index.ts`, and the `site_doctor`
entry in `src/modules/feature_flags/registry.ts`. No tables owned.

## Tests

Unit tests: `__tests__/site_doctor.test.ts` (12 — scoring/grades/severity/free-lock/schema/flag)
E2E tests: `e2e/site_doctor/` (pending — needs the owner dashboard surface)

---

# preview_share_card — Instant Preview Share Card (#55)

Owner-driven viral loop. After a build, the owner gets honest pre-written share
messages (SMS / WhatsApp / email / copy), one-tap platform deep-links (SMS,
WhatsApp, mailto, X, Facebook), and OG-card params for a branded 1200×630 card —
so they share their new site to real customers in seconds. The shared link is the ad.

## Flag

`preview_share_card` — default `enabled=0, rollout=0, stage=experimental`. Owner: brian@megabyte.space.

## Route

`GET /api/sites/:siteId/share-card` — owner-auth; 404 when the flag is off or the
site is not owned by the caller org (no existence leak). Returns `{ messages, links, og }`.

## Core

`src/services/preview_share_card.ts` — `buildPreviewShareCard` (messages + deep-links
+ OG params), pure, slop-free, XSS-safe. The module `service.ts` derives the canonical
preview URL (`{slug}.projectsites.dev`) via `buildShareCardForSite`.

## Safe disabled behavior

Server returns 404 (never 403). No tables owned.

## Remaining wiring (beta gate)

Build-complete "Share my preview" button (frontend) + the workers-og `/og` render
endpoint. (Custom-hostname preview URL — DONE 2026-06-29: the endpoint resolves the
active primary/custom hostname and shares that branded URL over the slug subdomain.)

## Tests

Unit: `__tests__/preview_share_card.test.ts` (6 — URL derivation/tagline/empty-slug/flag/schema)
plus the core's `src/__tests__/preview_share_card.test.ts` (11). E2E: pending the share button.
