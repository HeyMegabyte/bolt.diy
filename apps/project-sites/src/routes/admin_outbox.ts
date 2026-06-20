/**
 * Super-Admin event-bus observability route.
 *
 * `GET /api/admin/outbox` surfaces the durable outbox's health for an operator:
 * bucket counts ({@link outboxStats}) + the most recent failed rows
 * ({@link readFailedOutbox}) so a stuck/dead-lettered event is visible without a
 * D1 console. Read-only — it never mutates the outbox (the 5-min cron drains it;
 * the dead-letter gate lives in `event_bus.nextOutboxAction`).
 *
 * Gate (in order): auth required (401) → super-admin (403). No feature flag —
 * this is an operator-only diagnostics view, not a tenant feature.
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../types/env.js';
import { isSuperAdmin } from '../services/sysadmin.js';
import { outboxStats, readFailedOutbox } from '../services/event_bus.js';

/** Build the RFC7807-ish error envelope used across the worker. */
function errorBody(code: string, message: string, requestId: string | undefined) {
  return { error: { code, message, request_id: requestId ?? null } };
}

const QuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).strip();

export const adminOutbox = new Hono<{ Bindings: Env; Variables: Variables }>();

adminOutbox.get('/api/admin/outbox', async (c) => {
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

  const [stats, recentFailures] = await Promise.all([
    outboxStats(c.env),
    readFailedOutbox(c.env, parsed.data.limit ?? 50),
  ]);

  return c.json({ stats, recentFailures, count: recentFailures.length }, 200);
});
