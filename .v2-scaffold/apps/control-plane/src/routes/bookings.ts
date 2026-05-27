/**
 * Bookings — list / get / create / cancel. Drives JobChatRoom + JobTrackingHub
 * provisioning on accept.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import { writeAudit } from '../services/audit.js';

const app = new Hono<HonoEnv>();

function tenantOrThrow(c: any): string {
  requireAuth(c);
  const tenantId = c.get('tenantId') ?? c.get('orgId');
  if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');
  return tenantId;
}

interface BookingRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  quote_id: string | null;
  status: string;
  scheduled_for: string | null;
  total_cents: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

app.get('/', async (c) => {
  const tenantId = tenantOrThrow(c);
  const userId = c.get('userId')!;
  const viewAs = c.get('viewAs');
  let rows: BookingRow[];
  if (viewAs === 'customer') {
    rows = await dbQuery<BookingRow>(
      c.env.DB,
      `SELECT * FROM bookings WHERE tenant_id = ?1 AND customer_id = ?2 AND deleted_at IS NULL ORDER BY scheduled_for DESC`,
      [tenantId, userId],
    );
  } else {
    rows = await dbQuery<BookingRow>(
      c.env.DB,
      `SELECT * FROM bookings WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY scheduled_for DESC LIMIT 200`,
      [tenantId],
    );
  }
  return c.json({ bookings: rows });
});

app.get('/:id', async (c) => {
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');
  const row = await dbQueryOne<BookingRow>(
    c.env.DB,
    `SELECT * FROM bookings WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
    [id, tenantId],
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'booking');
  return c.json(row);
});

app.post(
  '/',
  zValidator(
    'json',
    z.object({
      customer_id: z.string().uuid(),
      quote_id: z.string().uuid().optional(),
      scheduled_for: z.string().datetime(),
      total_cents: z.number().int().nonnegative(),
      currency: z.string().length(3).default('usd'),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const body = c.req.valid('json');
    const id = crypto.randomUUID();
    await dbInsert(c.env.DB, 'bookings', {
      id,
      tenant_id: tenantId,
      customer_id: body.customer_id,
      quote_id: body.quote_id ?? null,
      status: 'pending',
      scheduled_for: body.scheduled_for,
      total_cents: body.total_cents,
      currency: body.currency.toLowerCase(),
    });
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'booking.create',
      target_type: 'booking',
      target_id: id,
      metadata: { total_cents: body.total_cents },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ id, status: 'pending' });
  },
);

app.post('/:id/cancel', async (c) => {
  const userId = requireAuth(c);
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');
  await dbExecute(
    c.env.DB,
    `UPDATE bookings SET status = 'cancelled', updated_at = ?1 WHERE id = ?2 AND tenant_id = ?3`,
    [new Date().toISOString(), id, tenantId],
  );
  await writeAudit(c.env, {
    actor_user_id: userId,
    actor_email: c.get('userEmail'),
    tenant_id: tenantId,
    event: 'booking.cancel',
    target_type: 'booking',
    target_id: id,
    metadata: {},
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  return c.json({ ok: true });
});

export default app;
