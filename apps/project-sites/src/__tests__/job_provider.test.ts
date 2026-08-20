/**
 * Convergence §20/§16/§23 — job-provider port, fake provider, dispatcher.
 *
 * Locks: idempotent dispatch (same key → same JobRef, no dup), context validation
 * (required fields + tenant-when-required), and the dispatcher routing each kind
 * to the provider for its resolved backend.
 */
import {
  FakeJobProvider,
  createJobRouter,
  validateJobContext,
  JobContextError,
  type ProjectSitesJobContext,
} from '../platform/job-provider.js';

const ctx = (over: Partial<ProjectSitesJobContext> = {}): ProjectSitesJobContext => ({
  tenantId: 'tenant-1',
  requestId: 'req-1',
  traceId: 'trace-1',
  idempotencyKey: 'idem-1',
  source: 'api',
  createdAt: '2026-06-20T00:00:00.000Z',
  ...over,
});

describe('validateJobContext', () => {
  it('passes a complete context', () => {
    expect(() => validateJobContext('site-generation', ctx())).not.toThrow();
  });

  it('throws on missing idempotencyKey', () => {
    expect(() => validateJobContext('site-generation', ctx({ idempotencyKey: '' }))).toThrow(
      JobContextError,
    );
  });

  it('requires tenantId for a tenant-scoped job', () => {
    try {
      validateJobContext('site-generation', ctx({ tenantId: undefined }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(JobContextError);
      expect((e as JobContextError).field).toBe('tenantId');
    }
  });

  it('allows missing tenantId for a non-tenant job (lead-scan)', () => {
    expect(() => validateJobContext('lead-scan', ctx({ tenantId: undefined }))).not.toThrow();
  });
});

describe('FakeJobProvider idempotency', () => {
  it('same idempotencyKey returns the same JobRef and dispatches once', async () => {
    const p = new FakeJobProvider();
    const a = await p.start('site-generation', ctx());
    const b = await p.start('site-generation', ctx());
    expect(a.jobId).toBe(b.jobId);
    expect(p.size).toBe(1);
  });

  it('distinct keys create distinct jobs', async () => {
    const p = new FakeJobProvider();
    await p.start('site-generation', ctx({ idempotencyKey: 'k1' }));
    await p.start('site-generation', ctx({ idempotencyKey: 'k2' }));
    expect(p.size).toBe(2);
  });

  it('records the routed backend on the ref', async () => {
    const p = new FakeJobProvider();
    expect((await p.start('site-generation', ctx())).backend).toBe('hatchet');
    expect((await p.start('claim-flow', ctx({ idempotencyKey: 'c1' }))).backend).toBe(
      'cloudflare-workflows',
    );
  });

  it('getJobStatus + cancelJob track lifecycle', async () => {
    const p = new FakeJobProvider();
    const ref = await p.start('site-generation', ctx());
    expect(await p.getJobStatus(ref.jobId)).toBe('queued');
    p.complete(ref.jobId);
    expect(await p.getJobStatus(ref.jobId)).toBe('completed');
    await p.cancelJob(ref.jobId);
    expect(await p.getJobStatus(ref.jobId)).toBe('cancelled');
    expect(await p.getJobStatus('missing')).toBeNull();
  });
});

describe('createJobRouter dispatch', () => {
  it('routes each kind to the provider for its backend', async () => {
    const hatchet = new FakeJobProvider();
    const cf = new FakeJobProvider();
    const router = createJobRouter({
      hatchet,
      'cloudflare-workflows': cf,
    });

    await router.start('site-generation', ctx({ idempotencyKey: 'sg' }));
    await router.start('claim-flow', ctx({ idempotencyKey: 'cf' }));
    await router.start('notification-workflow', ctx({ idempotencyKey: 'nw' }));

    expect(hatchet.size).toBe(1); // site-generation
    expect(cf.size).toBe(2); // claim-flow + notification-workflow (folded Inngest plane)
  });

  it('throws when no provider is registered for the resolved backend', async () => {
    const router = createJobRouter({ hatchet: new FakeJobProvider() });
    await expect(router.start('claim-flow', ctx())).rejects.toThrow(/No job provider registered/);
  });

  it('getJobStatus finds the job across providers', async () => {
    const hatchet = new FakeJobProvider();
    const router = createJobRouter({ hatchet, 'cloudflare-workflows': new FakeJobProvider() });
    const ref = await router.start('site-generation', ctx());
    expect(await router.getJobStatus(ref.jobId)).toBe('queued');
  });
});
