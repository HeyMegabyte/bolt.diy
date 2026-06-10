# API Reference — projectsites.dev Worker

Canonical shapes, conventions, known inconsistencies, and internal route authentication for all Hono routes in the Project Sites Worker.

---

## Conventions

### Response envelopes

**Success**
```json
{ "data": <payload>, "meta": { "cursor": "…", "has_more": true } }
```
`meta` is omitted when there is no pagination context.

**Error**
```json
{ "error": { "code": "RATE_LIMITED", "message": "…", "request_id": "req_…", "details": [] } }
```

### Status codes

| Code | Meaning |
|------|---------|
| 200 | OK (GET / idempotent mutations) |
| 201 | Created |
| 204 | No content (DELETE) |
| 400 | Validation error |
| 401 | Missing / invalid bearer token |
| 403 | Authenticated but forbidden |
| 404 | Not found (also used as kill-switch for flag-gated routes) |
| 409 | Conflict (duplicate resource) |
| 413 | Payload too large |
| 422 | Semantic validation failure |
| 429 | Rate limited |
| 500 | Internal error |
| 503 | Upstream dependency unavailable |

### Stable error codes

`BAD_REQUEST` · `UNAUTHORIZED` · `FORBIDDEN` · `NOT_FOUND` · `CONFLICT` · `PAYLOAD_TOO_LARGE` · `RATE_LIMITED` · `VALIDATION_ERROR` · `INTERNAL_ERROR` · `WEBHOOK_SIGNATURE_INVALID` · `WEBHOOK_DUPLICATE` · `STRIPE_ERROR` · `DOMAIN_PROVISIONING_ERROR` · `AI_GENERATION_ERROR` · `SERVICE_UNAVAILABLE`

### Pagination

**New routes** — cursor-based:

| Parameter | Default | Max |
|-----------|---------|-----|
| `limit` | 50 | 200 |
| `cursor` | — | opaque base64url token |

Response includes a `Link` header per RFC 8288 and `meta.cursor` / `meta.has_more`.

**Legacy routes** — offset/limit (deprecated, migrating in next sprint):
- `GET /api/admin/domains`
- `GET /api/audit-logs`
- `GET /api/sites/:id/logs`
- `GET /api/sites`

### Rate limiting

Headers returned on every response:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 47
X-RateLimit-Reset: 1716412800
Retry-After: 30   (only on 429)
```

### CORS

- `/api/v1/forms/submit` — wildcard (`*`), public form ingest endpoint.
- All other `/api/*` routes — allowed-list only (projectsites.dev family + configured custom domains).

### Request / response headers

| Header | Direction | Purpose |
|--------|-----------|---------|
| `Authorization: Bearer <token>` | Request | Auth on every protected route |
| `X-Request-ID` | Both | Correlation; echoed from client or generated |
| `Content-Type: application/json` | Both | Required on mutation bodies |
| `X-RateLimit-*` | Response | Rate limit state |

---

## Known Inconsistencies

Status as of 2026-05-28. Middleware (`standardizeResponseMiddleware`) auto-wraps 48 legacy handlers at the edge; 4 Stripe webhook receipts carry `skipStandardize` intentionally.

### Open source-cleanup items (next sprint)

**28 bare-string error returns** — in `src/routes/api.ts`, `search.ts`, `cx.ts`, `src/index.ts`. Need refactoring to typed helpers (`throw badRequest()` / `throw notFound()` etc.) so the stable error code is always present.

**13 `{ error: { message } }` responses missing `code`** — in `ai_admin.ts`, `ai_endpoints_public.ts`, `mcp_oauth.ts`. Must add `code` field from the stable code list.

**4 legacy offset/limit pagination routes** — documented above. New routes use cursor; legacy migration deferred to next sprint.

### Intentional opt-outs

**3 Stripe webhook receipts** — `{ received: true }` shape is Stripe-spec; `skipStandardize` applied, do not change.

**4 bare `{ ok: true }` responses** — auto-wrapped by `standardizeResponseMiddleware` to `{ data: { ok: true } }` at the edge; source cleanup deferred.

---

## Internal Routes

Routes under `/api/internal/*` are authenticated by HMAC-SHA256, not bearer tokens. They are called only by containers and background jobs — never by the SPA.

### Authentication

```
POST /api/internal/<route>
X-Internal-Sig: <hex-encoded HMAC-SHA256(INTERNAL_BUILD_SECRET, raw-body)>
```

Legacy alias: `X-Build-Sig` (accepted, deprecated).

Failures:
- `401 INTERNAL_SIG_MISSING` — header absent.
- `401 INTERNAL_SIG_INVALID` — signature mismatch.

Middleware: `src/middleware/internal_hmac.ts`, wired via `app.use('/api/internal/*', internalHmacMiddleware)`.

### Routes

| Route | Caller | Purpose |
|-------|--------|---------|
| `POST /api/internal/build-status` | Container | Push build progress to KV |
| `POST /api/internal/client-error` | Browser SDK | Forward JS errors to Sentry |

Note: `/api/internal/client-error` does **not** enforce HMAC (it originates in the browser). It should be moved out of the `/api/internal/` prefix in a future refactor.

### Secret rotation

Rotate `INTERNAL_BUILD_SECRET` quarterly. Update the Worker secret and the container image environment variable in lock-step — they must match at all times.

```bash
npx wrangler secret put INTERNAL_BUILD_SECRET --env production
# Then rebuild + redeploy the container image with the new value.
```
