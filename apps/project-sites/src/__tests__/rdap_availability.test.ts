/**
 * RDAP availability checker — unit coverage (convergence r25).
 *
 * @remarks
 * The service has two boundaries: the `https://rdap.org/domain/{name}` HTTP
 * probe (mocked via `global.fetch`) and the `CACHE_KV` 1h cache (mocked with
 * an in-memory stub). Every status branch (404→available, 200→taken,
 * 429/503→unknown, other-status→unknown, network-throw→unknown) plus cache
 * hit/miss, KV-read/write resilience, normalization, batch order, dedup-free
 * fan-out, concurrency clamp, and edge inputs are exercised.
 *
 * ts-jest: GLOBAL `jest` (NOT `@jest/globals`); HTTP via `global.fetch`.
 */

import {
  checkAvailability,
  checkBatch,
  type RdapResult,
} from '../services/rdap_availability.js';
import type { Env } from '../types/env.js';

const realFetch = global.fetch;

/** In-memory KV stub honouring `get(key,'json')` + `put(key, json, opts)`. */
function makeKv(): {
  kv: KVNamespace;
  store: Map<string, string>;
  getSpy: jest.Mock;
  putSpy: jest.Mock;
} {
  const store = new Map<string, string>();
  const getSpy = jest.fn(async (key: string, _type?: string) => {
    const raw = store.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  });
  const putSpy = jest.fn(async (key: string, value: string) => {
    store.set(key, value);
  });
  const kv = { get: getSpy, put: putSpy } as unknown as KVNamespace;
  return { kv, store, getSpy, putSpy };
}

function makeEnv(kv: KVNamespace): Env {
  return { CACHE_KV: kv } as unknown as Env;
}

/** Build a minimal Response-like object for the mocked fetch. */
function resp(status: number): Response {
  return { status } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

const fetchMock = (): jest.Mock => global.fetch as unknown as jest.Mock;

// ────────────────────────────────────────────────────────────
// Single-domain status mapping
// ────────────────────────────────────────────────────────────
describe('checkAvailability — RDAP status mapping', () => {
  it('404 → available (status="available", source="rdap")', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    const r = await checkAvailability(makeEnv(kv), 'vito.com');

    expect(r).toEqual<RdapResult>({
      domain: 'vito.com',
      available: true,
      status: 'available',
      source: 'rdap',
    });
  });

  it('200 → taken (available=false, status="taken")', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(200));

    const r = await checkAvailability(makeEnv(kv), 'google.com');

    expect(r).toMatchObject({
      domain: 'google.com',
      available: false,
      status: 'taken',
      source: 'rdap',
    });
  });

  it('429 (rate-limit) → unknown + source="rdap-error"', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(429));

    const r = await checkAvailability(makeEnv(kv), 'busy.io');

    expect(r).toMatchObject({
      available: false,
      status: 'unknown',
      source: 'rdap-error',
    });
  });

  it('503 (registry maintenance) → unknown + source="rdap-error"', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(503));

    const r = await checkAvailability(makeEnv(kv), 'down.dev');

    expect(r.status).toBe('unknown');
    expect(r.source).toBe('rdap-error');
    expect(r.available).toBe(false);
  });

  it('unexpected status (e.g. 500) → unknown rather than misleading the UI', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(500));

    const r = await checkAvailability(makeEnv(kv), 'weird.xyz');

    expect(r.status).toBe('unknown');
    expect(r.source).toBe('rdap-error');
  });

  it('unsupported / unknown TLD that 404s is reported available (RDAP bootstrap returns 404)', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    const r = await checkAvailability(makeEnv(kv), 'thing.madeuptld');

    expect(r.available).toBe(true);
    expect(r.status).toBe('available');
  });

  it('network throw → unknown resilience (source="rdap-error"), never rejects', async () => {
    const { kv } = makeKv();
    fetchMock().mockRejectedValue(new Error('network down'));

    const r = await checkAvailability(makeEnv(kv), 'oops.net');

    expect(r.status).toBe('unknown');
    expect(r.source).toBe('rdap-error');
    expect(r.available).toBe(false);
  });

  it('AbortSignal.timeout DOMException → unknown (still resolves)', async () => {
    const { kv } = makeKv();
    fetchMock().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    const r = await checkAvailability(makeEnv(kv), 'slow.com');

    expect(r.status).toBe('unknown');
    expect(r.source).toBe('rdap-error');
  });
});

// ────────────────────────────────────────────────────────────
// Query build + normalization
// ────────────────────────────────────────────────────────────
describe('checkAvailability — query build & normalization', () => {
  it('queries the rdap.org bootstrap aggregator with a real-browser UA + rdap+json Accept', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    await checkAvailability(makeEnv(kv), 'vito.com');

    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe('https://rdap.org/domain/vito.com');
    expect(init.method).toBe('GET');
    expect(init.headers['User-Agent']).toContain('Mozilla/5.0');
    expect(init.headers.Accept).toContain('application/rdap+json');
    expect(init.signal).toBeDefined();
  });

  it('trims + lowercases the input before query + result.domain', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    const r = await checkAvailability(makeEnv(kv), '  VITO.COM  ');

    expect(r.domain).toBe('vito.com');
    expect(fetchMock().mock.calls[0][0]).toBe('https://rdap.org/domain/vito.com');
  });

  it('URL-encodes the normalized domain (IDN / punctuation safe)', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    await checkAvailability(makeEnv(kv), 'a b.com');

    expect(fetchMock().mock.calls[0][0]).toBe('https://rdap.org/domain/a%20b.com');
  });
});

