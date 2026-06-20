/**
 * @module routes/jobs
 *
 * @description
 * `POST /api/jobs` + `GET /api/jobs/:id/status` — the authed dispatch seam for the
 * WorkflowRouter (§20). The handler builds a typed `ProjectSitesJobContext`
 * (trace + idempotency + tenant from the session) and calls
 * `getJobRouter(c.env).start(kind, ctx, payload)`, which routes to the correct
 * execution plane (CF Workflows / Inngest / Hatchet). App code never touches a
 * vendor SDK (§11/§74.12).
 *
 * Hot path (§22): validate + dispatch only — the heavy work runs in the chosen
 * plane, never inline. Mutations are idempotent via the `Idempotency-Key` header
 * (§23). Auth is required (§61): no `userId` → 401.
 *
 * The router factory is injectable for tests (`createJobsRoutes(fakeFactory)`).
 *
 * @see docs/adr/0003-cloudflare-workflows-inngest-hatchet-routing.md
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { isJobKind } from '../platform/workflow-router.js';
import {
  JobContextError,
  type ProjectSitesJobContext,
  type ProjectSitesJobProvider,
} from '../platform/job-provider.js';
import { getJobRouter } from '../platform/job-router-factory.js';

type Ctx = { Bindings: Env; Variables: Variables };

const StartJobSchema = z
  .object({
    kind: z.string().min(1),
    payload: z.unknown().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();

function envelope(requestId: string, code: string, message: string) {
  return { error: { code, message, request_id: requestId } };
}

/**
 * Build the jobs sub-app. `getRouter` defaults to the real env-bound factory;
 * tests inject a fake.
 *
 * @example app.route('/', createJobsRoutes())
 */
export function createJobsRoutes(
  getRouter: (env: Env) => ProjectSitesJobProvider = getJobRouter,
): Hono<Ctx> {
  const app = new Hono<Ctx>();

  app.post('/api/jobs', async (c) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    const userId = c.get('userId');
    if (!userId) return c.json(envelope(requestId, 'UNAUTHORIZED', 'Authentication required'), 401);

    const raw = await c.req.json().catch(() => null);
    const parsed = StartJobSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(envelope(requestId, 'VALIDATION_ERROR', parsed.error.message), 400);
    }
    const { kind, payload, idempotencyKey } = parsed.data;
    if (!isJobKind(kind)) {
      return c.json(envelope(requestId, 'BAD_REQUEST', `Unknown job kind: ${kind}`), 400);
    }

    const ctx: ProjectSitesJobContext = {
      tenantId: c.get('orgId'),
      userId,
      requestId,
      traceId: c.req.header('x-trace-id') ?? requestId,
      idempotencyKey: c.req.header('idempotency-key') ?? idempotencyKey ?? crypto.randomUUID(),
      source: 'api',
      createdAt: new Date().toISOString(),
    };

    try {
      const ref = await getRouter(c.env).start(kind, ctx, payload);
      return c.json({ data: ref }, 202);
    } catch (err) {
      if (err instanceof JobContextError) {
        return c.json(envelope(requestId, 'VALIDATION_ERROR', err.message), 400);
      }
      return c.json(
        envelope(requestId, 'JOB_DISPATCH_ERROR', err instanceof Error ? err.message : String(err)),
        502,
      );
    }
  });

  app.get('/api/jobs/:id/status', async (c) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    if (!c.get('userId'))
      return c.json(envelope(requestId, 'UNAUTHORIZED', 'Authentication required'), 401);

    const jobId = c.req.param('id');
    const status = await getRouter(c.env).getJobStatus(jobId);
    if (status === null) return c.json(envelope(requestId, 'NOT_FOUND', 'Job not found'), 404);
    return c.json({ data: { jobId, status } });
  });

  return app;
}
