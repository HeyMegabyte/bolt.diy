# PostHog

PostHog Cloud is the primary product analytics platform for projectsites.dev. It handles event funnels, conversion tracking, feature flag evaluation, session recording, and error capture.

---

## Configuration

### Environment Variables

| Variable | Description | Example Value |
|---|---|---|
| `POSTHOG_API_KEY` | Server-side project API key (write-only) | `phc_...` |
| `POSTHOG_PUBLIC_KEY` | Front-end snippet key (same as API key for PostHog Cloud) | `phc_...` |
| `POSTHOG_HOST` | Ingestion host — always use the US region URL, NOT `app.posthog.com` | `https://us.i.posthog.com` |

> **Important:** The ingestion endpoint is `https://us.i.posthog.com`, not `https://app.posthog.com`. Using `app.posthog.com` for event capture will silently route through an extra redirect and adds latency.

### wrangler.toml (Worker secrets)

```toml
# Set via wrangler secret put, not in wrangler.toml plaintext
# wrangler secret put POSTHOG_API_KEY --env production
# wrangler secret put POSTHOG_HOST --env production
```

---

## Server-Side Event Capture

The Worker sends events directly to the PostHog ingestion API via `fetch`. There is no PostHog Node.js SDK in the Worker — the SDK adds bundle weight and uses Node.js APIs unavailable in the Workers runtime.

### Capture Helper

```typescript
// apps/project-sites/src/lib/posthog.ts

interface PostHogEvent {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

export async function captureEvent(
  env: Env,
  { distinctId, event, properties = {} }: PostHogEvent,
  ctx: ExecutionContext,
): Promise<void> {
  const body = {
    api_key: env.POSTHOG_API_KEY,
    event,
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
    properties: {
      $lib: 'project-sites-worker',
      $lib_version: '1.0.0',
      ...properties,
    },
  };

  // Use waitUntil so the capture does not block the response
  ctx.waitUntil(
    fetch(`${env.POSTHOG_HOST}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((err) => {
      console.warn('[posthog] capture failed', { event, error: String(err) });
    }),
  );
}
```

### Batch Capture (Multiple Events)

```typescript
export async function captureBatch(
  env: Env,
  events: PostHogEvent[],
  ctx: ExecutionContext,
): Promise<void> {
  const body = {
    api_key: env.POSTHOG_API_KEY,
    batch: events.map(({ distinctId, event, properties = {} }) => ({
      event,
      distinct_id: distinctId,
      timestamp: new Date().toISOString(),
      properties: { $lib: 'project-sites-worker', ...properties },
    })),
  };

  ctx.waitUntil(
    fetch(`${env.POSTHOG_HOST}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {}),
  );
}
```

---

## Key Events

Every event must carry `tenant_id` and `trace_id` at minimum.

| Event Name | Trigger | Required Properties |
|---|---|---|
| `user.signup` | New account created | `tenant_id`, `plan`, `signup_source` |
| `user.login` | Successful auth | `tenant_id`, `auth_method` |
| `site.generated` | AI generation workflow completes | `tenant_id`, `site_id`, `duration_ms`, `model`, `template_slug` |
| `site.served` | Subdomain request served from R2/cache | `tenant_id`, `site_id`, `cache_hit`, `duration_ms` |
| `site.published` | Site made live by owner | `tenant_id`, `site_id`, `domain` |
| `checkout.started` | Stripe checkout session created | `tenant_id`, `plan`, `price_id` |
| `checkout.completed` | Stripe `checkout.session.completed` webhook | `tenant_id`, `plan`, `amount_total`, `currency` |
| `subscription.cancelled` | Stripe `customer.subscription.deleted` webhook | `tenant_id`, `plan`, `reason` |
| `domain.connected` | Custom domain verified | `tenant_id`, `site_id`, `domain` |
| `api_key.created` | Owner creates API key | `tenant_id`, `key_id` |
| `$exception` | Unhandled error in Worker | `tenant_id`, `trace_id`, `$exception_type`, `$exception_message`, `$exception_stacktrace` |
| `$pageview` | Page viewed (frontend) | Auto-captured by PostHog JS snippet |

### Error Capture in Hono `onError`

```typescript
// apps/project-sites/src/index.ts

app.onError(async (err, c) => {
  const traceId = c.get('traceId') ?? crypto.randomUUID();
  const tenantId = c.get('tenantId') ?? 'unknown';

  await captureEvent(c.env, {
    distinctId: tenantId,
    event: '$exception',
    properties: {
      $exception_type: err.constructor.name,
      $exception_message: err.message,
      $exception_stacktrace: err.stack ?? '',
      trace_id: traceId,
      tenant_id: tenantId,
      request_path: new URL(c.req.url).pathname,
    },
  }, c.executionCtx);

  return c.json({ error: 'Internal Server Error', requestId: traceId }, 500);
});
```

---

## Feature Flags Integration

Feature flags are evaluated server-side via the PostHog Decide API. The Worker calls `/decide` with the user's `distinct_id` to get the current flag state.

```typescript
export async function getFeatureFlags(
  env: Env,
  distinctId: string,
  personProperties?: Record<string, unknown>,
): Promise<Record<string, boolean | string>> {
  const res = await fetch(`${env.POSTHOG_HOST}/decide?v=3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: env.POSTHOG_API_KEY,
      distinct_id: distinctId,
      person_properties: personProperties ?? {},
    }),
  });

  if (!res.ok) return {};
  const data = await res.json<{ featureFlags: Record<string, boolean | string> }>();
  return data.featureFlags ?? {};
}
```

---

## Session Recording

Session recording is enabled on the Angular admin frontend via the PostHog JavaScript snippet. Add to the Angular `index.html` or bootstrap script:

```html
<script>
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","")+"..."},e.__SV=1})(document,window.posthog||[]);
  posthog.init('<POSTHOG_PUBLIC_KEY>', {
    api_host: 'https://us.i.posthog.com',
    session_recording: { maskAllInputs: false, maskInputFn: (text, element) => {
      if (element?.attributes?.getNamedItem('type')?.value === 'password') return '***';
      return text;
    }},
    capture_pageview: true,
    capture_pageleave: true,
  });
</script>
```

---

## Retention and Privacy

- Event retention: 1 year (PostHog Cloud default on paid plan)
- PII: never send raw email addresses as `distinct_id` in server-side events — use the internal `user_id` UUID
- IP addresses: PostHog IP enrichment is enabled; disable per user on GDPR request via PostHog person deletion API
- Session recordings: `maskAllInputs` defaults to `false` — selectively mask password fields as shown above

---

## Related Docs

- [Observability overview](./README.md)
- [Axiom setup](./axiom.md)
- [OTel / Workers Tracing](./otel.md)
