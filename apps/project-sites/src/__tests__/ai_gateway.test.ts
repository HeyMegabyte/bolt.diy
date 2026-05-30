import type { Env } from '../types/env.js';
import {
  DEFAULT_GATEWAY_NAME,
  DEFAULT_CACHE_TTL_SECONDS,
  GatewayCallOptionsSchema,
  isGatewayActive,
  gatewayName,
  gatewayBaseUrl,
  gatewayUrl,
  buildGatewayHeaders,
  gatewayFetch,
  gatewayMetadata,
} from '../services/ai_gateway.js';

const ACCT = '84fa0d1b16ff8086dd958c468ce7fd59';

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    CF_ACCOUNT_ID: ACCT,
    AI_GATEWAY_ENABLED: 'true',
    ENVIRONMENT: 'test',
    ...overrides,
  } as unknown as Env;
}

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function okResponse(): Response {
  return new Response('{}', { status: 200 });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── isGatewayActive ──────────────────────────────────────────

describe('isGatewayActive', () => {
  it('is active by default when CF_ACCOUNT_ID is set', () => {
    expect(isGatewayActive(makeEnv({ AI_GATEWAY_ENABLED: undefined }))).toBe(true);
  });

  it('is active when AI_GATEWAY_ENABLED is "true"', () => {
    expect(isGatewayActive(makeEnv({ AI_GATEWAY_ENABLED: 'true' }))).toBe(true);
  });

  it('is INACTIVE only when AI_GATEWAY_ENABLED is exactly "false"', () => {
    expect(isGatewayActive(makeEnv({ AI_GATEWAY_ENABLED: 'false' }))).toBe(false);
  });

  it('is inactive when CF_ACCOUNT_ID is absent', () => {
    expect(isGatewayActive(makeEnv({ CF_ACCOUNT_ID: undefined }))).toBe(false);
  });
});

// ─── gatewayName ──────────────────────────────────────────────

describe('gatewayName', () => {
  it('defaults to "projectsites"', () => {
    expect(gatewayName(makeEnv())).toBe(DEFAULT_GATEWAY_NAME);
    expect(gatewayName(makeEnv())).toBe('projectsites');
  });

  it('uses AI_GATEWAY_NAME when set', () => {
    expect(gatewayName(makeEnv({ AI_GATEWAY_NAME: 'custom-gw' }))).toBe('custom-gw');
  });

  it('falls back to default for blank AI_GATEWAY_NAME', () => {
    expect(gatewayName(makeEnv({ AI_GATEWAY_NAME: '   ' }))).toBe('projectsites');
  });
});

// ─── URL construction ─────────────────────────────────────────

describe('gatewayBaseUrl / gatewayUrl', () => {
  it('builds the gateway URL for openai when active', () => {
    expect(gatewayBaseUrl(makeEnv(), 'openai')).toBe(
      `https://gateway.ai.cloudflare.com/v1/${ACCT}/projectsites/openai`,
    );
  });

  it('builds the gateway URL for anthropic when active', () => {
    expect(gatewayBaseUrl(makeEnv(), 'anthropic')).toBe(
      `https://gateway.ai.cloudflare.com/v1/${ACCT}/projectsites/anthropic`,
    );
  });

  it('honors a custom gateway name in the URL', () => {
    expect(gatewayBaseUrl(makeEnv({ AI_GATEWAY_NAME: 'gw2' }), 'openai')).toBe(
      `https://gateway.ai.cloudflare.com/v1/${ACCT}/gw2/openai`,
    );
  });

  it('returns the direct vendor base when inactive', () => {
    const env = makeEnv({ AI_GATEWAY_ENABLED: 'false' });
    expect(gatewayBaseUrl(env, 'openai')).toBe('https://api.openai.com');
    expect(gatewayBaseUrl(env, 'anthropic')).toBe('https://api.anthropic.com');
  });

  it('appends the path suffix in gatewayUrl', () => {
    expect(gatewayUrl(makeEnv(), 'openai', '/v1/chat/completions')).toBe(
      `https://gateway.ai.cloudflare.com/v1/${ACCT}/projectsites/openai/v1/chat/completions`,
    );
  });
});

// ─── GatewayCallOptionsSchema ─────────────────────────────────

describe('GatewayCallOptionsSchema', () => {
  it('accepts a valid cacheTtl', () => {
    expect(GatewayCallOptionsSchema.parse({ cacheTtl: 3600 }).cacheTtl).toBe(3600);
  });

  it('rejects a negative cacheTtl', () => {
    expect(() => GatewayCallOptionsSchema.parse({ cacheTtl: -1 })).toThrow();
  });

  it('rejects a non-integer cacheTtl', () => {
    expect(() => GatewayCallOptionsSchema.parse({ cacheTtl: 1.5 })).toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => GatewayCallOptionsSchema.parse({ bogus: true } as never)).toThrow();
  });

  it('accepts metadata with string/number/boolean values', () => {
    const parsed = GatewayCallOptionsSchema.parse({
      metadata: { orgId: 'o_1', n: 2, flag: true },
    });
    expect(parsed.metadata).toEqual({ orgId: 'o_1', n: 2, flag: true });
  });
});

// ─── buildGatewayHeaders ──────────────────────────────────────

