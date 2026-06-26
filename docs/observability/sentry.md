# Sentry Observability Guide

Full-stack error tracking for `projectsites.dev` — Cloudflare Worker (HTTP API via `services/sentry.ts`) + Angular SPA (`@sentry/angular` via `sentry.service.ts`).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SENTRY_DSN` | Yes (prod) | DSN from the Sentry project settings page. Safe to expose to the browser (authenticates inbound events only). |
| `SENTRY_RELEASE` | Recommended | Short git SHA or semver (e.g. `project-sites@1.2.3` or `abc1234`). Set in `wrangler.toml [env.production.vars]` at deploy time. Groups events by deploy in the Sentry UI. |
| `SENTRY_ENVIRONMENT` | Auto-derived | Derived from `ENVIRONMENT` (Worker) / hostname (SPA). Values: `production`, `staging`, `development`. |

### Setting secrets

```bash
# Worker secret
wrangler secret put SENTRY_DSN --env production

# Release tag (set in wrangler.toml vars, not as a secret — not sensitive)
# [env.production.vars]
# SENTRY_RELEASE = "project-sites@1.2.3"
```

---

## What Is Captured

### Worker (`services/sentry.ts` + `lib/sentry.ts`)

| Surface | What fires |
|---|---|
| Every request | Breadcrumb: `http` category, method + path + requestId |
| 5xx responses | `captureException` via `error_handler.ts` |
| Unhandled exceptions | `captureException` via `error_handler.ts` |
| AppError (≥500) | `captureException` + PostHog `trackError` |
| Manual risky ops | `captureError(c, err, {...})` from any service |
| Performance | `TransactionCollector` spans (D1 queries, external fetches) via `sendTransaction` |

The Toucan SDK (`lib/sentry.ts`) creates a per-request client scoped to the Hono context. Every breadcrumb, tag, and user identity added during the request attaches automatically to any exception captured in the same request.

### SPA (`frontend/src/app/services/sentry.service.ts`)

| Surface | What fires |
|---|---|
| All unhandled errors | `CompositeErrorHandler` → `Sentry.createErrorHandler()` |
| HTTP errors | `sentryBreadcrumbInterceptor` — breadcrumb per request/response |
| Router navigations | `Sentry.TraceService` — navigation transaction per route |
| Auth login | `SentryService.setUser({ id, org_id, email_hash })` |
| Explicit captures | `SentryService.captureException(err, { extra })` |

---

## What Is Scrubbed (Never Sent to Sentry)

The `beforeSend`-equivalent `scrubSentryEvent()` function in `services/sentry.ts` runs on every event before transmission:

| Header | Replacement |
|---|---|
| `Authorization` | `[Filtered]` |
| `Cookie` | `[Filtered]` |
| `Set-Cookie` | `[Filtered]` |
| `Stripe-Signature` | `[Filtered]` |
| `X-Auth-Key` | `[Filtered]` |
| `X-Auth-Email` | `[Filtered]` |
| `X-API-Key` | `[Filtered]` |
| `X-Forwarded-For` | `[Filtered]` |

Breadcrumb `data` objects are also scanned and any key matching the above list is replaced with `[Filtered]`.

On the SPA side:
- `sendDefaultPii: false` — Sentry SDK strips IPs, cookies, and user agent automatically.
- Email is one-way hashed (SHA-256, first 16 hex chars) before being sent as `email_hash`. The raw email never leaves the browser.
- Request bodies are **never** included in HTTP breadcrumbs — only method, path (no query string), status, and duration.

---

## Architecture

### Worker flow

```
Request
  │
  ├─ requestIdMiddleware          → sets requestId in context
  │
  ├─ Sentry middleware (index.ts) → getRequestSentry(c) → tags route/method/requestId
  │                                 addBreadcrumb(c, { category:'http', ... })
  │
  ├─ Route handler
  │   └─ (risky op)               → captureError(c, err, { extra })
  │
  └─ errorHandler                 → captureError(c, err) on 5xx / unknown
                                    → scrubSentryEvent() before HTTP send
                                    → POST https://{dsn.host}/api/{projectId}/store/
