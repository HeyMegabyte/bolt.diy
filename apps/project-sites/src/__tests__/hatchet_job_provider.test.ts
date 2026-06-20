/**
 * Convergence §20/§23 — HatchetJobProvider adapter (the heavy plane).
 *
 * Locks: heavy kinds push the mapped Hatchet event with ctx in data + string
 * metadata, push failure surfaces as a throw, and the adapter refuses kinds that
 * don't route to Hatchet.
 */
import { HatchetJobProvider, type HatchetPusher } from '../services/hatchet_job_provider.js';
import type { ProjectSitesJobContext } from '../platform/job-provider.js';
import type { HatchetPushResult } from '../services/hatchet.js';

const ctx = (over: Partial<ProjectSitesJobContext> = {}): ProjectSitesJobContext => ({
  tenantId: 'tenant-1',
  requestId: 'req-1',
  traceId: 'trace-1',
  idempotencyKey: 'idem-1',
  source: 'api',
  createdAt: '2026-06-20T00:00:00.000Z',
  ...over,
});

function fakePusher(result: HatchetPushResult = { ok: true }) {
  const calls: { key: string; data: Record<string, unknown>; metadata?: Record<string, string> }[] =
    [];
  const pusher: HatchetPusher = async (key, data, opts) => {
    calls.push({ key, data, metadata: opts?.metadata });
    return result;
  };
  return Object.assign(pusher, { calls });
}

describe('HatchetJobProvider', () => {
  it('pushes the mapped event with ctx in data + string metadata', async () => {
    const pusher = fakePusher();
    const ref = await new HatchetJobProvider(pusher).start('site-generation', ctx(), {
      slug: 'acme',
    });

    expect(pusher.calls).toHaveLength(1);
    expect(pusher.calls[0].key).toBe('job/site-generation.requested');
    const data = pusher.calls[0].data as { payload: unknown; _ctx: { traceId: string } };
    expect(data.payload).toEqual({ slug: 'acme' });
    expect(data._ctx.traceId).toBe('trace-1');
    expect(pusher.calls[0].metadata).toMatchObject({
      idempotencyKey: 'idem-1',
      tenantId: 'tenant-1',
    });
    expect(ref).toMatchObject({
      backend: 'hatchet',
      kind: 'site-generation',
      jobId: 'idem-1',
      status: 'queued',
    });
  });

  it('maps each heavy kind to its event', async () => {
    const pusher = fakePusher();
    const p = new HatchetJobProvider(pusher);
    await p.start('lead-scan', ctx({ tenantId: undefined, idempotencyKey: 'a' }));
    await p.start('screenshot-job', ctx({ idempotencyKey: 'b' }));
    await p.start('crawl-job', ctx({ idempotencyKey: 'c' }));
    await p.start('browser-job', ctx({ idempotencyKey: 'd' }));
    expect(pusher.calls.map((c) => c.key)).toEqual([
      'job/lead-scan.requested',
      'job/screenshot.requested',
      'job/crawl.requested',
      'job/browser.requested',
    ]);
  });

  it('throws when the Hatchet push fails', async () => {
    const pusher = fakePusher({ ok: false, reason: 'http_error', status: 500 });
    await expect(new HatchetJobProvider(pusher).start('site-generation', ctx())).rejects.toThrow(
      /Hatchet push failed.*http_error.*500/,
    );
  });

  it('refuses a kind that does not route to Hatchet', async () => {
    const pusher = fakePusher();
    await expect(new HatchetJobProvider(pusher).start('claim-flow', ctx())).rejects.toThrow(
      /not a Hatchet job/,
    );
    expect(pusher.calls).toHaveLength(0);
  });

  it('validates context before pushing', async () => {
    const pusher = fakePusher();
    await expect(
      new HatchetJobProvider(pusher).start('site-generation', ctx({ traceId: '' })),
    ).rejects.toThrow();
    expect(pusher.calls).toHaveLength(0);
  });

  it('getJobStatus null + cancel no-op (runs REST follow-on)', async () => {
    const p = new HatchetJobProvider(fakePusher());
    expect(await p.getJobStatus('idem-1')).toBeNull();
    await expect(p.cancelJob('idem-1')).resolves.toBeUndefined();
  });
});
