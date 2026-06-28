import {
  researchCacheKey,
  extractDomain,
  getCachedResearch,
  putCachedResearch,
  RESEARCH_CACHE_TTL_SECONDS,
} from '../services/research_cache.js';

describe('extractDomain', () => {
  it('strips scheme + www, lowercases', () => {
    expect(extractDomain('https://www.Acme.com/x')).toBe('acme.com');
    expect(extractDomain('acme.com')).toBe('acme.com');
    expect(extractDomain('HTTP://Sub.Acme.CO.UK')).toBe('sub.acme.co.uk');
  });
  it('returns null for empty / unparseable input', () => {
    expect(extractDomain('')).toBeNull();
    expect(extractDomain('   ')).toBeNull();
  });
});

describe('researchCacheKey (stable per-business identity)', () => {
  it('prefers placeId over domain over name', () => {
    expect(researchCacheKey({ placeId: 'ChIJ1', website: 'a.com', name: 'A' })).toBe(
      'research:v1:place:ChIJ1',
    );
    expect(researchCacheKey({ website: 'https://a.com', name: 'A' })).toBe('research:v1:domain:a.com');
    expect(researchCacheKey({ name: 'Joe Salon', address: '1 Main St' })).toBe(
      'research:v1:name:joe%20salon%7C1%20main%20st',
    );
  });
  it('is STABLE across rebuilds of the same business (same identity → same key)', () => {
    const a = researchCacheKey({ placeId: 'ChIJ', name: 'X' });
    const b = researchCacheKey({ placeId: 'ChIJ', name: 'X (renamed)', address: 'new' });
    expect(a).toBe(b); // placeId dominates → rebuild reuses cache despite name/address drift
  });
  it('does NOT collide across different businesses', () => {
    const a = researchCacheKey({ name: 'Acme', address: '1 Main' });
    const b = researchCacheKey({ name: 'Acme', address: '2 Main' });
    expect(a).not.toBe(b);
  });
  it('normalizes whitespace + case for the name fallback', () => {
    expect(researchCacheKey({ name: '  Joe   Salon ' })).toBe(researchCacheKey({ name: 'joe salon' }));
  });
});

describe('getCachedResearch / putCachedResearch', () => {
  function kvEnv() {
    const store = new Map<string, string>();
    return {
      store,
      env: {
        CACHE_KV: {
          get: jest.fn(async (k: string, _t?: string) => {
            const v = store.get(k);
            return v === undefined ? null : JSON.parse(v);
          }),
          put: jest.fn(async (k: string, v: string) => {
            store.set(k, v);
          }),
        },
      } as any,
    };
  }

  it('round-trips a value through the cache', async () => {
    const { env } = kvEnv();
    await putCachedResearch(env, 'research:v1:place:p1', { brand: 'navy' });
    expect(await getCachedResearch(env, 'research:v1:place:p1')).toEqual({ brand: 'navy' });
  });
  it('returns null on a miss', async () => {
    const { env } = kvEnv();
    expect(await getCachedResearch(env, 'nope')).toBeNull();
  });
  it('uses the 30-day default TTL', async () => {
    const { env } = kvEnv();
    await putCachedResearch(env, 'k', { a: 1 });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith('k', JSON.stringify({ a: 1 }), {
      expirationTtl: RESEARCH_CACHE_TTL_SECONDS,
    });
    expect(RESEARCH_CACHE_TTL_SECONDS).toBe(2592000);
  });
  it('never throws on KV errors (cache must not break a build)', async () => {
    const env = {
      CACHE_KV: {
        get: jest.fn().mockRejectedValue(new Error('kv down')),
        put: jest.fn().mockRejectedValue(new Error('kv down')),
      },
    } as any;
    await expect(getCachedResearch(env, 'k')).resolves.toBeNull();
    await expect(putCachedResearch(env, 'k', { a: 1 })).resolves.toBeUndefined();
  });
});
