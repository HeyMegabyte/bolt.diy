/**
 * Cache-invalidator pure functions (§9). Locks tag generation, purge-plan
 * derivation, and multi-plan merging so the cache-invalidation surface never
 * drifts from what the CDN purging callers expect.
 */
import {
  MAX_TAGS_PER_PURGE,
  buildTags,
  mergePurgePlans,
  purgePlan,
} from '../services/cache_invalidator.js';

describe('buildTags', () => {
  it('returns only the base tag when no resources given', () => {
    expect(buildTags('site', 'vitos')).toEqual(['site:vitos']);
  });

  it('builds tags for site scope with resources', () => {
    expect(buildTags('site', 'vitos', ['home', 'about'])).toEqual([
      'site:vitos',
      'site:vitos:about',
      'site:vitos:home',
    ]);
  });

  it('builds tags for org scope with resources', () => {
    expect(buildTags('org', 'abc-123', ['settings', 'billing'])).toEqual([
      'org:abc-123',
      'org:abc-123:billing',
      'org:abc-123:settings',
    ]);
  });

  it('builds tags for global scope', () => {
    expect(buildTags('global', 'app', ['config', 'templates'])).toEqual([
      'global:app',
      'global:app:config',
      'global:app:templates',
    ]);
  });

  it('deduplicates repeated resources', () => {
    expect(buildTags('site', 'demo', ['home', 'home', 'about'])).toEqual([
      'site:demo',
      'site:demo:about',
      'site:demo:home',
    ]);
  });

  it('returns tags in sorted order', () => {
    const tags = buildTags('org', 'x', ['z', 'a', 'm']);
    expect(tags).toEqual(['org:x', 'org:x:a', 'org:x:m', 'org:x:z']);
  });

  it('handles empty resources array', () => {
    expect(buildTags('site', 'test', [])).toEqual(['site:test']);
  });

  it('handles id strings with special characters', () => {
    expect(buildTags('site', 'my-cool-site-42')).toEqual(['site:my-cool-site-42']);
  });
});

describe('purgePlan', () => {
  it('returns empty plan for empty tags', () => {
    expect(purgePlan([])).toEqual({
      all: false,
      prefixes: [],
      tags: [],
    });
  });

  it('returns all: true for wildcard tag', () => {
    expect(purgePlan(['*'])).toEqual({
      all: true,
      prefixes: [],
      tags: [],
    });
  });

  it('returns all: true for global:* wildcard', () => {
    expect(purgePlan(['global:*'])).toEqual({
      all: true,
      prefixes: [],
      tags: [],
    });
  });

  it('derives exact tags and prefixes from resource-level tags', () => {
    expect(purgePlan(['site:vitos', 'site:vitos:home', 'org:abc', 'org:abc:settings'])).toEqual({
      all: false,
      prefixes: ['org:abc', 'site:vitos'],
      tags: ['org:abc', 'org:abc:settings', 'site:vitos', 'site:vitos:home'],
    });
  });

  it('returns no prefixes for base-only tags', () => {
    expect(purgePlan(['site:vitos', 'org:abc'])).toEqual({
      all: false,
      prefixes: [],
      tags: ['org:abc', 'site:vitos'],
    });
  });

  it('deduplicates prefixes derived from multiple resource tags under same scope:id', () => {
    const plan = purgePlan(['site:demo:home', 'site:demo:about', 'site:demo:contact']);
    expect(plan.prefixes).toEqual(['site:demo']);
  });

  it('caps exact tags at MAX_TAGS_PER_PURGE', () => {
    const manyTags = Array.from({ length: 40 }, (_, i) => `site:x:res${i}`);
    const plan = purgePlan(manyTags);
    expect(plan.tags.length).toBe(MAX_TAGS_PER_PURGE);
    expect(plan.tags[0]).toBe('site:x:res0');
    // After lexicographic sort, res0–res9 fill the first 10 slots (single-digit
    // prefixes sort before double-digit). res29 is not the last item.
    expect(plan.tags[plan.tags.length - 1]).toBe('site:x:res9');
  });

  it('prefixes are sorted', () => {
    const plan = purgePlan(['org:ccc:users', 'org:aaa:pages', 'org:bbb:jobs']);
    expect(plan.prefixes).toEqual(['org:aaa', 'org:bbb', 'org:ccc']);
  });
});

describe('mergePurgePlans', () => {
  it('returns empty plan for empty input', () => {
    expect(mergePurgePlans([])).toEqual({
      all: false,
      prefixes: [],
      tags: [],
    });
  });

  it('passes through a single plan unchanged', () => {
    const plan = { all: false as const, prefixes: [], tags: ['site:vitos'] };
    expect(mergePurgePlans([plan])).toEqual(plan);
  });

  it('merges tags and prefixes from multiple plans', () => {
    expect(
      mergePurgePlans([
        { all: false, prefixes: [], tags: ['site:vitos'] },
        { all: false, prefixes: ['org:abc'], tags: ['org:abc'] },
        { all: false, prefixes: ['site:vitos'], tags: ['site:vitos:home'] },
      ]),
    ).toEqual({
      all: false,
      prefixes: ['org:abc', 'site:vitos'],
      tags: ['org:abc', 'site:vitos', 'site:vitos:home'],
    });
  });

  it('deduplicates tags across plans', () => {
    expect(
      mergePurgePlans([
        { all: false, prefixes: [], tags: ['site:demo'] },
        { all: false, prefixes: [], tags: ['site:demo'] },
      ]),
    ).toEqual({
      all: false,
      prefixes: [],
      tags: ['site:demo'],
    });
  });

  it('deduplicates prefixes across plans', () => {
    expect(
      mergePurgePlans([
        { all: false, prefixes: ['site:demo'], tags: [] },
        { all: false, prefixes: ['site:demo'], tags: [] },
      ]),
    ).toEqual({
      all: false,
      prefixes: ['site:demo'],
      tags: [],
    });
  });

  it('any all:true subsumes all other tags and prefixes', () => {
    expect(
      mergePurgePlans([
        { all: false, prefixes: ['site:vitos'], tags: ['site:vitos'] },
        { all: true, prefixes: [], tags: [] },
        { all: false, prefixes: ['org:abc'], tags: ['org:abc'] },
      ]),
    ).toEqual({
      all: true,
      prefixes: [],
      tags: [],
    });
  });

  it('prunes prefixes subsumed by a broader prefix', () => {
    expect(
      mergePurgePlans([
        { all: false, prefixes: ['site:demo:home:header'], tags: [] },
        { all: false, prefixes: ['site:demo'], tags: [] },
        { all: false, tags: [], prefixes: ['site:demo:home'] },
      ]),
    ).toEqual({
      all: false,
      // 'site:demo' subsumes both 'site:demo:home' and 'site:demo:home:header'
      prefixes: ['site:demo'],
      tags: [],
    });
  });

  it('sorts merged tags and prefixes', () => {
    expect(
      mergePurgePlans([
        { all: false, prefixes: ['z:prefix'], tags: ['z:tag'] },
        { all: false, prefixes: ['a:prefix'], tags: ['a:tag'] },
      ]),
    ).toEqual({
      all: false,
      prefixes: ['a:prefix', 'z:prefix'],
      tags: ['a:tag', 'z:tag'],
    });
  });
});
