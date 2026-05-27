/**
 * Crew — list, invite, assign jobs, manage availability.
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

app.get('/', async (c) => {
  const tenantId = tenantOrThrow(c);
  const rows = await dbQuery(
    c.env.DB,
    `SELECT tm.user_id, u.email, u.name, tm.role, tm.created_at
     FROM team_members tm JOIN users u ON u.id = tm.user_id
     WHERE tm.tenant_id = ?1 AND tm.role = 'crew' AND tm.deleted_at IS NULL`,
    [tenantId],
  );
  return c.json({ crew: rows });
});

app.post(
  '/invite',
  zValidator(
    'json',
    z.object({
      email: z.string().email(),
      role: z.enum(['crew', 'staff']).default('crew'),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const { email, role } = c.req.valid('json');
    const token = crypto.randomUUID() + crypto.randomUUID();
    const id = crypto.randomUUID();
    await dbInsert(c.env.DB, 'team_invites', {
      id,
      tenant_id: tenantId,
      email: email.toLowerCase(),
      role,
      token,
      expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
      invited_by: userId,
    });
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'crew.invite',
      target_type: 'team_invite',
      target_id: id,
      metadata: { email, role },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ invite_id: id, token });
  },
);

app.post(
  '/jobs/:jobId/assign',
  zValidator('json', z.object({ crew_user_id: z.string().uuid() })),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const jobId = c.req.param('jobId');
    const { crew_user_id } = c.req.valid('json');
    const member = await dbQueryOne(
      c.env.DB,
      `SELECT 1 FROM team_members WHERE tenant_id = ?1 AND user_id = ?2 AND role = 'crew' AND deleted_at IS NULL`,
      [tenantId, crew_user_id],
    );
    if (!member) throw new AppError(ErrorCode.BAD_REQUEST, 'crew member not in tenant');
    await dbExecute(
      c.env.DB,
      `UPDATE jobs SET crew_id = ?1, updated_at = ?2 WHERE id = ?3 AND tenant_id = ?4`,
      [crew_user_id, new Date().toISOString(), jobId, tenantId],
    );
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'crew.assign',
      target_type: 'job',
      target_id: jobId,
      metadata: { crew_user_id },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ ok: true });
  },
);

export default app;
