/**
 * @module libs/features/inbox/handlers
 *
 * @description
 * Hono routes for the admin **task tray** (HITL elicitation inbox). AI
 * site-generation workflows post elicitation rows via `services/task_inbox.ts`;
 * the dashboard polls `GET /api/inbox/tasks` for the caller's open tasks and
 * resolves a chosen option via `POST /api/inbox/tasks/:id/resolve`, which fans
 * the answer back into the originating workflow (`SITE_GENERATION.sendEvent`,
 * Workflows v2) or silently no-ops when that binding is unwired — see
 * `resolveTask`.
 *
 * | Method | Path                         | Auth  | Purpose                     |
 * | ------ | ---------------------------- | ----- | --------------------------- |
 * | GET    | /api/inbox/tasks             | orgId | List open (unexpired) tasks |
 * | POST   | /api/inbox/tasks/:id/resolve | orgId | Resolve one org-owned task  |
 *
 * Extracted verbatim from the `api.ts` monolith (route-decomposition
 * installment 3). **Core, un-gated** routes — a route-organization module, not a
 * dark-launched feature. Every route is org-scoped via `c.get('orgId')` (401 when
 * missing); the resolve path re-verifies the task belongs to the caller's org
 * against `ai_task_inbox` BEFORE mutating, so a caller can never resolve another
 * org's task by guessing an id. The `task_inbox.ts` service is loaded lazily via
 * dynamic `import()` (keeps it off the hot path for the common no-task case). The
 * only body field (`choice`) is validated inline (non-empty string) — no `as {…}`
 * cast survives past that guard — so there is no `schemas.ts`.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { badRequest, unauthorized } from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';
import { dbQueryOne } from '../../../src/services/db.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const inbox = new Hono<AppContext>();

inbox.get('/api/inbox/tasks', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const { listOpenTasks } = await import('../../../src/services/task_inbox.js');
  const tasks = await listOpenTasks(c.env, orgId);
  return c.json({ tasks });
});

inbox.post('/api/inbox/tasks/:id/resolve', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { choice?: unknown };
  const choice = typeof body.choice === 'string' ? body.choice.trim() : '';
  if (!choice) throw badRequest('choice is required');

  // Cross-org guard — verify the task belongs to this org before resolving.
  const owns = await dbQueryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM ai_task_inbox WHERE id = ? AND org_id = ? LIMIT 1',
    [id, orgId],
  );
  if (!owns) throw unauthorized('Task not found for this org');

  const { resolveTask } = await import('../../../src/services/task_inbox.js');
  const ok = await resolveTask(c.env, id, { choice, by: userId ?? undefined });
  return c.json({ ok });
});
