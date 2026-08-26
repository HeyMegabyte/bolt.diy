/**
 * @module libs/features/notifications/handlers
 *
 * @description
 * Hono routes for the in-app notifications feature — the owner-dashboard bell
 * inbox: list, mark-one-read, mark-all-read. Every route is user-scoped via
 * `c.get('userId')` (401 envelope when missing) and every D1 write carries an
 * `AND user_id = ?` cross-user guard so a caller can never touch another user's
 * rows even by guessing an id.
 *
 * | Method | Path                             | Auth   | Purpose                          |
 * | ------ | -------------------------------- | ------ | -------------------------------- |
 * | GET    | /api/notifications               | userId | List (limit≤100) + unread_count  |
 * | PATCH  | /api/notifications/:id/read      | userId | Mark one read (idempotent no-op) |
 * | POST   | /api/notifications/read-all      | userId | Mark all caller's unread read    |
 *
 * Extracted verbatim from the `api.ts` monolith (route-decomposition
 * installment 2). No request body/params are cast via `as {…}` — the id comes
 * from `c.req.param('id')` and the only query (`limit`) is numerically clamped —
 * so there is no `schemas.ts` (nothing to Zod-validate at the boundary). D1
 * access uses the shared `dbQuery` helper + `c.env.DB.prepare(...).run()` for
 * writes; unknown errors are classified via `classifyError()` and returned as an
 * `INTERNAL_ERROR` envelope. Known AppErrors (objects carrying `code`) are
 * re-thrown so the app-level error handler preserves their status.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { dbQuery } from '../../../src/services/db.js';
import { classifyError } from '../../../src/services/retry.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const notifications = new Hono<AppContext>();

notifications.get('/api/notifications', async (c) => {
  const requestId = c.get('requestId');
  const userId = c.get('userId');
  if (!userId)
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated', request_id: requestId } },
      401,
    );

  try {
    const limit = Math.min(Number(c.req.query('limit') || '30'), 100);
    const result = await dbQuery<{
      id: string;
      type: string;
      title: string;
      message: string;
      action_url: string;
      read: number;
      created_at: string;
    }>(
      c.env.DB,
      `SELECT id, type, title, message, action_url, read, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit],
    );

    const unreadCount = result.data.filter((n) => !n.read).length;
    return c.json({ data: result.data, unread_count: unreadCount });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const category = classifyError(err);
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'api',
        route: 'GET /api/notifications',
        error_category: category,
        request_id: requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load notifications',
          request_id: requestId,
        },
      },
      500,
    );
  }
});

notifications.patch('/api/notifications/:id/read', async (c) => {
  const requestId = c.get('requestId');
  const userId = c.get('userId');
  if (!userId)
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated', request_id: requestId } },
      401,
    );

  try {
    const notifId = c.req.param('id');
    await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
      .bind(notifId, userId)
      .run();

    return c.json({ data: { read: true } });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const category = classifyError(err);
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'api',
        route: 'PATCH /api/notifications/:id/read',
        error_category: category,
        request_id: requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to mark notification as read',
          request_id: requestId,
        },
      },
      500,
    );
  }
});

notifications.post('/api/notifications/read-all', async (c) => {
  const requestId = c.get('requestId');
  const userId = c.get('userId');
  if (!userId)
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated', request_id: requestId } },
      401,
    );

  try {
    await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0')
      .bind(userId)
      .run();

    return c.json({ data: { read_all: true } });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const category = classifyError(err);
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'api',
        route: 'POST /api/notifications/read-all',
        error_category: category,
        request_id: requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to mark all notifications as read',
          request_id: requestId,
        },
      },
      500,
    );
  }
});
