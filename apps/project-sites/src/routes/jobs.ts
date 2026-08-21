/**
 * @module routes/jobs
 *
 * @description
 * `POST /api/jobs` + `GET /api/jobs/:id/status` — the authed dispatch seam for the
 * WorkflowRouter (§20). The handler builds a typed `ProjectSitesJobContext`
 * (trace + idempotency + tenant from the session) and calls
 * `getJobRouter(c.env).start(kind, ctx, payload)`, which routes to the correct
 * execution plane (CF Workflows / Hatchet). App code never touches a
 * vendor SDK (§11/§74.12).
 *
 * Hot path (§22): validate + dispatch only — the heavy work runs in the chosen
 * plane, never inline. Mutations are idempotent via the `Idempotency-Key` header
 * (§23). Auth is required (§61): no `userId` → 401. Errors flow through the
 * shared taxonomy (`platform/errors`, §62) → stable code + status + request_id.
 *
 * The router factory is injectable for tests (`createJobsRoutes(fakeFactory)`).
 *
 * @see docs/decisions/0034-platform-consolidation-cf-native.md
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
import {
  BadRequestError,
  JobDispatchError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  toErrorResponse,
} from '../platform/errors.js';

type Ctx = { Bindings: Env; Variables: Variables };

const StartJobSchema = z
  .object({
    kind: z.string().min(1),
    payload: z.unknown().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();

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
    try {
      const userId = c.get('userId');
      if (!userId) throw new UnauthorizedError('Authentication required');

      const parsed = StartJobSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new ValidationError(parsed.error.message);

      const { kind, payload, idempotencyKey } = parsed.data;
      if (!isJobKind(kind)) throw new BadRequestError(`Unknown job kind: ${kind}`);

      const ctx: ProjectSitesJobContext = {
        tenantId: c.get('orgId'),
        userId,
        requestId,
        traceId: c.req.header('x-trace-id') ?? requestId,
        idempotencyKey: c.req.header('idempotency-key') ?? idempotencyKey ?? crypto.randomUUID(),
        source: 'api',
        createdAt: new Date().toISOString(),
      };

      let ref;
      try {
        ref = await getRouter(c.env).start(kind, ctx, payload);
      } catch (err) {
        // A bad context is a 400; a plane/dispatch failure is a 502.
        if (err instanceof JobContextError) throw new ValidationError(err.message);
        throw new JobDispatchError(err instanceof Error ? err.message : String(err));
      }
      return c.json({ data: ref }, 202);
    } catch (err) {
      const { body, status } = toErrorResponse(err, requestId);
      return c.json(body, status as 400 | 401 | 402 | 403 | 404 | 409 | 429 | 500 | 502 | 503);
    }
  });

  app.get('/api/jobs/:id/status', async (c) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    try {
      if (!c.get('userId')) throw new UnauthorizedError('Authentication required');
      const jobId = c.req.param('id');
      const status = await getRouter(c.env).getJobStatus(jobId);
      if (status === null) throw new NotFoundError('Job not found');
      return c.json({ data: { jobId, status } });
    } catch (err) {
      const { body, status } = toErrorResponse(err, requestId);
      return c.json(body, status as 401 | 404 | 500);
    }
  });

  return app;
}
