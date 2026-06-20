/**
 * fetchActivationFunnel — the I/O layer over the activation_funnel pipe.
 * Always returns all four stages in order; missing stages → 0; fail-soft to a
 * zero funnel (degraded) when Tinybird is unconfigured or the read fails.
 */
import { fetchActivationFunnel } from '../services/activation_funnel_query.js';

const ENV = { TINYBIRD_API_HOST: 'https://api.x.tinybird.co', TINYBIRD_PASSWORD: 'p.tok' } as never;

function okRes(rows: unknown[]): Response {
  return { ok: true, status: 200, json: async () => ({ data: rows }) } as unknown as Response;
}

describe('fetchActivationFunnel', () => {
  it('degrades to a zero funnel (all 4 stages at 0) when Tinybird is unconfigured', async () => {
    const r = await fetchActivationFunnel({} as never, { tenantId: 'org-1' });
    expect(r.degraded).toBe(true);
    expect(r.stages.map((s) => s.stage)).toEqual([
      'lead.discovered',
      'site.claim.started',
      'site.published',
      'subscription.active',
    ]);
    expect(r.stages.every((s) => s.events === 0 && s.sites === 0)).toBe(true);
  });

  it('projects pipe rows onto the canonical ordered stages, filling gaps with 0', async () => {
    // pipe returns only two stages, out of order, with string counts
    const fetchImpl = jest.fn().mockResolvedValue(
      okRes([
        { stage: 'subscription.active', events: '3', sites: '3' },
        { stage: 'lead.discovered', events: '40', sites: '37' },
      ]),
    );
    const r = await fetchActivationFunnel(
      ENV,
      { tenantId: 'org-1', days: 30 },
      { fetchImpl: fetchImpl as never },
    );
    expect(r.degraded).toBe(false);
    // order is always top→bottom regardless of pipe order
    expect(r.stages.map((s) => s.ordinal)).toEqual([0, 1, 2, 3]);
    const byStage = Object.fromEntries(r.stages.map((s) => [s.stage, s]));
    expect(byStage['lead.discovered'].sites).toBe(37); // coerced from string
    expect(byStage['subscription.active'].events).toBe(3);
    expect(byStage['site.claim.started'].events).toBe(0); // gap filled
    expect(byStage['site.published'].sites).toBe(0);
    expect(byStage['lead.discovered'].label).toBe('Discovered');
  });

  it('degrades when the pipe read errors (http_error → zero funnel)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    const r = await fetchActivationFunnel(ENV, {}, { fetchImpl: fetchImpl as never });
    expect(r.degraded).toBe(true);
    expect(r.stages).toHaveLength(4);
  });
});
