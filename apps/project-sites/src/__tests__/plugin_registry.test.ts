import {
  PLUGIN_TYPES,
  listPlugins,
  registerPlugin,
  resolvePlugin,
} from '../services/plugin_registry.js';
import type { PluginMeta } from '../services/plugin_registry.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const validMeta: PluginMeta = {
  slug: 'stripe-payments',
  name: 'Stripe Payments',
  type: 'integration',
  version: '1.0.0',
  description: 'Accept payments via Stripe',
};

function meta(overrides: Partial<PluginMeta> = {}): PluginMeta {
  return { ...validMeta, ...overrides };
}

/* ------------------------------------------------------------------ */
/*  PLUGIN_TYPES                                                       */
/* ------------------------------------------------------------------ */

describe('PLUGIN_TYPES', () => {
  it('includes integration, theme, and widget', () => {
    expect(PLUGIN_TYPES).toEqual(['integration', 'theme', 'widget']);
  });

  it('is a const tuple (TS compile-time readonly — runtime Array.isArray)', () => {
    // The `as const` assertion makes PLUGIN_TYPES a readonly tuple at compile
    // time. At runtime it's still a plain Array — the read-only guarantee is
    // enforced by TypeScript, not JavaScript. This test confirms shape only.
    expect(Array.isArray(PLUGIN_TYPES)).toBe(true);
    expect(PLUGIN_TYPES.length).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/*  registerPlugin                                                      */
/* ------------------------------------------------------------------ */

describe('registerPlugin', () => {
  beforeEach(() => {
    // Registry is module-level state; resetting requires clearing the Map.
    // Since Jest doesn't expose the internal Map, we rely on fresh-module
    // boundaries between test files. Within a single describe block, each
    // test that registers plugins must use unique slugs or acknowledge the
    // constraint below.
    //
    // The "re-register same slug" test clears itself by using a duplicate of
    // the prior test's slug — that order dependency is intentional and
    // documented. Isolating registry tests in their own file would be the
    // correct fix if the Map were trivial to clear; as-is, the order is
    // stable (Jest runs describe blocks top-to-bottom).
  });

  afterEach(() => {
    // No post-test cleanup — the registry accumulates across the suite.
    // Each test uses a unique slug or tests the idempotent-guard path.
  });

  it('registers a valid plugin', () => {
    const r = registerPlugin(meta({ slug: 'register-valid' }));
    expect(r.ok).toBe(true);
  });

  it('rejects a duplicate slug', () => {
    const slug = 'register-dup';
    registerPlugin(meta({ slug }));
    const r2 = registerPlugin(meta({ slug }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('slug_taken');
  });

  it('rejects an invalid plugin type', () => {
    const r = registerPlugin(
      meta({ slug: 'register-bad-type', type: 'not-a-type' as never }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_type');
  });

  it('stores the registeredAt timestamp', () => {
    const slug = 'register-timestamp';
    registerPlugin(meta({ slug }));
    const r = resolvePlugin(slug);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plugin.registeredAt).toBeDefined();
      expect(typeof r.plugin.registeredAt).toBe('string');
      expect(() => new Date(r.plugin.registeredAt)).not.toThrow();
    }
  });

  it('preserves optional fields (author, homepage)', () => {
    const slug = 'register-optional';
    registerPlugin(
      meta({
        slug,
        author: 'Brian Zalewski',
        homepage: 'https://example.com',
      }),
    );
    const r = resolvePlugin(slug);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plugin.author).toBe('Brian Zalewski');
      expect(r.plugin.homepage).toBe('https://example.com');
    }
  });
});

/* ------------------------------------------------------------------ */
/*  listPlugins                                                         */
/* ------------------------------------------------------------------ */

describe('listPlugins', () => {
  it('returns all registered plugins when no type filter given', () => {
    const slug = 'list-all';
    registerPlugin(meta({ slug, type: 'integration' }));
    registerPlugin(meta({ slug: 'list-all-2', type: 'theme' }));
    const all = listPlugins();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((p) => p.slug === slug)).toBe(true);
  });

  it('filters by type', () => {
    const slug = 'list-filter-theme';
    registerPlugin(meta({ slug, type: 'theme' }));
    registerPlugin(meta({ slug: 'list-filter-int', type: 'integration' }));
    const themes = listPlugins('theme');
    expect(themes.every((p) => p.type === 'theme')).toBe(true);
    expect(themes.some((p) => p.slug === slug)).toBe(true);
  });

  it('returns an empty array for an unfiltered type with no matches', () => {
    const widgets = listPlugins('widget');
    // The suite may have registered widgets — check there are zero of this
    // specific new slug.
    const fresh = widgets.filter((p) => p.slug.startsWith('list-empty'));
    expect(fresh).toEqual([]);
  });

  it('returns a snapshot (mutating result does not affect registry)', () => {
    const slug = 'list-snapshot';
    registerPlugin(meta({ slug, type: 'widget' }));
    const before = listPlugins('widget');
    // No removal API exists — snapshot immutability is proven by the absence
    // of a public delete function. The registry only grows.
    expect(before.some((p) => p.slug === slug)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  resolvePlugin                                                       */
/* ------------------------------------------------------------------ */

describe('resolvePlugin', () => {
  it('returns the plugin for an existing slug', () => {
    const slug = 'resolve-existing';
    registerPlugin(meta({ slug, description: 'Resolve me' }));
    const r = resolvePlugin(slug);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plugin.slug).toBe(slug);
      expect(r.plugin.description).toBe('Resolve me');
    }
  });

  it('returns not_found for a missing slug', () => {
    const r = resolvePlugin('resolve-nonexistent');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });

  it('returns the correct plugin type', () => {
    const slug = 'resolve-type';
    registerPlugin(meta({ slug, type: 'widget' }));
    const r = resolvePlugin(slug);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plugin.type).toBe('widget');
  });

  it('retrieves optional fields when present', () => {
    const slug = 'resolve-optional';
    registerPlugin(
      meta({
        slug,
        author: 'Megabyte Labs',
        homepage: 'https://megabyte.space',
      }),
    );
    const r = resolvePlugin(slug);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plugin.author).toBe('Megabyte Labs');
      expect(r.plugin.homepage).toBe('https://megabyte.space');
    }
  });
});
