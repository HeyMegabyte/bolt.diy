import {
  createRegistry,
  DEFAULT_SERVICES,
  DEFAULT_REGISTRY,
} from '../services/service_registry.js';
import type { ServiceEntry, ServiceRegistry } from '../services/service_registry.js';

const makeEntry = (overrides: Partial<ServiceEntry> & { slug: string }): ServiceEntry => ({
  name: overrides.slug,
  description: 'test service',
  url: 'https://example.com',
  healthPath: '/health',
  category: 'infra',
  secrets: [],
  container: false,
  ...overrides,
});

describe('createRegistry', () => {
  describe('get()', () => {
    it('returns the entry for a known slug', () => {
      const reg = createRegistry([makeEntry({ slug: 'alpha' }), makeEntry({ slug: 'beta' })]);
      expect(reg.get('alpha')).toMatchObject({ slug: 'alpha' });
      expect(reg.get('beta')).toMatchObject({ slug: 'beta' });
    });

    it('returns null for an unknown slug', () => {
      const reg = createRegistry([makeEntry({ slug: 'known' })]);
      expect(reg.get('missing')).toBeNull();
    });
  });

  describe('byCategory()', () => {
    it('filters entries to the given category', () => {
      const reg = createRegistry([
        makeEntry({ slug: 'a', category: 'email' }),
        makeEntry({ slug: 'b', category: 'infra' }),
        makeEntry({ slug: 'c', category: 'email' }),
      ]);
      expect(reg.byCategory('email').map((e) => e.slug)).toEqual(['a', 'c']);
      expect(reg.byCategory('infra').map((e) => e.slug)).toEqual(['b']);
    });

    it('returns an empty array for a category with no entries', () => {
      const reg = createRegistry([makeEntry({ slug: 'x', category: 'infra' })]);
      expect(reg.byCategory('ai')).toEqual([]);
    });
  });

  describe('allSecrets()', () => {
    it('collects all secrets across entries, deduped and sorted', () => {
      const reg = createRegistry([
        makeEntry({ slug: 'a', secrets: ['SECRET_Z', 'SECRET_A'] }),
        makeEntry({ slug: 'b', secrets: ['SECRET_B', 'SECRET_A'] }),
      ]);
      expect(reg.allSecrets()).toEqual(['SECRET_A', 'SECRET_B', 'SECRET_Z']);
    });

    it('returns an empty array when no entries have secrets', () => {
      const reg = createRegistry([makeEntry({ slug: 'x' })]);
      expect(reg.allSecrets()).toEqual([]);
    });
  });

  describe('containers()', () => {
    it('filters to container-hosted services only', () => {
      const reg = createRegistry([
        makeEntry({ slug: 'container-app', container: true }),
        makeEntry({ slug: 'external-app', container: false }),
        makeEntry({ slug: 'another-container', container: true }),
      ]);
      expect(reg.containers().map((e) => e.slug)).toEqual(['container-app', 'another-container']);
    });

    it('returns an empty array when no services are containers', () => {
      const reg = createRegistry([makeEntry({ slug: 'x', container: false })]);
      expect(reg.containers()).toEqual([]);
    });
  });

  describe('duplicate slug handling', () => {
    it('skips duplicate slugs — first entry wins', () => {
      const reg = createRegistry([
        makeEntry({ slug: 'dupe', name: 'first' }),
        makeEntry({ slug: 'dupe', name: 'second' }),
      ]);
      expect(reg.get('dupe')).toMatchObject({ name: 'first' });
      expect(reg.services).toHaveLength(1);
    });
  });

  describe('entry validation', () => {
    it('skips entries with an empty slug', () => {
      const reg = createRegistry([makeEntry({ slug: '' }), makeEntry({ slug: 'valid' })]);
      expect(reg.services).toHaveLength(1);
      expect(reg.get('valid')).not.toBeNull();
    });

    it('skips entries with an empty name', () => {
      const reg = createRegistry([
        makeEntry({ slug: 'noname', name: '' }),
        makeEntry({ slug: 'good' }),
      ]);
      expect(reg.services).toHaveLength(1);
    });

    it('skips entries with an empty url', () => {
      const reg = createRegistry([
        makeEntry({ slug: 'nourl', url: '' }),
        makeEntry({ slug: 'good' }),
      ]);
      expect(reg.services).toHaveLength(1);
    });

    it('skips entries with an empty healthPath', () => {
      const reg = createRegistry([
        makeEntry({ slug: 'nopath', healthPath: '' }),
        makeEntry({ slug: 'good' }),
      ]);
      expect(reg.services).toHaveLength(1);
    });
  });

  describe('category normalization', () => {
    it('passes through known categories as-is', () => {
      const reg = createRegistry([
        makeEntry({ slug: 'a', category: 'email' }),
        makeEntry({ slug: 'b', category: 'crm' }),
        makeEntry({ slug: 'c', category: 'pm' }),
        makeEntry({ slug: 'd', category: 'auth' }),
        makeEntry({ slug: 'e', category: 'social' }),
        makeEntry({ slug: 'f', category: 'media' }),
        makeEntry({ slug: 'g', category: 'ai' }),
        makeEntry({ slug: 'h', category: 'infra' }),
      ]);
      // Each known category passes through unchanged (including 'infra').
      expect(reg.get('a')!.category).toBe('email');
      expect(reg.get('b')!.category).toBe('crm');
      expect(reg.get('c')!.category).toBe('pm');
      expect(reg.get('d')!.category).toBe('auth');
      expect(reg.get('e')!.category).toBe('social');
      expect(reg.get('f')!.category).toBe('media');
      expect(reg.get('g')!.category).toBe('ai');
      expect(reg.get('h')!.category).toBe('infra');
    });

    it('falls back to infra for an unknown category', () => {
      const reg = createRegistry([
        makeEntry({ slug: 'weird', category: 'unknown' as ServiceEntry['category'] }),
      ]);
      expect(reg.get('weird')!.category).toBe('infra');
    });
  });

  describe('empty registry', () => {
    it('never throws for an empty input', () => {
      const reg = createRegistry([]);
      expect(reg.services).toEqual([]);
      expect(reg.get('anything')).toBeNull();
      expect(reg.byCategory('infra')).toEqual([]);
      expect(reg.allSecrets()).toEqual([]);
      expect(reg.containers()).toEqual([]);
    });
  });
});

