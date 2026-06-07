import { APPS_CATALOG, APP_CATEGORIES, SUPPORTED_APP_SLUGS, isAppSupported } from './apps-catalog.data';

/**
 * Data-integrity guard for the self-hostable app catalog (67 hand-authored
 * entries powering /admin/apps). `apps.component.spec` covers the filter/search
 * BEHAVIOUR; this locks the catalog's structural invariants so a future edit
 * can't silently ship a broken card:
 *  - a duplicate id breaks the @for track + collides app_instances.app_slug
 *  - an empty required field renders a blank/broken catalog card
 *  - an unknown category hides the app from every filter chip
 *  - a category chip with zero apps is a dead filter
 *  - a SUPPORTED_APP_SLUGS entry not matching a real app id mislabels Live/Soon
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

  it('every SUPPORTED_APP_SLUGS entry references a real app id', () => {
    const ids = new Set(APPS_CATALOG.map((a) => a.id));
    for (const slug of SUPPORTED_APP_SLUGS) {
      expect(ids.has(slug)).withContext(`supported slug "${slug}" is not a real app id`).toBeTrue();
    }
  });

  it('isAppSupported() agrees with the supported-slug set', () => {
    for (const slug of SUPPORTED_APP_SLUGS) {
      expect(isAppSupported(slug)).withContext(`${slug} should be supported`).toBeTrue();
    }
    const unsupported = APPS_CATALOG.find((a) => !SUPPORTED_APP_SLUGS.includes(a.id));
    if (unsupported) expect(isAppSupported(unsupported.id)).withContext(`${unsupported.id} should be Soon`).toBeFalse();
    expect(isAppSupported('___not_a_real_app___')).toBeFalse();
  });
});
