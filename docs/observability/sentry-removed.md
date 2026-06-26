# Sentry Removed

Sentry has been fully removed from the projectsites.dev stack. This document records what was removed, what replaced each capability, and the migration checklist.

---

## What Was Removed

| Artifact | Description |
|---|---|
| `SENTRY_DSN` | Worker secret / env var pointing to the Sentry ingest endpoint |
| `SENTRY_RELEASE` | Release tag injected at build time for source map association |
| `@sentry/cloudflare` | npm package providing the Workers SDK |
| `withSentry()` wrapper | Hono middleware that auto-captured exceptions and created transactions |
| `Sentry.init()` call | Bootstrap in `src/index.ts` |
| `Sentry.captureException()` calls | Manual exception capture scattered across service files |
| `Sentry.startSpan()` / `Sentry.startTransaction()` | Manual performance instrumentation |
| Source map upload step | CI step that uploaded build artifacts to Sentry for stack trace de-minification |
| Sentry DSN in wrangler.toml | `[vars]` entry `SENTRY_DSN` |
| Sentry alert rules | All alert configurations in the Sentry project dashboard |
| Sentry performance dashboards | Custom dashboards referencing Sentry transaction data |

---

## Replacement Map

| Sentry Feature | Replacement | Details |
|---|---|---|
| Exception / error tracking | PostHog error capture | `posthog.capture({ event: '$exception', properties: { $exception_type, $exception_message, $exception_stacktrace, trace_id } })` |
| Automatic unhandled exception capture | Hono `onError` handler → PostHog + Axiom | `app.onError((err, c) => { /* capture to PostHog, log to Axiom */ })` |
| Performance tracing (transactions, spans) | OpenTelemetry Workers Tracing + Axiom | `wrangler.toml [observability] enabled = true` + manual OTel spans |
| Distributed tracing / trace IDs | OTel `traceparent` header propagation | Trace ID flows from Worker → D1 → AI calls → all log lines |
| Breadcrumbs | Structured Axiom log lines with `trace_id` | Query `['project-sites'] | where trace_id == "..."` in Axiom Play |
| Session replays | PostHog session recording | Enabled via PostHog JS snippet on the frontend |
| Alerts on error rate | PostHog alerts | Configure alert on `$exception` event threshold in PostHog |
| Release tracking | Conventional commits + CF Worker version in Axiom logs | `service_version` field on every log line |
| User context on errors | PostHog `$identify` + `tenant_id` on every event | `distinct_id` = `user_id`; `tenant_id` property on every capture |
| Source maps for stack traces | PostHog source map upload (optional) | Upload via PostHog CLI or CI step to `https://us.i.posthog.com/` |
| Issue grouping / deduplication | PostHog error tracking (beta) | Groups `$exception` events by type + message fingerprint |

---

## Migration Checklist

- [x] Removed `@sentry/cloudflare` from `package.json` and ran `npm install`
- [x] Removed `Sentry.init()` call from `apps/project-sites/src/index.ts`
- [x] Removed `withSentry()` Hono middleware wrapper
- [x] Removed all `Sentry.captureException()` call sites
- [x] Removed all `Sentry.startSpan()` and `Sentry.startTransaction()` call sites
- [x] Removed `SENTRY_DSN` from `wrangler.toml` `[vars]` section
- [x] Removed `SENTRY_RELEASE` from CI build steps
- [x] Deleted `apps/project-sites/src/lib/sentry.ts` (Sentry bootstrap module)
- [x] Replaced `src/lib/sentry.ts` imports with PostHog + Axiom equivalents
- [x] Added `app.onError()` handler capturing to PostHog `$exception` event
- [x] Added Axiom structured log middleware (request/response logging)
- [x] Added OTel `[observability]` to `wrangler.toml`
- [x] Added `POSTHOG_API_KEY`, `AXIOM_API_KEY`, `AXIOM_DATASET` to Worker secrets
- [x] Deleted `SENTRY_DSN` Worker secret via `wrangler secret delete SENTRY_DSN --env production`
- [x] Deleted `SENTRY_RELEASE` Worker secret (if set)
- [x] Removed Sentry source map upload from `.github/workflows/`
- [x] Verified PostHog receives `$exception` events on test error
- [x] Verified Axiom receives structured logs with `trace_id`
- [x] Verified OTel spans appear in Axiom under the correct dataset

---

## Why Sentry Was Removed

- Vendor consolidation: PostHog covers product analytics + errors + session replay in one platform.
- OTel + Axiom covers distributed tracing and structured logs with better Cloudflare Workers integration.
- `@sentry/cloudflare` added ~40 KB to the Worker bundle and required wrapping the Hono app.
- PostHog `$exception` events correlate with user identity, session, and feature flag state natively — Sentry required manual context attachment.

---

## Related Docs

- [PostHog setup](./posthog.md)
- [Axiom setup](./axiom.md)
- [OTel / Workers Tracing](./otel.md)
- [Observability overview](./README.md)
