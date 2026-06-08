import { G_CHORD_ROUTES } from './admin.component';

/**
 * The `g`-chord navigation map must match the routes the shortcuts-overlay
 * cheat-sheet advertises (the overlay is the user-facing source of truth).
 * Regression guard for the stale-map bug: `g e` advertised "Go to Editor" but
 * navigated to `/admin` (Dashboard) after the editor moved to `/admin/editor`.
 * Pure data — no need to instantiate the heavy admin shell.
 */
describe('G_CHORD_ROUTES (g-chord nav ↔ shortcuts-overlay contract)', () => {
  it('g e goes to the Editor (NOT the Dashboard) — matches "Go to Editor"', () => {
    expect(G_CHORD_ROUTES['e']).toBe('/admin/editor');
    expect(G_CHORD_ROUTES['e']).not.toBe('/admin');
  });

  it('every advertised chord maps to its cheat-sheet route', () => {
    // Mirrors shortcuts-overlay SHORTCUT_GROUPS Navigation: e/s/a/f/l/c/b/v/d/u.
    expect(G_CHORD_ROUTES).toEqual({
      e: '/admin/editor',
      s: '/admin/snapshots',
      a: '/admin/analytics',
      f: '/admin/forms',
      l: '/admin/traces',
      c: '/admin/ai-chat',
      b: '/admin/billing',
      v: '/admin/voice',
      d: '/admin/domains',
      u: '/admin/user',
    });
  });

  it('every chord target is an absolute /admin/* route (no dead/relative paths)', () => {
    for (const path of Object.values(G_CHORD_ROUTES)) {
      expect(path.startsWith('/admin/')).withContext(`${path} is an /admin/* route`).toBe(true);
    }
  });
});
