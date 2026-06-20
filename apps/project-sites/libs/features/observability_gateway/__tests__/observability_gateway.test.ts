/**
 * Unit tests for libs/features/observability_gateway/service.ts + handlers.ts
 *
 * Service helpers (redactPii, shouldKeep, quotaKey, checkAndIncrementQuota,
 * vendorIngestUrl, writeRollup) are tested with inline stubs — no jest.mock()
 * needed because the service is pure-functional with injectable deps.
 *
 * Handler tests use a lightweight Hono test helper that constructs a fake Env
 * stub; isFlagOn and resolveSite are mocked at the module boundary.
 */

// ---------------------------------------------------------------------------
// Module-level mocks (before any import)
// ---------------------------------------------------------------------------

const mockIsFlagOn = jest.fn<Promise<boolean>, []>();
const mockResolveSite = jest.fn();
const mockFetch = jest.fn<Promise<Response>, [string | Request, RequestInit?]>();

jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...args: unknown[]) => mockIsFlagOn(...(args as [])),
}));

jest.mock('../../../../src/services/site_serving.js', () => ({
  resolveSite: (...args: unknown[]) => mockResolveSite(...args),
}));

// Intercept global fetch
globalThis.fetch = mockFetch as typeof fetch;

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  redactPii,
  djb2Hash,
  shouldKeep,
  quotaKey,
  checkAndIncrementQuota,
  vendorIngestUrl,
  writeRollup,
  FLAG_KEY,
  DEFAULT_SAMPLE_RATE,
  HOURLY_QUOTA,
} from '../service.js';
import { observabilityGateway } from '../handlers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SITE_ID = 'site-00000000-0000-0000-0000-000000000001';
const ORG_ID  = 'org-00000000-0000-0000-0000-000000000001';
const SITE_HOST = 'mybiz.projectsites.dev';

/** Build a minimal fake Env for handler tests. */
function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const kvStore = new Map<string, string>();

  const fakeKv: KVNamespace = {
    get: jest.fn(async (key: string, type?: string) => {
      const raw = kvStore.get(key) ?? null;
      if (!raw) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    }) as KVNamespace['get'],
    put: jest.fn(async (key: string, value: string) => {
      kvStore.set(key, value);
    }) as KVNamespace['put'],
    delete: jest.fn() as KVNamespace['delete'],
    list: jest.fn() as KVNamespace['list'],
    getWithMetadata: jest.fn() as KVNamespace['getWithMetadata'],
  };

  const fakeDb = {
    prepare: jest.fn(() => ({
      bind: jest.fn(() => ({
        first: jest.fn().mockResolvedValue({
          id: SITE_ID,
          org_id: ORG_ID,
        }),
      })),
    })),
  };

  return {
    CACHE_KV: fakeKv,
    DB: fakeDb,
    SENTRY_INGEST_KEY: 'test-sentry-key',
    POSTHOG_INGEST_KEY: 'phc_test',
    SENTRY_PROJECT_ID: '12345',
    ANALYTICS: undefined, // intentionally absent in most tests
    ...overrides,
  };
}

/** Fire a request against the Hono router under test. */
async function request(
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  envOverrides: Partial<Record<string, unknown>> = {},
): Promise<Response> {
  const env = makeEnv(envOverrides);
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return observabilityGateway.fetch(req, env as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockIsFlagOn.mockResolvedValue(true);
  mockResolveSite.mockResolvedValue({ site_id: SITE_ID, org_id: ORG_ID });
  mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
});

// ===========================================================================
// 1. FLAG_KEY constant
// ===========================================================================

describe('FLAG_KEY', () => {
  test('equals module slug', () => {
    expect(FLAG_KEY).toBe('observability_gateway');
  });
});

// ===========================================================================
// 2. redactPii — PII stripping
// ===========================================================================

