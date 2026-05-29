/**
 * @module libs/features/audit_hash_chain/handlers
 * @description Hono routes for the Hash-Chained Audit Log (idea #46).
 *
 * | Method | Path                                  | Purpose                                |
 * | ------ | ------------------------------------- | -------------------------------------- |
 * | GET    | /api/audit-chain                      | Paginated chain for caller's org       |
 * | GET    | /api/audit-chain/verify               | Verify chain integrity end-to-end      |
 * | POST   | /api/audit-chain/append               | Internal: append after a writeAuditLog |
 *
 * The append route is intentionally exposed so other modules can chain
 * their own audit writes without coupling to this module's wiring.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { HashablePayloadSchema } from './schemas.js';
import { appendEntry, listChain, verifyChain } from './service.js';

export const FLAG_KEY = 'audit_hash_chain';

type AppContext = { Bindings: Env; Variables: Variables };

export const auditHashChain = new Hono<AppContext>();

async function guard(
  c: import('hono').Context<AppContext>,
): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId)
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  return null;
}

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

auditHashChain.get('/api/audit-chain', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId') as string;
  const parsedQuery = ListQuerySchema.safeParse(c.req.query());
  const limit = parsedQuery.success ? parsedQuery.data.limit : undefined;
  const offset = parsedQuery.success ? parsedQuery.data.offset : undefined;
  const entries = await listChain(c.env.DB, orgId, { limit, offset });
  return c.json({ entries });
});

auditHashChain.get('/api/audit-chain/verify', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId') as string;
  const verdict = await verifyChain(c.env.DB, orgId);
  return c.json(verdict);
});

auditHashChain.post('/api/audit-chain/append', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const raw = await c.req.json().catch(() => ({}));
  const parsed = HashablePayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid hashable payload',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }
  const entry = await appendEntry(c.env.DB, parsed.data);
  return c.json({ entry });
});
