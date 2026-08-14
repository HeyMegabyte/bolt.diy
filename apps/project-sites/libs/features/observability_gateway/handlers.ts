/**
 * @module libs/features/observability_gateway/handlers
 * @description Hono route for the Customer-Site Observability Gateway.
 *
 * | Method | Path                      | Purpose                                           |
 * | ------ | ------------------------- | ------------------------------------------------- |
 * | POST   | /monitoring/:provider     | Proxy Sentry/PostHog events from customer sites   |
 *
 * ## Request contract
 * - `x-site-host` header **or** `x-site-id` header must identify the calling site.
 * - Body: any valid JSON object (vendor-native shape; we strip PII, then forward).
 *
 * ## Response contract
 * - `202 Accepted` — event forwarded, sampled-out, or fail-soft-dropped.
 * - `400 Bad Request` — invalid provider param or unparseable JSON body.
 * - `404 Not Found` — flag off OR site not found (never 403 — no existence leak).
 * - `429 Too Many Requests` — hourly per-site quota exceeded.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { notFound } from '../../../src/lib/feature_guard.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { resolveSite } from '../../../src/services/site_serving.js';
import {
  MonitoringParamSchema,
  MonitoringBodySchema,
} from './schemas.js';
import {
  FLAG_KEY,
  DEFAULT_SAMPLE_RATE,
  HOURLY_QUOTA,
  redactPii,
  shouldKeep,
  checkAndIncrementQuota,
  vendorIngestUrl,
  writeRollup,
} from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const observabilityGateway = new Hono<AppContext>();

const badRequest = (c: import('hono').Context<AppContext>, message: string) =>
  c.json({ error: { code: 'BAD_REQUEST', message } }, 400);

/**
 * POST /monitoring/:provider
 *
 * Customer sites POST raw vendor payloads here instead of directly to the
 * vendor endpoint.  The Worker:
 *   1. Flag-gate: 404 when `observability_gateway` is off.
 *   2. Resolve site from `x-site-host` or `x-site-id` header (KV → D1).
 *   3. Validate provider param + JSON body.
 *   4. PII-redact the payload.
 *   5. Deterministic sampling (default 100 % — all events forwarded).
 *   6. Per-site hourly quota check (KV counter).
 *   7. Forward to vendor endpoint using server-held key (never the client key).
 *   8. Best-effort Analytics Engine rollup.
 *   9. Always return 202 (fail-soft on vendor error).
 */
observabilityGateway.post('/monitoring/:provider', async (c) => {
  // 1. Flag gate — 404 when off (never 403)
  const flagOn = await isFlagOn(c.env, FLAG_KEY).catch(() => false);
  if (!flagOn) return notFound(c);

  // 2. Validate provider param
  const paramParsed = MonitoringParamSchema.safeParse(c.req.param());
  if (!paramParsed.success) {
    return badRequest(c, `Unknown provider. Supported: sentry, posthog`);
  }
  const { provider } = paramParsed.data;

  // 3. Resolve site identity from header
  const siteHost = c.req.header('x-site-host');
  const siteIdHeader = c.req.header('x-site-id');

  let siteId: string | null = null;
  let orgId: string | null = null;

  if (siteIdHeader) {
    // Fast path: explicit site_id — verify it exists in D1
    const row = await c.env.DB.prepare(
      'SELECT id, org_id FROM sites WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    )
      .bind(siteIdHeader)
      .first<{ id: string; org_id: string }>()
      .catch(() => null);

    if (row) {
      siteId = row.id;
      orgId = row.org_id;
    }
  } else if (siteHost) {
    // Hostname path — reuse the production site resolver (KV cache → D1)
    const resolved = await resolveSite(c.env, c.env.DB, siteHost).catch(() => null);
    if (resolved) {
      siteId = resolved.site_id;
      orgId = resolved.org_id;
    }
  }

  if (!siteId || !orgId) {
    // Unknown/foreign site — 404 (do not leak feature existence)
    return notFound(c);
  }

  // 4. Parse and validate body
  const rawBody = await c.req.json().catch(() => null);
  if (rawBody === null) {
    return badRequest(c, 'Request body must be valid JSON');
  }
  const bodyParsed = MonitoringBodySchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return badRequest(c, 'Invalid event payload');
  }
  const body = bodyParsed.data;

  // 5. PII-redact the payload
  const redacted = redactPii(body) as Record<string, unknown>;

  // 6. Deterministic sampling — derive event id from vendor-standard fields
  const eventId =
    body.event_id ?? body.$uuid ?? body.uuid ?? String(Date.now());
  const keepRate = DEFAULT_SAMPLE_RATE; // TODO: make configurable per-flag override
  if (!shouldKeep(eventId, keepRate)) {
    // Sampled out — 202 to the client (they don't need to know)
    return c.json({ status: 'accepted' }, 202);
  }

  // 7. Hourly quota check
  const { exceeded } = await checkAndIncrementQuota(
    c.env.CACHE_KV,
    siteId,
    HOURLY_QUOTA,
    Date.now(),
  );
  if (exceeded) {
    return c.json({ error: { code: 'QUOTA_EXCEEDED', message: 'Rate limit exceeded' } }, 429);
  }

  // 8. Build forward request — inject tenant tag + server-held vendor key
  const ingestUrl = vendorIngestUrl(provider, {
    SENTRY_PROJECT_ID: (c.env as unknown as Record<string, string>)['SENTRY_PROJECT_ID'],
    SENTRY_PROJECT_KEY: (c.env as unknown as Record<string, string>)['SENTRY_PROJECT_KEY'],
  });

  // Add tenant metadata to the payload (Sentry tags / PostHog properties)
  const enriched: Record<string, unknown> = {
    ...redacted,
    _ps_org_id: orgId,
    _ps_site_id: siteId,
    _ps_provider: provider,
  };

  // Server-held key injected per provider
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'sentry') {
    const sentryKey = (c.env as unknown as Record<string, string>)['SENTRY_INGEST_KEY'] ?? '';
    headers['X-Sentry-Auth'] = `Sentry sentry_version=7, sentry_key=${sentryKey}`;
  } else {
    const phKey = (c.env as unknown as Record<string, string>)['POSTHOG_INGEST_KEY'] ?? '';
    // Inject the server-side API key into the payload (PostHog pattern)
    enriched['api_key'] = phKey;
  }

  // 9. Forward — fail-soft: vendor errors never propagate to customer site
  await fetch(ingestUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(enriched),
  }).catch(() => {
    // Network/vendor error — intentionally swallowed (fail-soft)
  });

  // 10. Best-effort Analytics Engine rollup
  writeRollup(c.env.ANALYTICS, provider, orgId, siteId);

  // Always 202 — the customer site must never get a vendor error
  return c.json({ status: 'accepted' }, 202);
});
