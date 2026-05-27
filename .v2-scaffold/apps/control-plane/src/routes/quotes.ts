/**
 * Quotes — list / get / create / send / accept. Role-aware: customers see only their
 * quotes; staff see all within the tenant.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import { writeAudit } from '../services/audit.js';

interface QuoteRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  currency: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

const app = new Hono<HonoEnv>();

function tenantOrThrow(c: any): string {
  requireAuth(c);
  const tenantId = c.get('tenantId') ?? c.get('orgId');
  if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');
  return tenantId;
}

app.get('/', async (c) => {
  const tenantId = tenantOrThrow(c);
  const userId = c.get('userId')!;
  const viewAs = c.get('viewAs');
  let rows: QuoteRow[];
  if (viewAs === 'customer') {
    rows = await dbQuery<QuoteRow>(
      c.env.DB,
      `SELECT * FROM quotes WHERE tenant_id = ?1 AND customer_id = ?2 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [tenantId, userId],
    );
  } else {
    rows = await dbQuery<QuoteRow>(
      c.env.DB,
      `SELECT * FROM quotes WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`,
      [tenantId],
    );
  }
  return c.json({ quotes: rows });
});

app.get('/:id', async (c) => {
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');
  const row = await dbQueryOne<QuoteRow>(
    c.env.DB,
    `SELECT * FROM quotes WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
    [id, tenantId],
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'quote');
  return c.json(row);
});

app.post(
  '/',
  zValidator(
    'json',
    z.object({
      customer_id: z.string().uuid().optional(),
      subtotal_cents: z.number().int().nonnegative(),
      tax_cents: z.number().int().nonnegative().default(0),
      total_cents: z.number().int().nonnegative(),
      currency: z.string().length(3).default('usd'),
      line_items: z.array(z.unknown()).default([]),
      notes: z.string().max(2000).optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const body = c.req.valid('json');
    const id = crypto.randomUUID();
    await dbInsert(c.env.DB, 'quotes', {
      id,
      tenant_id: tenantId,
      customer_id: body.customer_id ?? null,
      status: 'draft',
      subtotal_cents: body.subtotal_cents,
      tax_cents: body.tax_cents,
      total_cents: body.total_cents,
      currency: body.currency.toLowerCase(),
      metadata_json: JSON.stringify({ line_items: body.line_items, notes: body.notes }),
    });
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'quote.create',
      target_type: 'quote',
      target_id: id,
      metadata: { total_cents: body.total_cents },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ id, status: 'draft' });
  },
);

app.post('/:id/send', async (c) => {
  const userId = requireAuth(c);
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');
  await dbExecute(
    c.env.DB,
    `UPDATE quotes SET status = 'sent', updated_at = ?1 WHERE id = ?2 AND tenant_id = ?3`,
    [new Date().toISOString(), id, tenantId],
  );
  await writeAudit(c.env, {
    actor_user_id: userId,
    actor_email: c.get('userEmail'),
    tenant_id: tenantId,
    event: 'quote.send',
    target_type: 'quote',
    target_id: id,
    metadata: {},
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  return c.json({ ok: true });
});

app.post('/:id/accept', async (c) => {
  const userId = requireAuth(c);
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');
  await dbExecute(
    c.env.DB,
    `UPDATE quotes SET status = 'accepted', accepted_at = ?1, updated_at = ?1 WHERE id = ?2 AND tenant_id = ?3`,
    [new Date().toISOString(), id, tenantId],
  );
  await writeAudit(c.env, {
    actor_user_id: userId,
    actor_email: c.get('userEmail'),
    tenant_id: tenantId,
    event: 'quote.accept',
    target_type: 'quote',
    target_id: id,
    metadata: {},
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  return c.json({ ok: true });
});

export default app;
