/**
 * Super-Admin activation-funnel route (§9) — the first consumer of the Tinybird
 * analytics layer.
 *
 * `GET /api/admin/activation-funnel` returns the per-tenant revenue funnel
 * (discovered → engaged → delivered → converted) from the `activation_funnel`
 * pipe via {@link fetchActivationFunnel}. Always returns all four stages in
 * order; `degraded:true` signals the zero fallback (Tinybird unconfigured/down)
 * so the dashboard renders the funnel even before analytics is live.
 *
 * Gate (in order): auth required (401) → super-admin (403). No feature flag —
 * operator-only diagnostics, mirroring `admin_outbox`.
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../types/env.js';
import { isSuperAdmin } from '../services/sysadmin.js';
import { fetchActivationFunnel } from '../services/activation_funnel_query.js';

/** RFC7807-ish error envelope used across the worker. */
function errorBody(code: string, message: string, requestId: string | undefined) {
  return { error: { code, message, request_id: requestId ?? null } };
}

const QuerySchema = z
  .object({
    tenant_id: z.string().min(1).max(128).optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
  })
  .strip();

export const adminFunnel = new Hono<{ Bindings: Env; Variables: Variables }>();

adminFunnel.get('/api/admin/activation-funnel', async (c) => {
  const requestId = c.get('requestId');
  const userId = c.get('userId');
  if (!userId) return c.json(errorBody('UNAUTHORIZED', 'Sign in required', requestId), 401);
  if (!(await isSuperAdmin(c.env, userId))) {
    return c.json(errorBody('FORBIDDEN', 'Super-admin access required', requestId), 403);
  }

  const parsed = QuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(errorBody('VALIDATION_ERROR', 'Invalid query', requestId), 400);
  }

  const { stages, degraded } = await fetchActivationFunnel(c.env, {
    tenantId: parsed.data.tenant_id,
    days: parsed.data.days,
  });
  return c.json({ stages, degraded, count: stages.length }, 200);
});
