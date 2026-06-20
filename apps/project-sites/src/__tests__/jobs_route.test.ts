/**
 * Convergence §20/§22/§23/§61 — /api/jobs dispatch route.
 *
 * Auth-gated (no userId → 401), Zod-validated, idempotency-header threaded, kind
 * validated against JOB_DEFINITIONS, dispatched via an injected router; status
 * read endpoint. The router is faked so the route is tested without real planes.
 */
import { Hono } from 'hono';
import { createJobsRoutes } from '../routes/jobs.js';
import {
  JobContextError,
  type JobRef,
  type JobStatus,
  type ProjectSitesJobContext,
  type ProjectSitesJobProvider,
} from '../platform/job-provider.js';
import type { JobKind } from '../platform/workflow-router.js';
import type { Env, Variables } from '../types/env.js';

function fakeRouter(over: Partial<ProjectSitesJobProvider> = {}): ProjectSitesJobProvider {
  return {
    async start(kind, ctx): Promise<JobRef> {
      return {
        jobId: ctx.idempotencyKey,
        kind,
        backend: 'hatchet',
        status: 'queued' as JobStatus,
        idempotencyKey: ctx.idempotencyKey,
        createdAt: ctx.createdAt,
      };
    },
    async getJobStatus() {
      return null;
    },
    async cancelJob() {},
    ...over,
  };
}

/** App with an auth middleware that sets userId/orgId (mimics the global stack). */
function authedApp(router: ProjectSitesJobProvider, withUser = true) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (withUser) {
      c.set('userId', 'user-1');
      c.set('orgId', 'org-1');
    }
    await next();
  });
  app.route('/', createJobsRoutes(() => router));
  return app;
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }) as RequestInit;

describe('POST /api/jobs', () => {
  it('dispatches a valid job → 202 with the JobRef', async () => {
    const app = authedApp(fakeRouter());
    const res = await app.request('/api/jobs', post({ kind: 'site-generation', payload: { slug: 'a' } }, { 'idempotency-key': 'idem-9' }), {} as Env);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { data: JobRef };
    expect(body.data).toMatchObject({ kind: 'site-generation', backend: 'hatchet', jobId: 'idem-9', status: 'queued' });
  });

  it('401 without auth', async () => {
    const app = authedApp(fakeRouter(), false);
    const res = await app.request('/api/jobs', post({ kind: 'site-generation' }), {} as Env);
    expect(res.status).toBe(401);
  });

  it('400 on unknown job kind', async () => {
    const app = authedApp(fakeRouter());
    const res = await app.request('/api/jobs', post({ kind: 'not-a-real-job' }), {} as Env);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });

  it('400 on malformed body (extra key / missing kind)', async () => {
    const app = authedApp(fakeRouter());
    expect((await app.request('/api/jobs', post({ nope: 1 }), {} as Env)).status).toBe(400);
  });

  it('maps JobContextError → 400, other dispatch errors → 502', async () => {
    const ctxErr = authedApp(fakeRouter({ async start(): Promise<JobRef> { throw new JobContextError('tenantId required', 'tenantId'); } }));
    expect((await ctxErr.request('/api/jobs', post({ kind: 'site-generation' }), {} as Env)).status).toBe(400);

    const dispatchErr = authedApp(fakeRouter({ async start(): Promise<JobRef> { throw new Error('plane down'); } }));
    expect((await dispatchErr.request('/api/jobs', post({ kind: 'site-generation' }), {} as Env)).status).toBe(502);
  });
});

describe('GET /api/jobs/:id/status', () => {
  it('returns status when found', async () => {
    const app = authedApp(fakeRouter({ async getJobStatus() { return 'running'; } }));
    const res = await app.request('/api/jobs/abc/status', {}, {} as Env);
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { status: string } }).data.status).toBe('running');
  });

  it('404 when the job is unknown', async () => {
    const app = authedApp(fakeRouter());
    expect((await app.request('/api/jobs/missing/status', {}, {} as Env)).status).toBe(404);
  });

  it('401 without auth', async () => {
    const app = authedApp(fakeRouter(), false);
    expect((await app.request('/api/jobs/abc/status', {}, {} as Env)).status).toBe(401);
  });
});
