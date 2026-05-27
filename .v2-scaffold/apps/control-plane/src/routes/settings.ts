/**
 * Tenant settings — read + patch metadata, currency, locales.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { dbExecute, dbQueryOne } from '../services/db.js';
import { writeAudit } from '../services/audit.js';

const app = new Hono<HonoEnv>();

function tenantOrThrow(c: any): string {
  requireAuth(c);
  const tenantId = c.get('tenantId') ?? c.get('orgId');
  if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');
  return tenantId;
}

app.get('/', async (c) => {
  const tenantId = tenantOrThrow(c);
  const row = await dbQueryOne(
    c.env.DB,
    `SELECT id, slug, name, default_currency, primary_hostname, status FROM tenants WHERE id = ?1`,
    [tenantId],
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'tenant');
  return c.json(row);
});

app.patch(
  '/',
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(200).optional(),
      default_currency: z.string().length(3).optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const body = c.req.valid('json');
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (body.name) {
      sets.push(`name = ?${i++}`);
      params.push(body.name);
    }
    if (body.default_currency) {
      sets.push(`default_currency = ?${i++}`);
      params.push(body.default_currency.toLowerCase());
    }
    if (!sets.length) return c.json({ ok: true });
    sets.push(`updated_at = ?${i++}`);
    params.push(new Date().toISOString());
    params.push(tenantId);
    await dbExecute(c.env.DB, `UPDATE tenants SET ${sets.join(', ')} WHERE id = ?${i}`, params);
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'settings.update',
      target_type: 'tenant',
      target_id: tenantId,
      metadata: body,
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ ok: true });
  },
);

export default app;
