# Structured Logging

Reference for `apps/project-sites/src/lib/log.ts` (Worker) and `frontend/src/app/services/logger.service.ts` (SPA).

## Log levels

| Level | When it fires |
|---|---|
| `error` | Always — unrecoverable failures, API errors |
| `warn` | Always — retries, fallbacks, unexpected-but-handled |
| `info` | Always in dev/test; sampled 1-in-N in production (see `LOG_INFO_SAMPLE`) |
| `debug` | Only when `LOG_LEVEL=debug` or `NODE_ENV !== production` |

## Output formats

### Production (Workers / Node `NODE_ENV=production`)

One JSON line per call, parsed by Wrangler Tail, Axiom, and PostHog:

```json
{
  "ts": "2026-05-28T14:23:01.123Z",
  "level": "warn",
  "scope": "project-sites/external_llm",
  "msg": "circuit_open",
  "eventName": "circuit_open",
  "service": "project-sites",
  "env": "production",
  "provider": "openai",
  "count": 5
}
```

- `eventName` is an alias for `msg` — kept for backward compatibility with existing log queries.
- `scope` is slash-separated: root scope is `project-sites`, children append `/child-name`.

### Local dev (colorized ANSI)

```
[14:23:01] WARN project-sites/billing · checkout_failed · {"code":"card_declined"}
```

No extra dependencies — pure ANSI escape codes.

### Test (Jest / Vitest)

JSON mode (same as production) so `captureWarn()` helpers can parse output.

## Correlation

Every call that passes a Hono `Context` auto-extracts:

- `requestId` — from `c.get('requestId')` (set by `requestIdMiddleware`)
- `userId` — from `c.get('userId')` (set by `authMiddleware`)
- `orgId` — from `c.get('orgId')` (set by `authMiddleware`)
- `env` — from `c.env.ENVIRONMENT`

Example:

```ts
log.warn('rate_limit_exceeded', { path: c.req.path }, c);
// → { ..., requestId: 'abc', userId: 'u_123', orgId: 'o_456', env: 'production' }
```

## Scoped child loggers

Every service creates a child logger at module level. Child loggers prepend their
scope to every entry, making it trivial to grep by service area.

```ts
// src/services/billing.ts
import { log } from '../lib/log.js';
const billingLog = log.child('billing');

// src/services/external_llm.ts
const llmLog = log.child('external_llm');

billingLog.info('checkout_started', { status: 200 });
// → { scope: 'project-sites/billing', ... }
```

Nesting is supported: `log.child('a').child('b')` produces `scope: 'project-sites/a/b'`.

## Redaction

Two layers guarantee secrets never reach Wrangler Tail, Axiom, or PostHog:

### Layer 1 — Allowlist

Only keys present in `SAFE_FIELD_ALLOWLIST` pass through. Everything else is silently dropped.
Safe keys include: `service`, `env`, `requestId`, `userId`, `orgId`, `siteId`, `slug`, `path`,
`method`, `status`, `durationMs`, `attempt`, `provider`, `event_id`, `error`, `message`,
`cause`, `code`, `route`, `count`, `success`, `ok`, `total`, plus scope-specific extras.

### Layer 2a — Sensitive key name

Any key matching `/(authorization|cookie|token|secret|password|key|stripe-signature)/i`
has its value replaced with `[REDACTED]` regardless of allowlist membership.

This catches: `Authorization`, `cookie`, `token`, `api_key`, `stripe-signature`,
`access_token`, `refresh_token`, `password`, `client_secret`, etc.

### Layer 2b — Secret value pattern

Even allowlisted keys get their value replaced with `[REDACTED]` if the value looks
like a known secret format:

| Pattern | Example |
|---|---|
| Stripe secret key | `sk_live_xxx` |
| Stripe restricted key | `rk_live_xxx` |
| Stripe webhook secret | `whsec_xxx` |
| Resend API key | `re_xxxxx` |
| SendGrid key | `SG.xxx.xxx` |
| Slack token | `xoxb-xxx` |
| GitHub PAT | `ghp_xxx` |
| GitHub OAuth | `gho_xxx` |
| Bearer token | `Bearer xxx` |
| JWT | `aaa.bbb.cccc` |

## Sampling

In production, `info`-level calls can be sampled to reduce log volume:

```
# wrangler.toml [vars] — or Workers Secrets for dynamic override
LOG_INFO_SAMPLE = "10"   # emit 1 in 10 info calls
LOG_INFO_SAMPLE = "1"    # emit all (default)
```

`error` and `warn` are always emitted regardless of sampling.

## Enabling debug

```
# wrangler.toml [vars]
LOG_LEVEL = "debug"
```

Or set in the shell before `wrangler dev`:

```sh
LOG_LEVEL=debug npx wrangler dev
```

## Frontend SPA logger

`LoggerService` (`frontend/src/app/services/logger.service.ts`) mirrors the Worker API:

```ts
import { LoggerService } from './logger.service';

@Component({ ... })
export class MyComponent {
  private log = inject(LoggerService).child('my-feature');

  doThing() {
    this.log.info('thing_started', { siteId: '...' });
  }
}
```

- Production: emits `console.warn(payload)` as a plain object — Sentry breadcrumb hooks
  intercept it automatically via `GlobalErrorHandler`.
- Dev (`isDevMode()`): styled `%c` console output with colour per level.
- `debug` is suppressed in production.
- Redaction: key-name pattern guard (`authorization`, `cookie`, `token`, `secret`,
  `password`, `key`, `stripe-signature`) replaces values with `[REDACTED]`.

## Good vs bad log examples

### Good

```ts
// Correlation via Hono context
log.info('webhook_received', { event_id: evt.id, provider: 'stripe' }, c);

// Error with enough context to diagnose
log.error('payment_failed', { code: err.code, status: 402 }, c);

// Child logger — scope is automatic
const billingLog = log.child('billing');
billingLog.warn('retry_attempt', { attempt: 2, max: 3 });
```

### Bad

```ts
// Never log raw objects that might contain tokens
console.warn(JSON.stringify({ authorization: req.headers.authorization })); // leaks Bearer token

// Never log full request/response bodies
log.info('request_body', { body: JSON.stringify(reqBody) }); // body not in allowlist → dropped, but wasteful

// Never use console.log (blocked by ESLint)
console.log('debug info');

// Never log inside tight loops
for (const row of rows) {
  log.debug('processing_row', { id: row.id }); // O(n) calls — use a summary after the loop
}

// Good alternative to the loop above
log.info('batch_processed', { count: rows.length });
```

## Files

| Path | Purpose |
|---|---|
| `src/lib/log.ts` | Worker logger — `Logger` interface, `log` singleton, `requestLogger` middleware |
| `src/__tests__/log.test.ts` | Unit tests: JSON emission, redaction (key + value patterns), child scope, debug suppression, middleware |
| `frontend/src/app/services/logger.service.ts` | Angular `LoggerService` — injectable, `child()` scoping, dev `%c` styling |
