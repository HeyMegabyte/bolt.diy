/**
 * fetchPipeRows — fail-soft raw-rollup pipe reader. Maps queryTinybirdPipe's
 * typed result to { rows, degraded }: rows on ok, []+degraded on any non-ok.
 */
import { fetchPipeRows, type EventsDailyRow } from '../services/analytics_query.js';

const ENV = { TINYBIRD_API_HOST: 'https://api.x.tinybird.co', TINYBIRD_PASSWORD: 'p.tok' } as never;

function okRes(rows: unknown[]): Response {
  return { ok: true, status: 200, json: async () => ({ data: rows }) } as unknown as Response;
}

describe('fetchPipeRows', () => {
  it('returns the pipe rows (not degraded) on a successful read', async () => {
    const rows = [{ tenant_id: 't1', day: '2026-06-20', event: 'site.published', events: 4 }];
    const fetchImpl = jest.fn().mockResolvedValue(okRes(rows));
    const r = await fetchPipeRows<EventsDailyRow>(
      ENV,
      'events_by_tenant_daily',
      { tenant_id: 't1', days: 30 },
      { fetchImpl: fetchImpl as never },
    );
    expect(r.degraded).toBe(false);
    expect(r.rows).toEqual(rows);
    // params reach the pipe URL (read seam drops nothing defined)
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('/v0/pipes/events_by_tenant_daily.json?');
    expect(url).toContain('tenant_id=t1');
    expect(url).toContain('days=30');
  });

  it('degrades to [] when Tinybird is unconfigured', async () => {
    const r = await fetchPipeRows({} as never, 'events_by_tenant_daily', { tenant_id: 't1' });
    expect(r).toEqual({ rows: [], degraded: true });
  });

  it('degrades to [] when the pipe read errors (never throws)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    const r = await fetchPipeRows(
      ENV,
      'site_publishes_by_source',
      {},
      { fetchImpl: fetchImpl as never },
    );
    expect(r).toEqual({ rows: [], degraded: true });
  });
});
