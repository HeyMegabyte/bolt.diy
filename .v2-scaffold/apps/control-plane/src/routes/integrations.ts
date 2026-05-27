/**
 * Integrations — list connected providers + add/remove. Secret values encrypted via
 * the MCP_ENCRYPTION_KEY before persistence.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { dbExecute, dbInsert, dbQuery } from '../services/db.js';
import { writeAudit } from '../services/audit.js';
import { encryptString } from '../services/crypto.js';

const app = new Hono<HonoEnv>();

function tenantOrThrow(c: any): string {
  requireAuth(c);
  const tenantId = c.get('tenantId') ?? c.get('orgId');
  if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');
  return tenantId;
}

app.get('/', async (c) => {
  const tenantId = tenantOrThrow(c);
  const rows = await dbQuery(
    c.env.DB,
    `SELECT id, provider, status, created_at FROM integrations WHERE tenant_id = ?1 AND deleted_at IS NULL`,
    [tenantId],
  );
  return c.json({ integrations: rows });
});

// ── Health dashboard ─────────────────────────────────────────────────────────
/**
 * Per-integration health metrics for the connected providers of the current
 * tenant.
 *
 * Returns, per provider:
 *   - `last_success_at` — most-recent successful call (ISO-8601, nullable)
 *   - `error_rate_15min` — failed / total over the last 15 minutes (0-1)
 *   - `calls_24h` — total call count in the last 24h
 *
 * Source data: `billing_events` rows whose `source` LIKE 'stripe%' OR similar
 * provider prefix, augmented by future provider-specific call logs. The
 * Workers Tracing OTLP exporter (already enabled via `observability` block in
 * `wrangler.jsonc`) is the canonical OpenTelemetry stream; this endpoint
 * surfaces the high-level signal for the admin UI without round-tripping
 * Axiom/Honeycomb on every dashboard render.
 */
interface IntegrationHealthRow {
  provider: string;
  status: string;
  last_success_at: string | null;
  ok_15min: number;
  fail_15min: number;
  calls_24h: number;
}

app.get('/health', async (c) => {
  const tenantId = tenantOrThrow(c);
  const now = Date.now();
  const fifteenMinAgo = new Date(now - 15 * 60 * 1000).toISOString();
  const twentyFourHrAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // One pass over billing_events + integrations. SQLite supports CTE-style
  // aggregation with filtered sums via CASE WHEN — keep it portable to D1.
  const rows = await dbQuery<IntegrationHealthRow>(
    c.env.DB,
    `SELECT
        i.provider AS provider,
        i.status   AS status,
        (SELECT be.occurred_at
           FROM billing_events be
          WHERE be.org_id = ?1
            AND be.source LIKE i.provider || '%'
            AND be.result = 'ok'
          ORDER BY be.occurred_at DESC LIMIT 1) AS last_success_at,
        COALESCE(SUM(CASE WHEN be.occurred_at >= ?2 AND be.result = 'ok' THEN 1 ELSE 0 END), 0) AS ok_15min,
        COALESCE(SUM(CASE WHEN be.occurred_at >= ?2 AND be.result IN ('failed','disputed') THEN 1 ELSE 0 END), 0) AS fail_15min,
        COALESCE(SUM(CASE WHEN be.occurred_at >= ?3 THEN 1 ELSE 0 END), 0) AS calls_24h
       FROM integrations i
       LEFT JOIN billing_events be ON be.org_id = ?1 AND be.source LIKE i.provider || '%'
      WHERE i.tenant_id = ?1 AND i.deleted_at IS NULL
      GROUP BY i.id, i.provider, i.status`,
    [tenantId, fifteenMinAgo, twentyFourHrAgo],
  );

  const integrations = rows.map((r) => {
    const total = r.ok_15min + r.fail_15min;
    const errorRate = total > 0 ? r.fail_15min / total : 0;
    return {
      provider: r.provider,
      status: r.status,
      last_success_at: r.last_success_at,
      error_rate_15min: Number(errorRate.toFixed(4)),
      calls_24h: r.calls_24h,
      // Signals consumed by the admin UI dashboard cards.
      healthy: errorRate < 0.05 && r.status === 'active',
    };
  });

  return c.json({
    as_of: new Date(now).toISOString(),
    integrations,
  });
});

app.post(
  '/',
  zValidator(
    'json',
    z.object({
      provider: z.enum([
        'mailchimp',
        'hubspot',
        'sendgrid',
        'resend',
        'twilio',
        'stripe',
        'google_analytics',
        'posthog',
        'sentry',
        'slack',
        'github',
      ]),
      access_token: z.string().min(1),
      refresh_token: z.string().min(1).optional(),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const body = c.req.valid('json');
    const id = crypto.randomUUID();
    const accessBlob = await encryptString(c.env, body.access_token);
    const refreshBlob = body.refresh_token
      ? await encryptString(c.env, body.refresh_token)
      : null;
    await dbInsert(c.env.DB, 'integrations', {
      id,
      tenant_id: tenantId,
      provider: body.provider,
      access_ciphertext: accessBlob.ciphertext,
      access_iv: accessBlob.iv,
      refresh_ciphertext: refreshBlob?.ciphertext ?? null,
      refresh_iv: refreshBlob?.iv ?? null,
      metadata_json: JSON.stringify(body.metadata),
      status: 'active',
    });
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'integration.connect',
      target_type: 'integration',
      target_id: id,
      metadata: { provider: body.provider },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ id });
  },
);

app.delete('/:id', async (c) => {
  const userId = requireAuth(c);
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');
  await dbExecute(
    c.env.DB,
    `UPDATE integrations SET deleted_at = ?1, updated_at = ?1, status = 'revoked' WHERE id = ?2 AND tenant_id = ?3`,
    [new Date().toISOString(), id, tenantId],
  );
  await writeAudit(c.env, {
    actor_user_id: userId,
    actor_email: c.get('userEmail'),
    tenant_id: tenantId,
    event: 'integration.disconnect',
    target_type: 'integration',
    target_id: id,
    metadata: {},
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  return c.json({ ok: true });
});

export default app;
