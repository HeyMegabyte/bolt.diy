/**
 * Team — list members, invite, update role, remove. Tenant-scoped.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import { writeAudit } from '../services/audit.js';
import { sendEmail } from '../services/notifications.js';

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
    `SELECT tm.id, tm.user_id, u.email, u.name, tm.role, tm.created_at
     FROM team_members tm JOIN users u ON u.id = tm.user_id
     WHERE tm.tenant_id = ?1 AND tm.deleted_at IS NULL ORDER BY tm.created_at`,
    [tenantId],
  );
  return c.json({ members: rows });
});

app.post(
  '/invite',
  zValidator(
    'json',
    z.object({
      email: z.string().email(),
      role: z.enum(['owner', 'admin', 'staff', 'crew']).default('staff'),
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
    const acceptUrl = `${c.env.APP_BASE_URL}/invite/accept?token=${token}`;
    try {
      await sendEmail(c.env, {
        to: email.toLowerCase(),
        subject: `You're invited to ${c.env.WEBAUTHN_RP_NAME}`,
        html: `<p>You've been invited to join a team.</p><p><a href="${acceptUrl}">Accept invitation</a> — link expires in 7 days.</p>`,
      });
    } catch (err) {
      // Audit then surface
      await writeAudit(c.env, {
        actor_user_id: userId,
        actor_email: c.get('userEmail'),
        tenant_id: tenantId,
        event: 'team.invite.email_failed',
        target_type: 'team_invite',
        target_id: id,
        metadata: { error: err instanceof Error ? err.message : String(err) },
        ip: null,
        user_agent: null,
      });
    }
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'team.invite',
      target_type: 'team_invite',
      target_id: id,
      metadata: { email, role },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ invite_id: id });
  },
);

app.post(
  '/invite/accept',
  zValidator('json', z.object({ token: z.string().min(10) })),
  async (c) => {
    const userId = requireAuth(c);
    const userEmail = c.get('userEmail');
    if (!userEmail) throw new AppError(ErrorCode.UNAUTHORIZED, 'auth required');
    const { token } = c.req.valid('json');
    const invite = await dbQueryOne<{
      id: string;
      tenant_id: string;
      email: string;
      role: string;
      expires_at: number;
      accepted_at: string | null;
    }>(
      c.env.DB,
      `SELECT id, tenant_id, email, role, expires_at, accepted_at FROM team_invites WHERE token = ?1`,
      [token],
    );
    if (!invite || invite.accepted_at || invite.expires_at < Date.now()) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'invalid or expired invite');
    }
    if (invite.email !== userEmail.toLowerCase()) {
      throw new AppError(ErrorCode.FORBIDDEN, 'invite email does not match signed-in user');
    }
    await dbInsert(c.env.DB, 'team_members', {
      id: crypto.randomUUID(),
      tenant_id: invite.tenant_id,
      user_id: userId,
      role: invite.role,
    });
    await dbExecute(
      c.env.DB,
      `UPDATE team_invites SET accepted_at = ?1, updated_at = ?1 WHERE id = ?2`,
      [new Date().toISOString(), invite.id],
    );
    return c.json({ tenant_id: invite.tenant_id, role: invite.role });
  },
);

app.patch(
  '/:memberId',
  zValidator(
    'json',
    z.object({ role: z.enum(['owner', 'admin', 'staff', 'crew']) }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const memberId = c.req.param('memberId');
    const { role } = c.req.valid('json');
    await dbExecute(
      c.env.DB,
      `UPDATE team_members SET role = ?1, updated_at = ?2 WHERE id = ?3 AND tenant_id = ?4`,
      [role, new Date().toISOString(), memberId, tenantId],
    );
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'team.role.update',
      target_type: 'team_member',
      target_id: memberId,
      metadata: { role },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ ok: true });
  },
);

app.delete('/:memberId', async (c) => {
  const userId = requireAuth(c);
  const tenantId = tenantOrThrow(c);
  const memberId = c.req.param('memberId');
  await dbExecute(
    c.env.DB,
    `UPDATE team_members SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND tenant_id = ?3`,
    [new Date().toISOString(), memberId, tenantId],
  );
  await writeAudit(c.env, {
    actor_user_id: userId,
    actor_email: c.get('userEmail'),
    tenant_id: tenantId,
    event: 'team.remove',
    target_type: 'team_member',
    target_id: memberId,
    metadata: {},
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  return c.json({ ok: true });
});

export default app;