describe('buildGatewayHeaders', () => {
  it('injects default cache-ttl header when active and no options', () => {
    const h = buildGatewayHeaders(makeEnv(), { Authorization: 'Bearer x' });
    expect(h.get('cf-aig-cache-ttl')).toBe(String(DEFAULT_CACHE_TTL_SECONDS));
    expect(h.get('Authorization')).toBe('Bearer x');
  });

  it('injects an explicit cache-ttl', () => {
    const h = buildGatewayHeaders(makeEnv(), {}, { cacheTtl: 120 });
    expect(h.get('cf-aig-cache-ttl')).toBe('120');
  });

  it('sets skip-cache and omits ttl when skipCache=true', () => {
    const h = buildGatewayHeaders(makeEnv(), {}, { skipCache: true });
    expect(h.get('cf-aig-skip-cache')).toBe('true');
    expect(h.get('cf-aig-cache-ttl')).toBeNull();
  });

  it('serializes metadata into cf-aig-metadata', () => {
    const h = buildGatewayHeaders(makeEnv(), {}, { metadata: { orgId: 'o_1' } });
    expect(JSON.parse(h.get('cf-aig-metadata')!)).toEqual({ orgId: 'o_1' });
  });

  it('adds NO cf-aig-* headers when the gateway is inactive', () => {
    const h = buildGatewayHeaders(
      makeEnv({ AI_GATEWAY_ENABLED: 'false' }),
      { Authorization: 'Bearer x' },
      { cacheTtl: 999, metadata: { a: 1 } },
    );
    expect(h.get('cf-aig-cache-ttl')).toBeNull();
    expect(h.get('cf-aig-metadata')).toBeNull();
    expect(h.get('Authorization')).toBe('Bearer x');
  });
});

// ─── gatewayFetch — happy path + headers on the wire ──────────

describe('gatewayFetch', () => {
  it('fetches the gateway URL with cache headers and returns gatewayUsed=true', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    const { response, gatewayUsed } = await gatewayFetch(
      makeEnv(),
      'openai',
      '/v1/chat/completions',
      { method: 'POST', headers: { Authorization: 'Bearer k' }, body: '{}' },
      { cacheTtl: 3600, metadata: { promptId: 'research_brand' } },
    );

    expect(response.status).toBe(200);
    expect(gatewayUsed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      `https://gateway.ai.cloudflare.com/v1/${ACCT}/projectsites/openai/v1/chat/completions`,
    );
    const headers = init.headers as Headers;
    expect(headers.get('cf-aig-cache-ttl')).toBe('3600');
    expect(JSON.parse(headers.get('cf-aig-metadata')!)).toEqual({ promptId: 'research_brand' });
    expect(headers.get('Authorization')).toBe('Bearer k');
  });

  it('calls the direct vendor URL (no cf-aig headers) when inactive', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    const { gatewayUsed } = await gatewayFetch(
      makeEnv({ AI_GATEWAY_ENABLED: 'false' }),
      'anthropic',
      '/v1/messages',
      { method: 'POST', headers: { 'x-api-key': 'k' }, body: '{}' },
    );

    expect(gatewayUsed).toBe(false);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Headers).get('cf-aig-cache-ttl')).toBeNull();
  });

  it('rejects invalid options before any fetch', async () => {
    await expect(
      gatewayFetch(makeEnv(), 'openai', '/v1/chat/completions', { method: 'POST' }, {
        cacheTtl: -5,
      }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── gatewayFetch — fallback on gateway 5xx ───────────────────

describe('gatewayFetch fallback', () => {
  it('falls back to direct vendor URL once on gateway 5xx', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('gateway down', { status: 502 }))
      .mockResolvedValueOnce(okResponse());

    const { response, gatewayUsed } = await gatewayFetch(
      makeEnv(),
      'openai',
      '/v1/chat/completions',
      { method: 'POST', headers: { Authorization: 'Bearer k' }, body: '{}' },
    );

    expect(response.status).toBe(200);
    expect(gatewayUsed).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call → gateway; second call → direct vendor with fallback marker.
    expect(mockFetch.mock.calls[0][0]).toContain('gateway.ai.cloudflare.com');
    const [directUrl, directInit] = mockFetch.mock.calls[1];
    expect(directUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect((directInit.headers as Headers).get('X-PS-Gateway-Fallback')).toBe('true');
    // Fallback strips cf-aig-* headers.
    expect((directInit.headers as Headers).get('cf-aig-cache-ttl')).toBeNull();
  });

  it('does NOT fall back on a 4xx (real vendor error passes through)', async () => {
    mockFetch.mockResolvedValueOnce(new Response('bad key', { status: 401 }));

    const { response, gatewayUsed } = await gatewayFetch(
      makeEnv(),
      'anthropic',
      '/v1/messages',
      { method: 'POST', headers: { 'x-api-key': 'bad' }, body: '{}' },
    );

    expect(response.status).toBe(401);
    expect(gatewayUsed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall back when gateway is inactive (no double-call)', async () => {
    mockFetch.mockResolvedValueOnce(new Response('down', { status: 503 }));

    const { gatewayUsed } = await gatewayFetch(
      makeEnv({ AI_GATEWAY_ENABLED: 'false' }),
      'openai',
      '/v1/chat/completions',
      { method: 'POST', headers: {}, body: '{}' },
    );

    expect(gatewayUsed).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ─── gatewayMetadata ──────────────────────────────────────────

describe('gatewayMetadata', () => {
  it('returns an empty object for no context', () => {
    expect(gatewayMetadata()).toEqual({});
  });

  it('drops undefined fields', () => {
    expect(gatewayMetadata({ orgId: 'o_1', promptId: undefined })).toEqual({ orgId: 'o_1' });
  });

  it('maps all known trace fields', () => {
    expect(
      gatewayMetadata({ orgId: 'o', userId: 'u', traceId: 't', promptId: 'p' }),
    ).toEqual({ orgId: 'o', userId: 'u', traceId: 't', promptId: 'p' });
  });
});
