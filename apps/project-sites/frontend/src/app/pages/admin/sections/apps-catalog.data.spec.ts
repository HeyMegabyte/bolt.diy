import { APPS_CATALOG, APP_CATEGORIES, isAppSupported, withHyperdrive, type InfraDep } from './apps-catalog.data';

/**
 * Data-integrity guard for the self-hostable app catalog (67 hand-authored
 * entries powering /admin/apps). `apps.component.spec` covers the filter/search
 * BEHAVIOUR; this locks the catalog's structural invariants so a future edit
 * can't silently ship a broken card:
 *  - a duplicate id breaks the @for track + collides app_instances.app_slug
 *  - an empty required field renders a blank/broken catalog card
 *  - an unknown category hides the app from every filter chip
 *  - a category chip with zero apps is a dead filter
 *  - a supported:true flag whose app is NOT bootable today mislabels Live/Soon
 *    (the flag is the SSOT — one source, no parallel slugs array, journey
 *    2026-08-19: a duplicate slugs array re-badged 9 cards Live while only 4
 *    had wired containers)
 */
describe('apps-catalog.data (catalog integrity)', () => {
  const catIds = new Set(APP_CATEGORIES.map((c) => c.id));

  it('every app id is unique (no @for-track / app_slug collisions)', () => {
    const ids = APPS_CATALOG.map((a) => a.id);
    expect(new Set(ids).size).withContext('duplicate id(s): ' + ids.filter((x, i) => ids.indexOf(x) !== i)).toBe(ids.length);
  });

  it('every app has the required non-empty fields + a positive port', () => {
    for (const a of APPS_CATALOG) {
      expect(a.id).withContext(`id of ${a.name}`).toMatch(/^[a-z0-9-]+$/); // url-safe slug
      expect((a.name ?? '').trim().length).withContext(`name of ${a.id}`).toBeGreaterThan(0);
      expect((a.tagline ?? '').trim().length).withContext(`tagline of ${a.id}`).toBeGreaterThan(0);
      expect((a.description ?? '').trim().length).withContext(`description of ${a.id}`).toBeGreaterThan(0);
      // Tombstones (removed apps kept as `supported: false` markers, e.g. n8n
      // per ADR-0034) intentionally carry inert infra fields — the deployable
      // contract below applies only to live entries.
      if (a.supported === false) continue;
      expect((a.image ?? '').trim().length).withContext(`image of ${a.id}`).toBeGreaterThan(0);
      expect(typeof a.port).withContext(`port of ${a.id}`).toBe('number');
      expect(a.port).withContext(`port of ${a.id}`).toBeGreaterThan(0);
      expect(Array.isArray(a.infra)).withContext(`infra of ${a.id}`).toBeTrue();
      expect(Array.isArray(a.env)).withContext(`env of ${a.id}`).toBeTrue();
    }
  });

  it('every app category is a known filter chip', () => {
    for (const a of APPS_CATALOG) {
      expect(catIds.has(a.category)).withContext(`${a.id} has unknown category "${a.category}"`).toBeTrue();
    }
  });

  it('every filter chip is used by at least one app (no dead chip)', () => {
    const used = new Set(APPS_CATALOG.map((a) => a.category));
    for (const c of APP_CATEGORIES) {
      expect(used.has(c.id)).withContext(`category chip "${c.id}" has zero apps`).toBeTrue();
    }
  });

  it('every category chip has a label + glyph', () => {
    for (const c of APP_CATEGORIES) {
      expect((c.label ?? '').trim().length).withContext(`label of chip ${c.id}`).toBeGreaterThan(0);
      expect((c.glyph ?? '').trim().length).withContext(`glyph of chip ${c.id}`).toBeGreaterThan(0);
    }
  });

  it('the supported flag is boolean on every app (no undefined Live/Soon mislabels)', () => {
    for (const a of APPS_CATALOG) {
      expect(typeof a.supported).withContext(`${a.id} supported flag must be true|false`).toBe('boolean');
    }
  });

  it('every Live (deployable) app documents a non-empty feature checklist', () => {
    for (const a of APPS_CATALOG.filter((x) => x.supported === true)) {
      expect((a.features?.length ?? 0))
        .withContext(`${a.id} (Live) should list its features in the About checklist`)
        .toBeGreaterThan(0);
    }
  });

  it('every feature entry is a non-empty string', () => {
    for (const a of APPS_CATALOG) {
      for (const f of a.features ?? []) {
        expect(typeof f === 'string' && f.trim().length > 0)
          .withContext(`feature of ${a.id}`).toBeTrue();
      }
    }
  });

  it('isAppSupported() agrees with the per-app supported flag (SSOT)', () => {
    for (const a of APPS_CATALOG) {
      expect(isAppSupported(a.id)).withContext(`${a.id} should match its flag (${a.supported})`).toBe(a.supported === true);
    }
    expect(isAppSupported('___not_a_real_app___')).toBeFalse();
  });
});

/**
 * Hyperdrive-when-Postgres rule: every Postgres connection routes through
 * Cloudflare Hyperdrive (pooling + acceleration). Derived via withHyperdrive()
 * so the rule lives in ONE place, not duplicated across ~30 Postgres apps.
 */
describe('withHyperdrive (Hyperdrive auto-included with Postgres)', () => {
  it('appends hyperdrive when postgres is present', () => {
    expect(withHyperdrive(['postgres'])).toContain('hyperdrive');
    expect(withHyperdrive(['postgres', 'redis'])).toEqual(['postgres', 'redis', 'hyperdrive']);
  });

  it('does NOT add hyperdrive when there is no postgres', () => {
    expect(withHyperdrive(['sqlite', 'volume'])).not.toContain('hyperdrive');
    expect(withHyperdrive([])).toEqual([]);
  });

  it('is idempotent — never duplicates hyperdrive', () => {
    expect(withHyperdrive(['postgres', 'hyperdrive'] as InfraDep[]).filter((d) => d === 'hyperdrive').length).toBe(1);
  });

  it('every catalog app that uses Postgres surfaces Hyperdrive (the invariant)', () => {
    for (const a of APPS_CATALOG) {
      if (a.infra.includes('postgres')) {
        expect(withHyperdrive(a.infra)).withContext(`${a.id} (postgres) must include hyperdrive`).toContain('hyperdrive');
      }
    }
  });
});
