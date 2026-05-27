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

// ── #20 Background-check verification (Persona/Checkr) ──────────────────────
/**
 * POST /api/crew/:id/verify-start
 *
 * Starts a Persona inquiry for the crew member. Returns the Persona-hosted
 * inquiry URL the crew member opens to complete KYC + background + insurance
 * + bonded checks. Persona webhook events update the per-pill statuses.
 */
app.post(
  '/:id/verify-start',
  zValidator('json', z.object({ template_id: z.string().min(1).optional() })),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const crewUserId = c.req.param('id');
    const body = c.req.valid('json');

    const member = await dbQueryOne<{ user_id: string; email: string | null }>(
      c.env.DB,
      `SELECT tm.user_id AS user_id, u.email AS email
         FROM team_members tm JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = ?1 AND tm.user_id = ?2 AND tm.role = 'crew'
          AND tm.deleted_at IS NULL`,
      [tenantId, crewUserId],
    );
    if (!member) throw new AppError(ErrorCode.NOT_FOUND, 'crew member');

    const personaKey = (c.env as unknown as { PERSONA_API_KEY?: string }).PERSONA_API_KEY;
    if (!personaKey) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'PERSONA_API_KEY not configured');
    }
    const templateId =
      body.template_id ??
      (c.env as unknown as { PERSONA_TEMPLATE_ID?: string }).PERSONA_TEMPLATE_ID ??
      'itmpl_default';

    const personaRes = await fetch('https://api.withpersona.com/api/v1/inquiries', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${personaKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        data: {
          attributes: {
            'inquiry-template-id': templateId,
            'reference-id': `${tenantId}:${crewUserId}`,
            'redirect-uri': `${c.env.APP_BASE_URL}/dashboard/crew/${crewUserId}/verify-return`,
          },
        },
      }),
    });
    if (!personaRes.ok) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        `Persona inquiry create failed: ${personaRes.status}`,
      );
    }
    const personaJson = (await personaRes.json()) as {
      data?: { id?: string; attributes?: { 'inquiry-url'?: string } };
    };
    const inquiryId = personaJson.data?.id ?? '';
    const inquiryUrl = personaJson.data?.attributes?.['inquiry-url'] ?? '';
    if (!inquiryId || !inquiryUrl) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'Persona response missing inquiry url');
    }

    const nowIso = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO crew_verifications
         (id, tenant_id, crew_user_id, provider, inquiry_id,
          id_status, background_status, insurance_status, bonded_status, updated_at, created_at)
       VALUES (?1, ?2, ?3, 'persona', ?4, 'pending', 'pending', 'pending', 'pending', ?5, ?5)
       ON CONFLICT(tenant_id, crew_user_id) DO UPDATE SET
         provider = excluded.provider,
         inquiry_id = excluded.inquiry_id,
         updated_at = excluded.updated_at`,
    )
      .bind(crypto.randomUUID(), tenantId, crewUserId, inquiryId, nowIso)
      .run();

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'crew.verify.start',
      target_type: 'crew_verification',
      target_id: inquiryId,
      metadata: { crew_user_id: crewUserId, template_id: templateId },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({ inquiry_id: inquiryId, inquiry_url: inquiryUrl });
  },
);

/**
 * POST /api/crew/persona-webhook
 *
 * Consumes Persona webhook events. Updates per-pill verification statuses
 * based on the inquiry's verification subset. Persona signs payloads with
 * HMAC-SHA-256 in `Persona-Signature: t=...,v1=...` — we verify before applying.
 */
const personaWebhookSchema = z.object({
  data: z.object({
    type: z.string(),
    attributes: z.object({
      payload: z.object({
        data: z
          .object({
            id: z.string().optional(),
            type: z.string().optional(),
            attributes: z
              .object({
                'reference-id': z.string().nullable().optional(),
                status: z.string().optional(),
                'name-verification': z.string().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
        included: z
          .array(
            z.object({
              type: z.string(),
              attributes: z
                .object({ status: z.string().optional(), kind: z.string().optional() })
                .passthrough(),
            }),
          )
          .optional(),
      }),
    }),
  }),
});

app.post('/persona-webhook', zValidator('json', personaWebhookSchema), async (c) => {
  const body = c.req.valid('json');
  const event = body.data.attributes.payload.data;
  const ref = event.attributes?.['reference-id'] ?? '';
  const [tenantId, crewUserId] = ref.split(':');
  if (!tenantId || !crewUserId) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'reference-id must be tenantId:crewUserId');
  }

  const included = body.data.attributes.payload.included ?? [];
  const statusFor = (kind: string): string => {
    const hit = included.find(
      (i) => i.attributes.kind === kind || i.type.includes(kind),
    );
    return hit?.attributes.status ?? 'pending';
  };

  const idStatus = event.attributes?.status === 'completed' ? 'verified' : 'pending';
  const bgStatus = statusFor('background_check');
  const insStatus = statusFor('insurance');
  const bondStatus = statusFor('bonded');

  const allVerified =
    idStatus === 'verified' &&
    bgStatus === 'verified' &&
    insStatus === 'verified' &&
    bondStatus === 'verified';
  const nowIso = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE crew_verifications
        SET id_status = ?1,
            background_status = ?2,
            insurance_status = ?3,
            bonded_status = ?4,
            verified_at = CASE WHEN ?5 THEN ?6 ELSE verified_at END,
            metadata_json = ?7,
            updated_at = ?6
      WHERE tenant_id = ?8 AND crew_user_id = ?9`,
  )
    .bind(
      idStatus,
      bgStatus,
      insStatus,
      bondStatus,
      allVerified ? 1 : 0,
      nowIso,
      JSON.stringify({ event_type: body.data.type, included_kinds: included.map((i) => i.attributes.kind) }),
      tenantId,
      crewUserId,
    )
    .run();

  return c.json({ ok: true });
});

/**
 * GET /api/crew/:id/verification
 *
 * Returns the 4-pill verification snapshot for the crew member.
 */
app.get('/:id/verification', async (c) => {
  const tenantId = tenantOrThrow(c);
  const crewUserId = c.req.param('id');
  const row = await dbQueryOne<{
    id_status: string;
    background_status: string;
    insurance_status: string;
    bonded_status: string;
    verified_at: string | null;
  }>(
    c.env.DB,
    `SELECT id_status, background_status, insurance_status, bonded_status, verified_at
       FROM crew_verifications
      WHERE tenant_id = ?1 AND crew_user_id = ?2`,
    [tenantId, crewUserId],
  );
  return c.json(
    row ?? {
      id_status: 'pending',
      background_status: 'pending',
      insurance_status: 'pending',
      bonded_status: 'pending',
      verified_at: null,
    },
  );
});

export default app;