// ────────────────────────────────────────────────────────────
// KV cache behaviour
// ────────────────────────────────────────────────────────────
describe('checkAvailability — cache', () => {
  it('cache MISS → probes, then writes result to KV keyed rdap:{domain}', async () => {
    const { kv, store, putSpy } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    await checkAvailability(makeEnv(kv), 'vito.com');

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy.mock.calls[0][0]).toBe('rdap:vito.com');
    expect(putSpy.mock.calls[0][2]).toMatchObject({ expirationTtl: 3600 });
    expect(store.get('rdap:vito.com')).toContain('"status":"available"');
  });

  it('cache HIT → returns cached verdict with source flipped to "rdap-cache", no fetch', async () => {
    const { kv, store } = makeKv();
    store.set(
      'rdap:cached.com',
      JSON.stringify({ domain: 'cached.com', available: true, status: 'available', source: 'rdap' }),
    );

    const r = await checkAvailability(makeEnv(kv), 'cached.com');

    expect(r.source).toBe('rdap-cache');
    expect(r.status).toBe('available');
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('sad-path results are cached too (so retry storms do not re-hit registries)', async () => {
    const { kv, putSpy } = makeKv();
    fetchMock().mockResolvedValue(resp(503));

    await checkAvailability(makeEnv(kv), 'down.dev');

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy.mock.calls[0][1]).toContain('"status":"unknown"');
  });

  it('KV get throwing is non-fatal → falls through to live probe', async () => {
    const { kv, getSpy } = makeKv();
    getSpy.mockRejectedValueOnce(new Error('kv read boom'));
    fetchMock().mockResolvedValue(resp(404));

    const r = await checkAvailability(makeEnv(kv), 'vito.com');

    expect(r.available).toBe(true);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('KV put throwing is non-fatal → result still returned', async () => {
    const { kv, putSpy } = makeKv();
    putSpy.mockRejectedValueOnce(new Error('kv write boom'));
    fetchMock().mockResolvedValue(resp(404));

    const r = await checkAvailability(makeEnv(kv), 'vito.com');

    expect(r.status).toBe('available');
  });

  it('ignores a malformed cached object lacking a "status" key', async () => {
    const { kv, store } = makeKv();
    store.set('rdap:weird.com', JSON.stringify({ nope: true }));
    fetchMock().mockResolvedValue(resp(200));

    const r = await checkAvailability(makeEnv(kv), 'weird.com');

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('taken');
  });

  it('ignores a null cached value (KV returns null for json miss)', async () => {
    const { kv, getSpy } = makeKv();
    getSpy.mockResolvedValueOnce(null);
    fetchMock().mockResolvedValue(resp(404));

    const r = await checkAvailability(makeEnv(kv), 'fresh.com');

    expect(r.available).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// Batch fan-out
// ────────────────────────────────────────────────────────────
describe('checkBatch — bounded-concurrency fan-out', () => {
  it('returns results in the same order as the input list', async () => {
    const { kv } = makeKv();
    fetchMock().mockImplementation(async (url: string) => {
      // .com taken, others available — deterministic per-URL.
      return url.endsWith('one.com') ? resp(200) : resp(404);
    });

    const out = await checkBatch(makeEnv(kv), ['one.com', 'two.io', 'three.dev']);

    expect(out.map((r) => r.domain)).toEqual(['one.com', 'two.io', 'three.dev']);
    expect(out[0].status).toBe('taken');
    expect(out[1].status).toBe('available');
    expect(out[2].status).toBe('available');
  });

  it('empty list → empty result, no fetch', async () => {
    const { kv } = makeKv();

    const out = await checkBatch(makeEnv(kv), []);

    expect(out).toEqual([]);
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('single domain → single result', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    const out = await checkBatch(makeEnv(kv), ['solo.app']);

    expect(out).toHaveLength(1);
    expect(out[0].domain).toBe('solo.app');
  });

  it('probes every entry exactly once (no dedup-drop) for a list of distinct domains', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    const list = Array.from({ length: 8 }, (_, i) => `d${i}.com`);
    const out = await checkBatch(makeEnv(kv), list);

    expect(out).toHaveLength(8);
    expect(fetchMock()).toHaveBeenCalledTimes(8);
  });

  it('clamps worker count to list length when list < concurrency ceiling', async () => {
    const { kv } = makeKv();
    let inFlight = 0;
    let peak = 0;
    fetchMock().mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return resp(404);
    });

    await checkBatch(makeEnv(kv), ['a.com', 'b.com', 'c.com']);

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('caps concurrency at 20 even for a large list', async () => {
    const { kv } = makeKv();
    let inFlight = 0;
    let peak = 0;
    fetchMock().mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
      return resp(404);
    });

    const list = Array.from({ length: 50 }, (_, i) => `big${i}.com`);
    const out = await checkBatch(makeEnv(kv), list);

    expect(out).toHaveLength(50);
    expect(peak).toBeLessThanOrEqual(20);
  });

  it('a single failing probe does not break the whole batch (resilient)', async () => {
    const { kv } = makeKv();
    fetchMock().mockImplementation(async (url: string) => {
      if (url.endsWith('bad.com')) throw new Error('boom');
      return resp(404);
    });

    const out = await checkBatch(makeEnv(kv), ['good.io', 'bad.com', 'fine.dev']);

    expect(out).toHaveLength(3);
    expect(out.find((r) => r.domain === 'bad.com')?.status).toBe('unknown');
    expect(out.find((r) => r.domain === 'good.io')?.status).toBe('available');
  });
});
