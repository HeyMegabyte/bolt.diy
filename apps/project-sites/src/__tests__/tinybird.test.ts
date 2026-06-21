import { resolveTinybird, resolveTinybirdAppend, ingestTinybirdEvent } from '../services/tinybird';

/**
 * Tinybird ingest adapter — env-gated OLAP analytics. Pure resolver + DI'd-fetch
 * fire-and-forget ingest; never throws, no real network. Mirrors the self_hosted
 * adapter pattern: null when unconfigured ⇒ caller is a safe no-op.
 */
const E = (o: Record<string, string | undefined>) => o as never;
const HOST = 'https://api.us-east.aws.tinybird.co';

describe('resolveTinybirdAppend (ingest token — append precedence)', () => {
  it('prefers an APPEND-capable token over the read-only PASSWORD', () => {
    // The worker has both MCP (admin/append) + PASSWORD (read-only) set; ingest
    // must pick MCP, not PASSWORD (which 403s on the Events API).
    expect(
      resolveTinybirdAppend(
        E({ TINYBIRD_API_HOST: HOST, TINYBIRD_PASSWORD: 'p.read', TINYBIRD_MCP_TOKEN: 'p.append' }),
      )?.token,
    ).toBe('p.append');
  });

  it('prefers a dedicated TINYBIRD_INGEST_TOKEN above all', () => {
    expect(
      resolveTinybirdAppend(
        E({
          TINYBIRD_API_HOST: HOST,
          TINYBIRD_INGEST_TOKEN: 'p.ingest',
          TINYBIRD_TOKEN: 'p.tok',
          TINYBIRD_MCP_TOKEN: 'p.mcp',
        }),
      )?.token,
    ).toBe('p.ingest');
  });

  it('falls back to PASSWORD only when no append token exists', () => {
    expect(
      resolveTinybirdAppend(E({ TINYBIRD_API_HOST: HOST, TINYBIRD_PASSWORD: 'p.pw' }))?.token,
    ).toBe('p.pw');
  });

  it('is null when host or token is absent', () => {
    expect(resolveTinybirdAppend(E({ TINYBIRD_MCP_TOKEN: 'x' }))).toBeNull();
    expect(resolveTinybirdAppend(E({ TINYBIRD_API_HOST: HOST }))).toBeNull();
  });
});

describe('resolveTinybird', () => {
  it('returns null when host is unset', () => {
    expect(resolveTinybird(E({ TINYBIRD_PASSWORD: 'p.tok' }))).toBeNull();
  });

  it('returns null when no token in the chain', () => {
    expect(resolveTinybird(E({ TINYBIRD_API_HOST: HOST }))).toBeNull();
  });

  it('returns null for a malformed host', () => {
    expect(
      resolveTinybird(E({ TINYBIRD_API_HOST: 'nope', TINYBIRD_PASSWORD: 'p.tok' })),
    ).toBeNull();
  });

  it('resolves host (trailing slash trimmed) + token precedence TOKEN > PASSWORD > MCP', () => {
    const cfg = resolveTinybird(
      E({
        TINYBIRD_API_HOST: HOST + '/',
        TINYBIRD_TOKEN: 'p.primary',
        TINYBIRD_PASSWORD: 'p.pw',
        TINYBIRD_MCP_TOKEN: 'p.mcp',
      }),
    );
    expect(cfg?.apiHost).toBe(HOST);
    expect(cfg?.token).toBe('p.primary');
  });

  it('falls back to PASSWORD then MCP token', () => {
    expect(resolveTinybird(E({ TINYBIRD_API_HOST: HOST, TINYBIRD_PASSWORD: 'p.pw' }))?.token).toBe(
      'p.pw',
    );
    expect(
      resolveTinybird(E({ TINYBIRD_API_HOST: HOST, TINYBIRD_MCP_TOKEN: 'p.mcp' }))?.token,
    ).toBe('p.mcp');
  });
});

describe('ingestTinybirdEvent', () => {
  const env = E({ TINYBIRD_API_HOST: HOST, TINYBIRD_PASSWORD: 'p.tok' });

  it('no-ops (not_configured) when env-gated off — never sends', async () => {
    const fetchImpl = jasmineSpy();
    const r = await ingestTinybirdEvent(
      E({}),
      'site_events',
      { site_id: 's1', event: 'x' },
      {
        fetchImpl: fetchImpl.fn,
      },
    );
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
    expect(fetchImpl.calls).toBe(0);
  });

  it('returns no_events for an empty array', async () => {
    const r = await ingestTinybirdEvent(env, 'site_events', [], {});
    expect(r.reason).toBe('no_events');
  });

  it('POSTs NDJSON to the events API with bearer + auto-stamped timestamp', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response('{"successful_rows":1}', { status: 202 });
    }) as unknown as typeof fetch;
    const r = await ingestTinybirdEvent(
      env,
      'site events',
      { site_id: 's1', tenant_id: 't1', event: 'page_view' },
      { fetchImpl, now: () => '2026-06-19T00:00:00Z' },
    );
    expect(r.ok).toBe(true);
    expect(r.status).toBe(202);
    expect(captured.url).toBe(`${HOST}/v0/events?name=site%20events`);
    expect((captured.init?.headers as Record<string, string>).Authorization).toBe('Bearer p.tok');
    const body = String(captured.init?.body);
    expect(body).toContain('"site_id":"s1"');
    expect(body).toContain('"timestamp":"2026-06-19T00:00:00Z"');
  });

  it('preserves a caller-supplied timestamp', async () => {
    let body = '';
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return new Response('', { status: 202 });
    }) as unknown as typeof fetch;
    await ingestTinybirdEvent(
      env,
      'ds',
      { site_id: 's1', event: 'x', timestamp: '2020-01-01T00:00:00Z' },
      { fetchImpl, now: () => 'WRONG' },
    );
    expect(body).toContain('2020-01-01T00:00:00Z');
    expect(body).not.toContain('WRONG');
  });

  it('joins multiple events as NDJSON (one JSON per line)', async () => {
    let body = '';
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return new Response('', { status: 202 });
    }) as unknown as typeof fetch;
    await ingestTinybirdEvent(
      env,
      'ds',
      [
        { site_id: 's1', event: 'a', timestamp: 't' },
        { site_id: 's1', event: 'b', timestamp: 't' },
      ],
      { fetchImpl },
    );
    expect(body.split('\n').length).toBe(2);
  });

  it('maps a non-2xx response to http_error (never throws)', async () => {
    const fetchImpl = (async () =>
      new Response('bad token', { status: 403 })) as unknown as typeof fetch;
    const r = await ingestTinybirdEvent(env, 'ds', { site_id: 's1', event: 'x' }, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: 'http_error', status: 403 });
  });

  it('maps a thrown fetch to network_error (never throws)', async () => {
    const fetchImpl = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const r = await ingestTinybirdEvent(env, 'ds', { site_id: 's1', event: 'x' }, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: 'network_error' });
  });
});

/** Tiny call-counter (worker suite is Jest; keep deps zero). */
function jasmineSpy() {
  const state = { calls: 0 };
  const fn = (async () => {
    state.calls++;
    return new Response('', { status: 202 });
  }) as unknown as typeof fetch;
  return {
    fn,
    get calls() {
      return state.calls;
    },
  };
}
