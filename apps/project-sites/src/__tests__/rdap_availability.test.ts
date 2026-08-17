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

import { checkAvailability, checkBatch, type RdapResult } from '../services/rdap_availability.js';
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

  it('logs the ACTUAL non-ok status (e.g. 403 rdap.org edge block) — no silent unknown', async () => {
    // Diagnosability: a persistent 403/429 from rdap.org's CF edge blocking the
    // Worker subrequest was previously an invisible `unknown`. The status must be logged.
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(403));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const r = await checkAvailability(makeEnv(kv), 'blocked.io');

    expect(r.status).toBe('unknown');
    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('rdap probe non-ok status');
    expect(logged).toContain('"status":403');
    warnSpy.mockRestore();
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
// Retry-once on a transient `unknown` (rdap.org timeouts are per-request-variable)
// ────────────────────────────────────────────────────────────
describe('checkAvailability — retry-once on transient unknown', () => {
  it('a DEFINITIVE first draw does NOT retry (exactly one fetch)', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    const r = await checkAvailability(makeEnv(kv), 'fast.com');

    expect(r.status).toBe('available');
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('a first-draw `unknown` (timeout) that RESOLVES on retry returns the retry verdict', async () => {
    // rdap.org aborted the first draw (>5s) but the second landed a real 404 —
    // the independent retry is exactly what recovers the picker resolve rate.
    const { kv } = makeKv();
    fetchMock()
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
      .mockResolvedValueOnce(resp(404));

    const r = await checkAvailability(makeEnv(kv), 'flaky.io');

    expect(r.status).toBe('available');
    expect(r.source).toBe('rdap');
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it('a STATUS-refusal (429 rate-limit) is NOT retried — an immediate re-request deepens the limit', async () => {
    // rdap.org returned a 429 to the Worker live (observed iter-91). Retrying a
    // rate-limit hammers it → the retry is gated to timeout/network only.
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(429));

    const r = await checkAvailability(makeEnv(kv), 'ratelimited.io');

    expect(r.status).toBe('unknown');
    expect(fetchMock()).toHaveBeenCalledTimes(1); // NO retry on a status refusal
  });

  it('a STATUS-refusal (503) is NOT retried either (only timeout/network is transient)', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(503));

    const r = await checkAvailability(makeEnv(kv), 'maint.dev');

    expect(r.status).toBe('unknown');
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('a TIMEOUT unknown on BOTH draws → retried exactly once (2 fetches), still unknown + 60s TTL', async () => {
    const { kv, putSpy } = makeKv();
    fetchMock().mockRejectedValue(new DOMException('timed out', 'TimeoutError')); // every draw times out

    const r = await checkAvailability(makeEnv(kv), 'down.ai');

    expect(r.status).toBe('unknown');
    expect(fetchMock()).toHaveBeenCalledTimes(2); // ONE retry (retryable), never more
    // Still cached with the short 60s TTL (iter-90 split-TTL holds through the retry).
    expect(putSpy.mock.calls[0][2]).toMatchObject({ expirationTtl: 60 });
  });
});

// ────────────────────────────────────────────────────────────
// Query build + normalization
// ────────────────────────────────────────────────────────────
describe('checkAvailability — query build & normalization', () => {
  it('queries the authoritative registry with a real-browser UA + rdap+json Accept', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    await checkAvailability(makeEnv(kv), 'vito.com');

    const [url, init] = fetchMock().mock.calls[0];
    // .com routes to Verisign directly (NOT the throttled rdap.org aggregator).
    expect(url).toBe('https://rdap.verisign.com/com/v1/domain/vito.com');
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
    expect(fetchMock().mock.calls[0][0]).toBe('https://rdap.verisign.com/com/v1/domain/vito.com');
  });

  it('URL-encodes the normalized domain (IDN / punctuation safe)', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    await checkAvailability(makeEnv(kv), 'a b.com');

    expect(fetchMock().mock.calls[0][0]).toBe(
      'https://rdap.verisign.com/com/v1/domain/a%20b.com',
    );
  });
});

// ────────────────────────────────────────────────────────────
// Authoritative-registry routing (bypasses the throttled rdap.org aggregator)
// ────────────────────────────────────────────────────────────
describe('checkAvailability — authoritative-registry routing', () => {
  // ROOT CAUSE (iter-91 + confirmed live iter-…): the shared CF Worker egress IP
  // is 429/403-throttled by rdap.org's own Cloudflare edge, so EVERY probe
  // resolved `unknown` → `available:false` → the AI domain search returned 0
  // available for every query. Durable fix: query the TLD's AUTHORITATIVE RDAP
  // registry directly (Verisign/PIR/Google/…), which is NOT the rdap.org CF-edge
  // throttle path. rdap.org stays only as the fallback for unmapped TLDs.
  it('.com → queries the authoritative Verisign registry, NOT rdap.org', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    await checkAvailability(makeEnv(kv), 'vito.com');

    expect(fetchMock().mock.calls[0][0]).toBe('https://rdap.verisign.com/com/v1/domain/vito.com');
  });

  it('.net → Verisign net registry', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(200));
    await checkAvailability(makeEnv(kv), 'acme.net');
    expect(fetchMock().mock.calls[0][0]).toBe('https://rdap.verisign.com/net/v1/domain/acme.net');
  });

  it('.org → Public Interest Registry', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));
    await checkAvailability(makeEnv(kv), 'charity.org');
    expect(fetchMock().mock.calls[0][0]).toBe(
      'https://rdap.publicinterestregistry.org/rdap/domain/charity.org',
    );
  });

  it('.dev / .app → Google Registry', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));
    await checkAvailability(makeEnv(kv), 'cool.dev');
    expect(fetchMock().mock.calls[0][0]).toBe('https://pubapi.registry.google/rdap/domain/cool.dev');
  });

  it('an UNMAPPED TLD falls back to the rdap.org aggregator (still resolvable)', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));
    await checkAvailability(makeEnv(kv), 'thing.madeuptld');
    expect(fetchMock().mock.calls[0][0]).toBe('https://rdap.org/domain/thing.madeuptld');
  });

  it('routing is case/whitespace-insensitive on the TLD (VITO.COM → Verisign)', async () => {
    const { kv } = makeKv();
    fetchMock().mockResolvedValue(resp(404));
    await checkAvailability(makeEnv(kv), '  VITO.COM  ');
    expect(fetchMock().mock.calls[0][0]).toBe('https://rdap.verisign.com/com/v1/domain/vito.com');
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
      JSON.stringify({
        domain: 'cached.com',
        available: true,
        status: 'available',
        source: 'rdap',
      }),
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

  it('a DEFINITIVE verdict (available/taken) caches with the long 1h TTL', async () => {
    const { kv, putSpy } = makeKv();
    fetchMock().mockResolvedValue(resp(404));

    await checkAvailability(makeEnv(kv), 'fresh.com');

    expect(putSpy.mock.calls[0][2]).toMatchObject({ expirationTtl: 3600 });
  });

  it('a NON-DEFINITIVE "unknown" caches with a SHORT 60s TTL — a transient failure must not poison for 1h', async () => {
    // Regression: /api/domains/search once returned all-`unknown` for a candidate
    // set that was actually resolvable — the verdicts were stale poisoned cache
    // from a momentary probe failure that had been cached at the full 1h TTL.
    const { kv, putSpy } = makeKv();
    fetchMock().mockResolvedValue(resp(429)); // rate-limited → unknown

    await checkAvailability(makeEnv(kv), 'busy.io');

    expect(putSpy.mock.calls[0][1]).toContain('"status":"unknown"');
    expect(putSpy.mock.calls[0][2]).toMatchObject({ expirationTtl: 60 });
    // Explicitly NOT the definitive 1h TTL.
    expect((putSpy.mock.calls[0][2] as { expirationTtl: number }).expirationTtl).toBeLessThan(3600);
  });

  it('a network-throw "unknown" also caches with the SHORT 60s TTL', async () => {
    const { kv, putSpy } = makeKv();
    fetchMock().mockRejectedValue(new Error('egress throttled'));

    await checkAvailability(makeEnv(kv), 'oops.xyz');

    expect(putSpy.mock.calls[0][2]).toMatchObject({ expirationTtl: 60 });
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
