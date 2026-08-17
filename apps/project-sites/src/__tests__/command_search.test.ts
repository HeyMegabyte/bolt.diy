import { matchCommandCatalog } from '../routes/search';

describe('matchCommandCatalog (⌘K smart-results catalog)', () => {
  it('returns [] for blank / sub-2-char queries', () => {
    expect(matchCommandCatalog('')).toEqual([]);
    expect(matchCommandCatalog('   ')).toEqual([]);
  });

  it('matches on label, case-insensitively', () => {
    const r = matchCommandCatalog('BILLING');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((c) => c.route === '/admin/billing')).toBe(true);
  });

  it('matches on route segment', () => {
    const r = matchCommandCatalog('feature-flags');
    expect(r.some((c) => c.route === '/admin/feature-flags')).toBe(true);
  });

  it('every result carries the palette command shape (id/label/icon/route)', () => {
    for (const c of matchCommandCatalog('admin', 50)) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.label).toBe('string');
      expect(typeof c.icon).toBe('string');
      expect(c.route).toMatch(/^\//);
    }
  });

  it('honors the limit', () => {
    expect(matchCommandCatalog('s', 3).length).toBeLessThanOrEqual(3);
  });
});

// ─── Every advertised ⌘K route must resolve (no admin-404 dead-ends) ──────────
// The ⌘K "Smart results" palette renders these as clickable nav. A command whose
// route has no matching Angular route dumps the user on AdminNotFoundComponent
// (the admin `**` 404). Two stale entries did exactly that (verified live 2026-08-17):
// `cs-sites → /admin/sites` and `cs-media → /admin/media`. This is a SINGLE-SITE
// admin — there is deliberately NO bare `/admin/sites` list route and NO
// `/admin/media` route (see frontend onboarding-checklist.component.ts: "this
// single-site admin has no sites-list/domains route"). Source of truth for the
// route set: apps/project-sites/frontend/src/app/app.routes.ts (admin children).
describe('matchCommandCatalog — advertised routes must resolve (no admin-404 dead-ends)', () => {
  const KNOWN_ADMIN_ROUTES = new Set<string>([
    '/admin',
    '/admin/welcome',
    '/admin/accept-invite',
    '/admin/team',
    '/admin/auth-security',
    '/admin/snapshots',
    '/admin/snapshots/diff',
    '/admin/analytics',
    '/admin/billing',
    '/admin/api-tokens',
    '/admin/feature-flags',
    '/admin/leads',
    '/admin/site-features',
    '/admin/forms',
    '/admin/docs',
    '/admin/voice',
    '/admin/settings',
    '/admin/user',
    '/admin/domains',
    '/admin/logs',
    '/admin/deliverability',
    '/admin/apps',
    '/admin/apps/instances',
    '/admin/social',
    '/admin/social/analytics',
    '/admin/traces',
    '/admin/seo',
    '/admin/mcp',
    '/admin/ai-chat',
    '/admin/webhooks',
    '/admin/ai-logs',
    '/admin/audit',
    '/admin/ai-endpoints',
    '/admin/super-admin',
    '/admin/system-services',
    '/admin/editor',
  ]);

  it('no /admin ⌘K command dead-ends at the admin 404', () => {
    // 'admin' matches every admin catalog entry by its route substring → full enumeration.
    const bad = matchCommandCatalog('admin', 100)
      .filter((c) => c.route && !KNOWN_ADMIN_ROUTES.has(c.route))
      .map((c) => `${c.id}→${c.route}`);
    expect(bad).toEqual([]);
  });

  it('does not advertise a "Media library" command (no /admin/media route/UI exists)', () => {
    expect(matchCommandCatalog('media', 50)).toEqual([]);
  });
});
