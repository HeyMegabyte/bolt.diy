/**
 * Convergence §20 — getJobRouter wiring.
 *
 * Asserts the factory routes each kind to the correct plane's injected dep:
 * light/CF-native→cfBindings, heavy→hatchetPush — proving the two adapters are
 * assembled correctly behind one ProjectSitesJobProvider. (The Inngest adapter
 * was removed 2026-08-20 with the §13 plane.)
 */
import { getJobRouter } from '../platform/job-router-factory.js';
import type { Env } from '../types/env.js';
import type { ProjectSitesJobContext } from '../platform/job-provider.js';
import type { HatchetPusher } from '../services/hatchet_job_provider.js';
import type { CfWorkflowBinding, CfWorkflowInstanceLike } from '../workflows/job-provider.js';

const env = {} as Env; // unused when deps are injected
const ctx = (over: Partial<ProjectSitesJobContext> = {}): ProjectSitesJobContext => ({
  tenantId: 'tenant-1',
  requestId: 'req-1',
  traceId: 'trace-1',
  idempotencyKey: 'idem-1',
  source: 'api',
  createdAt: '2026-06-20T00:00:00.000Z',
  ...over,
});

function deps() {
  const hatchetPushed: { key: string }[] = [];
  const cfCreated: { id: string }[] = [];

  const hatchetPush: HatchetPusher = async (key) => {
    hatchetPushed.push({ key });
    return { ok: true };
  };
  const claimBinding: CfWorkflowBinding = {
    async create(opts) {
      cfCreated.push({ id: opts.id });
      const inst: CfWorkflowInstanceLike = {
        id: opts.id,
        async status() {
          return { status: 'queued' };
        },
      };
      return inst;
    },
    async get(id) {
      return {
        id,
        async status() {
          return { status: 'queued' };
        },
      };
    },
  };
  return {
    seams: { hatchetPush, cfBindings: { 'claim-flow': claimBinding } as const },
    hatchetPushed,
    cfCreated,
  };
}

describe('getJobRouter', () => {
  it('returns a provider with the full port surface', () => {
    const r = getJobRouter(env, deps().seams);
    expect(typeof r.start).toBe('function');
    expect(typeof r.getJobStatus).toBe('function');
    expect(typeof r.cancelJob).toBe('function');
  });

  it('routes site-generation → Hatchet, notification → CF, claim-flow → CF', async () => {
    const d = deps();
    const router = getJobRouter(env, {
      ...d.seams,
      cfBindings: {
        'claim-flow': d.seams.cfBindings?.['claim-flow']!,
        'notification-workflow': d.seams.cfBindings?.['claim-flow']!,
      },
    });

    await router.start('site-generation', ctx({ idempotencyKey: 'sg' }), { slug: 'a' });
    await router.start('notification-workflow', ctx({ idempotencyKey: 'nw' }));
    await router.start('claim-flow', ctx({ idempotencyKey: 'cf' }), { leadId: 'l1' });

    expect(d.hatchetPushed.map((x) => x.key)).toEqual(['job/site-generation.requested']);
    expect(d.cfCreated.map((x) => x.id)).toEqual(['nw', 'cf']);
  });

  it('a CF-native kind with no bound Workflow fails loudly (not silent)', async () => {
    const d = deps();
    const router = getJobRouter(env, { ...d.seams, cfBindings: {} }); // no claim binding
    await expect(router.start('claim-flow', ctx())).rejects.toThrow(
      /No Cloudflare Workflow binding/,
    );
  });
});