```

### SPA flow

```
bootstrap
  │
  ├─ initSentryEarly()            → reads <meta name="x-sentry-dsn"> injected by Worker
  │                                 Sentry.init({ dsn, environment, release, beforeSend })
  │
  ├─ APP_INITIALIZER               → inject(Sentry.TraceService) — router nav transactions
  │
  ├─ sentryBreadcrumbInterceptor  → HttpClient breadcrumb per request/response
  │
  └─ CompositeErrorHandler        → GlobalErrorHandler (toast + logs + SentryService.captureException)
                                    + Sentry.createErrorHandler() (belt-and-suspenders)
```

The Worker injects two meta tags into every served `marketing/index.html`:

```html
<meta name="x-sentry-dsn"   content="https://pub…@o….ingest.sentry.io/…">
<meta name="x-app-release"  content="project-sites@1.2.3">
```

`initSentryEarly()` reads both before Angular bootstraps.

---

## Verify Locally

### Worker

```bash
cd apps/project-sites

# Run the unit tests that assert PII scrubbing
npm test -- --testPathPattern="sentry-scrubbing"

# Run all Sentry-related tests
npm test -- --testPathPattern="sentry"
```

Expected output: all tests green, no `Authorization`/`Cookie`/`Stripe-Signature` values in captured payloads.

### SPA (Karma + Jasmine)

```bash
cd apps/project-sites/frontend
npm test
```

Look for the `SentryService` and `GlobalErrorHandler` suites — both must pass.

### Playwright E2E

```bash
cd apps/project-sites

# Smoke against prod
PROD_URL=https://projectsites.dev npx playwright test e2e/sentry-crash.spec.ts

# Smoke against local dev
PROD_URL=http://localhost:4200 npx playwright test e2e/sentry-crash.spec.ts
```

### Verify a real event reaches Sentry

```bash
# Using sentry-cli (install: npm install -g @sentry/cli)
sentry-cli --dsn "$SENTRY_DSN" send-event \
  --message "Manual test from sentry.md verification step" \
  --level warning

# Then open: https://sentry.io/organizations/<org>/issues/
# Look for the "Manual test from sentry.md verification step" event.
```

### Verify in production (curl)

```bash
# Check the DSN meta is injected
curl -s https://projectsites.dev/ | grep 'x-sentry-dsn'
# Expected: <meta name="x-sentry-dsn" content="https://...">

# Check the release meta is injected
curl -s https://projectsites.dev/ | grep 'x-app-release'
# Expected: <meta name="x-app-release" content="project-sites@...">
```

---

## Sample Rate Configuration

| Surface | Traces | Replays (session) | Replays (on error) |
|---|---|---|---|
| Production | 10% | 1% | 100% |
| Staging / Preview | 100% | 10% | 100% |
| Development | 100% | 10% | 100% |

Adjust in `frontend/src/app/services/sentry.service.ts` (`Sentry.init` call) and `lib/sentry.ts` (`getRequestSentry` factory).

---

## Gotchas

- **DSN empty on dev** — the Worker only injects `SENTRY_DSN` when the secret is provisioned. The SPA no-ops gracefully when the meta content is empty.
- **Toucan vs HTTP API** — `lib/sentry.ts` uses Toucan (Workers-compatible Sentry SDK). `services/sentry.ts` uses the raw HTTP store API. Both are real; `lib/sentry.ts` is the per-request Hono integration; `services/sentry.ts` is used from queue/workflow handlers and service-level calls that don't have a Hono context.
- **`SENTRY_RELEASE` is a var, not a secret** — it's a short git SHA, not sensitive. Set it in `wrangler.toml [env.production.vars]`, not via `wrangler secret put`.
- **No `Sentry.configureScope` in Workers** — Toucan is per-request; use `getRequestSentry(c).setUser(...)` from `lib/sentry.ts`.