describe('redactPii', () => {
  test('redacts email field by name', () => {
    const out = redactPii({ email: 'alice@example.com', name: 'Alice' }) as Record<string, unknown>;
    expect(out['email']).toBe('[REDACTED]');
    expect(out['name']).toBe('Alice');
  });

  test('redacts email_address field', () => {
    const out = redactPii({ email_address: 'bob@example.com' }) as Record<string, unknown>;
    expect(out['email_address']).toBe('[REDACTED]');
  });

  test('redacts phone field by name', () => {
    const out = redactPii({ phone: '555-867-5309', data: 'ok' }) as Record<string, unknown>;
    expect(out['phone']).toBe('[REDACTED]');
    expect(out['data']).toBe('ok');
  });

  test('redacts ip_address field by name', () => {
    const out = redactPii({ ip_address: '1.2.3.4' }) as Record<string, unknown>;
    expect(out['ip_address']).toBe('[REDACTED]');
  });

  test('redacts string value that looks like an email', () => {
    const out = redactPii({ message: 'contact user@example.com' }) as Record<string, unknown>;
    // Value contains an email — entire value redacted
    expect(out['message']).toBe('[REDACTED]');
  });

  test('redacts string value that looks like an IPv4', () => {
    const out = redactPii({ remote: '192.168.1.1' }) as Record<string, unknown>;
    expect(out['remote']).toBe('[REDACTED]');
  });

  test('does NOT redact benign fields', () => {
    const out = redactPii({ event_id: 'abc123', level: 'error' }) as Record<string, unknown>;
    expect(out['event_id']).toBe('abc123');
    expect(out['level']).toBe('error');
  });

  test('recursively redacts nested objects', () => {
    const out = redactPii({
      user: { email: 'x@y.com', id: 'u-1' },
    }) as Record<string, Record<string, unknown>>;
    expect(out['user']['email']).toBe('[REDACTED]');
    expect(out['user']['id']).toBe('u-1');
  });

  test('handles arrays', () => {
    const out = redactPii([
      { email: 'a@b.com' },
      { message: 'hello' },
    ]) as Array<Record<string, unknown>>;
    expect(out[0]['email']).toBe('[REDACTED]');
    expect(out[1]['message']).toBe('hello');
  });

  test('no email or phone in forwarded payload after redaction', () => {
    const payload = {
      email: 'user@vendor.com',
      phone: '212-555-0100',
      extra: { ip: '10.0.0.1' },
    };
    const clean = JSON.stringify(redactPii(payload));
    expect(clean).not.toMatch(/user@vendor\.com/);
    expect(clean).not.toMatch(/212-555-0100/);
    expect(clean).not.toMatch(/10\.0\.0\.1/);
  });
});

// ===========================================================================
// 3. djb2Hash + shouldKeep — deterministic sampling
// ===========================================================================

describe('djb2Hash', () => {
  test('returns same hash for same input', () => {
    expect(djb2Hash('evt-abc')).toBe(djb2Hash('evt-abc'));
  });

  test('returns different hashes for different inputs', () => {
    expect(djb2Hash('evt-abc')).not.toBe(djb2Hash('evt-xyz'));
  });

  test('returns unsigned 32-bit integer', () => {
    const h = djb2Hash('test-event-id-12345');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xFFFFFFFF);
  });
});

describe('shouldKeep — sampling', () => {
  test('100% rate always keeps', () => {
    expect(shouldKeep('any-event-id', 100)).toBe(true);
    expect(shouldKeep('other-event', 100)).toBe(true);
  });

  test('0% rate always drops', () => {
    expect(shouldKeep('any-event-id', 0)).toBe(false);
    expect(shouldKeep('other-event', 0)).toBe(false);
  });

  test('50% rate splits events deterministically', () => {
    // With enough events some should be kept and some dropped
    const kept = Array.from({ length: 200 }, (_, i) =>
      shouldKeep(`evt-${i}`, 50),
    );
    const keptCount = kept.filter(Boolean).length;
    // Should be roughly 50% — within 25% margin for 200 events
    expect(keptCount).toBeGreaterThan(50);
    expect(keptCount).toBeLessThan(150);
  });

  test('same event id always gives same decision', () => {
    const id = 'stable-event-id-99';
    const first = shouldKeep(id, 50);
    const second = shouldKeep(id, 50);
    expect(first).toBe(second);
  });

  test('DEFAULT_SAMPLE_RATE keeps all events', () => {
    expect(DEFAULT_SAMPLE_RATE).toBe(100);
    expect(shouldKeep('any', DEFAULT_SAMPLE_RATE)).toBe(true);
  });
});

