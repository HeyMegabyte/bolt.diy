/**
 * Jobs — list / get / update status / track location. Role-aware: crew sees only
 * jobs assigned to them; customers see only their own job.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { dbExecute, dbQuery, dbQueryOne } from '../services/db.js';
import { writeAudit } from '../services/audit.js';

const app = new Hono<HonoEnv>();

function tenantOrThrow(c: any): string {
  requireAuth(c);
  const tenantId = c.get('tenantId') ?? c.get('orgId');
  if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');
  return tenantId;
}

interface JobRow {
  id: string;
  tenant_id: string;
  booking_id: string | null;
  crew_id: string | null;
  customer_id: string | null;
  status: string;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

app.get('/', async (c) => {
  const tenantId = tenantOrThrow(c);
  const userId = c.get('userId')!;
  const viewAs = c.get('viewAs');
  let rows: JobRow[];
  if (viewAs === 'crew') {
    rows = await dbQuery<JobRow>(
      c.env.DB,
      `SELECT * FROM jobs WHERE tenant_id = ?1 AND crew_id = ?2 AND deleted_at IS NULL ORDER BY scheduled_for ASC LIMIT 200`,
      [tenantId, userId],
    );
  } else if (viewAs === 'customer') {
    rows = await dbQuery<JobRow>(
      c.env.DB,
      `SELECT * FROM jobs WHERE tenant_id = ?1 AND customer_id = ?2 AND deleted_at IS NULL ORDER BY scheduled_for ASC LIMIT 200`,
      [tenantId, userId],
    );
  } else {
    rows = await dbQuery<JobRow>(
      c.env.DB,
      `SELECT * FROM jobs WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY scheduled_for ASC LIMIT 200`,
      [tenantId],
    );
  }
  return c.json({ jobs: rows });
});

app.get('/:id', async (c) => {
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');
  const row = await dbQueryOne<JobRow>(
    c.env.DB,
    `SELECT * FROM jobs WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
    [id, tenantId],
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'job');
  return c.json(row);
});

app.patch(
  '/:id/status',
  zValidator(
    'json',
    z.object({
      status: z.enum(['scheduled', 'en_route', 'on_site', 'completed', 'cancelled', 'delayed']),
      note: z.string().max(500).optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const id = c.req.param('id');
    const { status, note } = c.req.valid('json');
    await dbExecute(
      c.env.DB,
      `UPDATE jobs SET status = ?1, updated_at = ?2 WHERE id = ?3 AND tenant_id = ?4`,
      [status, new Date().toISOString(), id, tenantId],
    );
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: `job.status.${status}`,
      target_type: 'job',
      target_id: id,
      metadata: { note: note ?? null },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    // Fan out to JobTrackingHub so the customer's map updates live.
    const stub = c.env.JOB_TRACKING_HUB.get(c.env.JOB_TRACKING_HUB.idFromName(`${tenantId}:${id}`));
    c.executionCtx.waitUntil(
      stub.fetch('https://do/ping', {
        method: 'POST',
        body: JSON.stringify({ ts: Date.now(), lat: 0, lng: 0, status }),
      }),
    );
    return c.json({ ok: true });
  },
);

app.post(
  '/:id/ping',
  zValidator(
    'json',
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      heading: z.number().optional(),
      speed_mps: z.number().optional(),
      status: z.string().optional(),
      eta_seconds: z.number().int().optional(),
    }),
  ),
  async (c) => {
    requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const stub = c.env.JOB_TRACKING_HUB.get(c.env.JOB_TRACKING_HUB.idFromName(`${tenantId}:${id}`));
    await stub.fetch('https://do/ping', {
      method: 'POST',
      body: JSON.stringify({ ts: Date.now(), ...body }),
    });
    return c.json({ ok: true });
  },
);

export default app;
