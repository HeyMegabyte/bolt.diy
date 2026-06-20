/**
 * queryTinybirdPipe — the pipe READ seam (counterpart to ingestTinybirdEvent).
 * Resolve→fetch→typed-result, never throws; `data` is always an array.
 */
import { queryTinybirdPipe } from '../services/tinybird.js';

const ENV = { TINYBIRD_API_HOST: 'https://api.x.tinybird.co', TINYBIRD_PASSWORD: 'p.tok' } as never;

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('queryTinybirdPipe', () => {
  it('returns not_configured (empty data) when Tinybird is env-gated off', async () => {
    const r = await queryTinybirdPipe({} as never, 'activation_funnel');
    expect(r).toEqual({ ok: false, reason: 'not_configured', data: [] });
  });

  it('builds the pipe URL with Bearer auth + drops undefined/empty params', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(res(200, { data: [{ stage: 'x' }] }));
    const r = await queryTinybirdPipe(
      ENV,
      'activation_funnel',
      { tenant_id: 'org-1', days: 30, source: undefined, blank: '' },
      { fetchImpl: fetchImpl as never },
    );
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([{ stage: 'x' }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://api.x.tinybird.co/v0/pipes/activation_funnel.json?tenant_id=org-1&days=30',
    );
    expect(init.headers.Authorization).toBe('Bearer p.tok');
  });

  it('maps a non-2xx to http_error with empty data (never throws)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(res(403, {}));
    const r = await queryTinybirdPipe(ENV, 'p', {}, { fetchImpl: fetchImpl as never });
    expect(r).toEqual({ ok: false, reason: 'http_error', status: 403, data: [] });
  });

  it('maps a network throw to network_error with empty data', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('down'));
    const r = await queryTinybirdPipe(ENV, 'p', {}, { fetchImpl: fetchImpl as never });
    expect(r).toEqual({ ok: false, reason: 'network_error', data: [] });
  });

  it('maps a bad JSON body to parse_error', async () => {
    const bad = {
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response;
    const fetchImpl = jest.fn().mockResolvedValue(bad);
    const r = await queryTinybirdPipe(ENV, 'p', {}, { fetchImpl: fetchImpl as never });
    expect(r).toEqual({ ok: false, reason: 'parse_error', status: 200, data: [] });
  });

  it('coerces a missing data array to []', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(res(200, { meta: [] }));
    const r = await queryTinybirdPipe(ENV, 'p', {}, { fetchImpl: fetchImpl as never });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([]);
  });
});