// ===========================================================================
// 4. quotaKey + checkAndIncrementQuota
// ===========================================================================

describe('quotaKey', () => {
  test('formats correctly for a known UTC timestamp', () => {
    // 2026-06-19T14:30:00Z
    const ms = new Date('2026-06-19T14:30:00Z').getTime();
    expect(quotaKey('site-001', ms)).toBe('monitor:site-001:2026061914');
  });

  test('different hours produce different keys', () => {
    const ms1 = new Date('2026-06-19T13:00:00Z').getTime();
    const ms2 = new Date('2026-06-19T14:00:00Z').getTime();
    expect(quotaKey('site-001', ms1)).not.toBe(quotaKey('site-001', ms2));
  });
});

describe('checkAndIncrementQuota', () => {
  function makeKv(initial?: number): KVNamespace {
    const store = new Map<string, string>();
    if (initial !== undefined) {
      store.set('monitor:site-x:2026061914', JSON.stringify({ count: initial }));
    }
    return {
      get: jest.fn(async (key: string, type?: string) => {
        const v = store.get(key) ?? null;
        if (!v) return null;
        return type === 'json' ? JSON.parse(v) : v;
      }) as KVNamespace['get'],
      put: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }) as KVNamespace['put'],
      delete: jest.fn() as KVNamespace['delete'],
      list: jest.fn() as KVNamespace['list'],
      getWithMetadata: jest.fn() as KVNamespace['getWithMetadata'],
    };
  }

  const NOW_MS = new Date('2026-06-19T14:00:00Z').getTime();

  test('first increment returns count=1, not exceeded', async () => {
    const kv = makeKv();
    const result = await checkAndIncrementQuota(kv, 'site-x', 100, NOW_MS);
    expect(result.exceeded).toBe(false);
    expect(result.count).toBe(1);
  });

  test('increments counter across calls', async () => {
    const kv = makeKv(5);
    const result = await checkAndIncrementQuota(kv, 'site-x', 100, NOW_MS);
    expect(result.count).toBe(6);
  });

  test('returns exceeded=true when at cap', async () => {
    const kv = makeKv(100);
    const result = await checkAndIncrementQuota(kv, 'site-x', 100, NOW_MS);
    expect(result.exceeded).toBe(true);
    expect(result.count).toBe(100); // not incremented
  });

  test('HOURLY_QUOTA constant is 10000', () => {
    expect(HOURLY_QUOTA).toBe(10_000);
  });
});

// ===========================================================================
// 5. vendorIngestUrl
// ===========================================================================

describe('vendorIngestUrl', () => {
  test('sentry URL includes project id', () => {
    const url = vendorIngestUrl('sentry', { SENTRY_PROJECT_ID: '9999' });
    expect(url).toContain('9999');
    expect(url).toContain('sentry.io');
    expect(url).toContain('/store/');
  });

  test('posthog URL points to PostHog capture endpoint', () => {
    const url = vendorIngestUrl('posthog', {});
    expect(url).toContain('posthog.com');
    expect(url).toContain('/capture/');
  });
});

// ===========================================================================
// 6. writeRollup
// ===========================================================================

