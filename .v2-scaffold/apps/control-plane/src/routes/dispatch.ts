/**
 * Dispatch — surge transparency + dispatch-optimizer kick.
 *
 * - `GET /surge/:geohash` returns the current surge multiplier for a tile.
 * - `POST /kick` prods the per-tenant DispatchOptimizer to run its alarm now.
 *
 * Surge is computed fresh per request (no cache) — D1 read replicas keep
 * latency low and the surface honest. Frontend overlays poll every 30s.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { computeSurge } from '../services/surge.js';

const app = new Hono<HonoEnv>();

function tenantOrThrow(c: any): string {
  requireAuth(c);
  const tenantId = c.get('tenantId') ?? c.get('orgId');
  if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');
  return tenantId;
}

const geohashSchema = z
  .string()
  .min(1)
  .max(12)
  .regex(/^[0123456789bcdefghjkmnpqrstuvwxyz]+$/, 'invalid geohash');

app.get('/surge/:geohash', async (c) => {
  const tenantId = tenantOrThrow(c);
  const parsed = geohashSchema.safeParse(c.req.param('geohash'));
  if (!parsed.success) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'invalid geohash');
  }
  const snapshot = await computeSurge(c.env, {
    geohash: parsed.data,
    tenantId,
  });
  return c.json(snapshot);
});

app.post('/kick', async (c) => {
  const tenantId = tenantOrThrow(c);
  const stub = c.env.DISPATCH_OPTIMIZER.get(
    c.env.DISPATCH_OPTIMIZER.idFromName(tenantId),
  );
  // Persist tenant_id on first contact so the DO alarm knows who it serves.
  await stub.fetch('https://do/kick', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId }),
  });
  return c.json({ ok: true });
});

export default app;
