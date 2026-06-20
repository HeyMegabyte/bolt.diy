import {
  decodeJwtPayload,
  resolveHatchet,
  hatchetAuthedFetch,
  pushHatchetEvent,
} from '../services/hatchet';

/**
 * Hatchet dispatch adapter — the event_bus outbox's orchestration target.
 * Config resolves FROM the JWT (server_url + sub claims); env-gated; never throws.
 * DI'd fetch — no real network. Request SHAPE is asserted, not a live call.
 */
const E = (o: Record<string, string | undefined>) => o as never;

/** A minimal unsigned JWT with the two claims the adapter reads. */
function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${b64({ alg: 'ES256' })}.${b64(claims)}.sig`;
}

const TOK = jwt({ server_url: 'https://cloud-shard-4.us-east-1.onhatchet.run', sub: 'tenant-abc' });

describe('decodeJwtPayload', () => {
  it('decodes base64url claims', () => {
    expect(decodeJwtPayload(TOK).sub).toBe('tenant-abc');
  });
  it('returns {} for malformed input (never throws)', () => {
    expect(decodeJwtPayload('garbage')).toEqual({});
    expect(decodeJwtPayload('a.!!!.c')).toEqual({});
  });
});

describe('resolveHatchet', () => {
  it('returns null with no token', () => {
    expect(resolveHatchet(E({}))).toBeNull();
  });

  it('derives serverUrl + tenantId from the JWT claims', () => {
    const cfg = resolveHatchet(E({ HATCHET_API_TOKEN: TOK }));
    expect(cfg?.serverUrl).toBe('https://cloud-shard-4.us-east-1.onhatchet.run');
    expect(cfg?.tenantId).toBe('tenant-abc');
    expect(cfg?.eventsPath).toBe('/api/v1/stable/tenants/{tenant}/events');
  });

  it('env overrides win over JWT claims', () => {
    const cfg = resolveHatchet(
      E({
        HATCHET_API_TOKEN: TOK,
        HATCHET_SERVER_URL: 'https://override.run/',
        HATCHET_TENANT_ID: 't2',
        HATCHET_EVENTS_PATH: '/api/v1/events',
      }),
    );
    expect(cfg?.serverUrl).toBe('https://override.run'); // trailing slash trimmed
    expect(cfg?.tenantId).toBe('t2');
    expect(cfg?.eventsPath).toBe('/api/v1/events');
  });

  it('returns null when the token has no server_url/sub and no overrides', () => {
    expect(resolveHatchet(E({ HATCHET_API_TOKEN: jwt({ foo: 'bar' }) }))).toBeNull();
  });
});

describe('hatchetAuthedFetch', () => {
  it('599 sentinel when unconfigured (never throws)', async () => {
    const res = await hatchetAuthedFetch(E({}), '/x');
    expect(res.status).toBe(599);
  });

  it('prepends serverUrl + Bearer token', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    await hatchetAuthedFetch(E({ HATCHET_API_TOKEN: TOK }), '/api/v1/health', {}, { fetchImpl });
    expect(captured.url).toBe('https://cloud-shard-4.us-east-1.onhatchet.run/api/v1/health');
    expect((captured.init?.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it('599 on a thrown fetch (never throws)', async () => {
    const fetchImpl = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const res = await hatchetAuthedFetch(E({ HATCHET_API_TOKEN: TOK }), '/x', {}, { fetchImpl });
    expect(res.status).toBe(599);
  });
});

describe('pushHatchetEvent', () => {
  const env = E({ HATCHET_API_TOKEN: TOK });

  it('not_configured no-op when env-gated off', async () => {
    const r = await pushHatchetEvent(E({}), 'site.published', { siteId: 's1' });
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('POSTs the event envelope to the tenant-substituted events path', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const r = await pushHatchetEvent(
      env,
      'site.published',
      { siteId: 's1' },
      { metadata: { tenant_id: 'tenant-abc' }, fetchImpl },
    );
    expect(r.ok).toBe(true);
    expect(captured.url).toBe(
      'https://cloud-shard-4.us-east-1.onhatchet.run/api/v1/stable/tenants/tenant-abc/events',
    );
    const body = JSON.parse(String(captured.init?.body));
    expect(body.key).toBe('site.published');
    expect(body.data.siteId).toBe('s1');
    expect(body.additionalMetadata.tenant_id).toBe('tenant-abc');
  });

  it('maps non-2xx → http_error (never throws)', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const r = await pushHatchetEvent(env, 'k', { a: 1 }, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: 'http_error', status: 401 });
  });

  it('maps a network failure → network_error (never throws)', async () => {
    const fetchImpl = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const r = await pushHatchetEvent(env, 'k', { a: 1 }, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: 'network_error' });
  });
});