describe('writeRollup', () => {
  test('calls writeDataPoint with correct blobs and index', () => {
    const ae = { writeDataPoint: jest.fn() };
    writeRollup(ae, 'sentry', 'org-abc', 'site-xyz');
    expect(ae.writeDataPoint).toHaveBeenCalledWith({
      blobs: ['sentry', 'org-abc', 'site-xyz'],
      doubles: [1],
      indexes: ['org-abc:site-xyz'],
    });
  });

  test('silently no-ops when AE binding is absent', () => {
    // Must not throw
    expect(() => writeRollup(undefined, 'posthog', 'org-1', 'site-1')).not.toThrow();
  });
});

// ===========================================================================
// 7. Handler — integration-level tests
// ===========================================================================

describe('POST /monitoring/:provider — handler', () => {
  // ── 7a. Flag off → 404 ─────────────────────────────────────────────────

  test('returns 404 when flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await request(
      'POST',
      '/monitoring/sentry',
      { event_id: 'evt-001', message: 'boom' },
      { 'x-site-host': SITE_HOST },
    );
    expect(res.status).toBe(404);
  });

  // ── 7b. Invalid provider → 400 ─────────────────────────────────────────

  test('returns 400 for unknown provider', async () => {
    const res = await request(
      'POST',
      '/monitoring/datadog',
      { event_id: 'evt-001' },
      { 'x-site-host': SITE_HOST },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  // ── 7c. No site identity header → 404 ──────────────────────────────────

  test('returns 404 when no x-site-host or x-site-id provided', async () => {
    const res = await request('POST', '/monitoring/posthog', { uuid: 'u-1' });
    expect(res.status).toBe(404);
  });

  // ── 7d. Unknown site → 404 ─────────────────────────────────────────────

  test('returns 404 for unknown site (resolveSite returns null)', async () => {
    mockResolveSite.mockResolvedValue(null);
    const res = await request(
      'POST',
      '/monitoring/posthog',
      { uuid: 'u-1', event: 'pageview' },
      { 'x-site-host': 'unknown.projectsites.dev' },
    );
    expect(res.status).toBe(404);
  });

  // ── 7e. Invalid JSON body → 400 ────────────────────────────────────────

  test('returns 400 for unparseable JSON body', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/monitoring/sentry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-site-host': SITE_HOST,
      },
      body: 'not-json{{{',
    });
    const res = await observabilityGateway.fetch(req, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });

  // ── 7f. Happy path sentry → 202 + forwarded ───────────────────────────

  test('happy path sentry: forwards event and returns 202', async () => {
    const res = await request(
      'POST',
      '/monitoring/sentry',
      { event_id: 'evt-sentry-001', message: 'test error', level: 'error' },
      { 'x-site-host': SITE_HOST },
    );
    expect(res.status).toBe(202);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('accepted');
    // fetch called once to Sentry ingest URL
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('sentry.io');
    expect(init.method).toBe('POST');
  });

  // ── 7g. Happy path posthog → 202 + forwarded ──────────────────────────

  test('happy path posthog: forwards event and returns 202', async () => {
    const res = await request(
      'POST',
      '/monitoring/posthog',
      { uuid: 'ph-uuid-001', event: '$pageview', properties: { path: '/' } },
      { 'x-site-host': SITE_HOST },
    );
    expect(res.status).toBe(202);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('posthog.com');
  });

  // ── 7h. PII not in forwarded payload ──────────────────────────────────

  test('strips PII fields from the forwarded payload', async () => {
    await request(
      'POST',
      '/monitoring/sentry',
      {
        event_id: 'evt-pii-001',
        email: 'alice@evil.com',
        phone: '555-000-1234',
        message: 'contact alice@evil.com for info',
      },
      { 'x-site-host': SITE_HOST },
    );

    // Inspect what was forwarded
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const forwarded = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(forwarded['email']).toBe('[REDACTED]');
    expect(forwarded['phone']).toBe('[REDACTED]');
    // Message containing email value is also redacted
    expect(forwarded['message']).toBe('[REDACTED]');
    // Benign fields survive
    expect(forwarded['event_id']).toBe('evt-pii-001');
  });

  // ── 7i. Quota exceeded → 429 ──────────────────────────────────────────

  test('returns 429 when hourly quota is exceeded', async () => {
    // Pre-fill the KV to be at cap
    const kvStore = new Map<string, string>();
    const nowMs = Date.now();
    const key = `monitor:${SITE_ID}:${new Date(nowMs).toISOString().slice(0, 13).replace(/[-T:]/g, '')}`.replace(
      /monitor:site-00000000-0000-0000-0000-000000000001:(\d{10})/,
      (_, ts) => `monitor:site-00000000-0000-0000-0000-000000000001:${ts.slice(0, 10)}`,
    );
    // Simpler: set via makeEnv where KV already contains cap count at the right key
    const capKv: KVNamespace = {
      get: jest.fn().mockResolvedValue({ count: HOURLY_QUOTA }),
      put: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue({ keys: [], list_complete: true, cursor: '' }),
      getWithMetadata: jest.fn().mockResolvedValue({ value: null, metadata: null }),
    };
    void kvStore; void key; // silence unused

    const res = await request(
      'POST',
      '/monitoring/sentry',
      { event_id: 'evt-quota-001' },
      { 'x-site-id': SITE_ID },
      { CACHE_KV: capKv },
    );
    expect(res.status).toBe(429);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('QUOTA_EXCEEDED');
  });

  // ── 7j. Vendor 5xx → fail-soft 202 ────────────────────────────────────

  test('returns 202 even when vendor returns 5xx (fail-soft)', async () => {
    mockFetch.mockResolvedValue(new Response('Internal Server Error', { status: 503 }));
    const res = await request(
      'POST',
      '/monitoring/posthog',
      { uuid: 'ph-vendor-fail-001', event: 'error_event' },
      { 'x-site-host': SITE_HOST },
    );
    // Customer site must never see a 5xx from us
    expect(res.status).toBe(202);
  });

  // ── 7k. Vendor network error → fail-soft 202 ──────────────────────────

  test('returns 202 even when vendor fetch throws (fail-soft)', async () => {
    mockFetch.mockRejectedValue(new Error('network timeout'));
    const res = await request(
      'POST',
      '/monitoring/sentry',
      { event_id: 'evt-net-fail-001' },
      { 'x-site-host': SITE_HOST },
    );
    expect(res.status).toBe(202);
  });

  // ── 7l. Analytics Engine rollup called when binding present ────────────

  test('calls writeDataPoint when ANALYTICS binding is present', async () => {
    const writeDataPoint = jest.fn();
    const ae = { writeDataPoint };
    const res = await request(
      'POST',
      '/monitoring/posthog',
      { uuid: 'ph-ae-001', event: 'pageview' },
      { 'x-site-host': SITE_HOST },
      { ANALYTICS: ae },
    );
    expect(res.status).toBe(202);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    const [[arg]] = writeDataPoint.mock.calls as [[{ blobs: string[] }]];
    expect(arg.blobs).toContain('posthog');
    expect(arg.blobs).toContain(ORG_ID);
    expect(arg.blobs).toContain(SITE_ID);
  });

  // ── 7m. Analytics Engine silently skipped when absent ─────────────────

  test('does not throw when ANALYTICS binding is absent', async () => {
    const res = await request(
      'POST',
      '/monitoring/sentry',
      { event_id: 'evt-no-ae' },
      { 'x-site-host': SITE_HOST },
      { ANALYTICS: undefined },
    );
    expect(res.status).toBe(202);
  });

  // ── 7n. x-site-id header path ─────────────────────────────────────────

  test('resolves site via x-site-id header', async () => {
    const res = await request(
      'POST',
      '/monitoring/sentry',
      { event_id: 'evt-by-id-001' },
      { 'x-site-id': SITE_ID },
    );
    expect(res.status).toBe(202);
  });
});