describe('DEFAULT_SERVICES', () => {
  it('has at least 6 entries', () => {
    expect(DEFAULT_SERVICES.length).toBeGreaterThanOrEqual(6);
  });

  it('every entry has non-empty required fields', () => {
    for (const s of DEFAULT_SERVICES) {
      expect(s.slug).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.healthPath.startsWith('/')).toBe(true);
      expect(['pm', 'crm', 'email', 'auth', 'ai', 'social', 'media', 'infra']).toContain(
        s.category,
      );
      expect(Array.isArray(s.secrets)).toBe(true);
      expect(typeof s.container).toBe('boolean');
    }
  });

  it('all secrets are uppercase with underscores', () => {
    for (const s of DEFAULT_SERVICES) {
      for (const secret of s.secrets) {
        expect(secret).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
    }
  });

  it('no duplicate slugs across default services', () => {
    const slugs = DEFAULT_SERVICES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('DEFAULT_REGISTRY matches DEFAULT_SERVICES', () => {
    expect(DEFAULT_REGISTRY.services).toHaveLength(DEFAULT_SERVICES.length);
    for (const s of DEFAULT_SERVICES) {
      expect(DEFAULT_REGISTRY.get(s.slug)).toMatchObject({ slug: s.slug });
    }
  });

  it('DEFAULT_REGISTRY.allSecrets() covers every secrets array', () => {
    const all = new Set(DEFAULT_REGISTRY.allSecrets());
    for (const s of DEFAULT_SERVICES) {
      for (const secret of s.secrets) {
        expect(all.has(secret)).toBe(true);
      }
    }
  });
});
