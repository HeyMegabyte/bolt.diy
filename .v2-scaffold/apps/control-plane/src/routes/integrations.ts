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
