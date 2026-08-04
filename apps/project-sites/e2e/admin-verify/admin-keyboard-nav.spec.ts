/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the admin shell's power-user KEYBOARD
 * features: `g`-chord section navigation and the Cmd/Ctrl+. THEME cycle.
 *
 * Both live in `AdminComponent`'s `document:keydown` handler (every /admin/* route)
 * and are purely client-side (router nav / a `data-theme` attr + localStorage) →
 * INSTANT + load-independent → robust under parallel prod load (see
 * [[admin-verify-e2e-authoring-gotchas]] #5). Complements
 * command-palette-shortcuts.spec.ts (Cmd+K / `?`) with the g-chords + theme cycle.
 *
 * Contracts (pages/admin/admin.component.ts):
 *   - `g` then a letter navigates via `G_CHORD_ROUTES` (a→analytics, d→domains,
 *     f→forms, b→billing, l→traces→/admin/logs?tab=traces …). 900ms chord window,
 *     only when not in a field + no modifier.
 *   - Cmd/Ctrl+. cycles `theme` dark→system→light, sets `<html data-theme>` +
 *     persists `localStorage['ps_theme']`.
 *
 * Real session (E2E_API_KEY) so /admin mounts authed. Focus is blurred to <body>
 * before each chord so the handler's `inField` guard doesn't swallow the keys.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./command-palette-shortcuts.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** `g` + key → the route it must land on (regex tolerates query/redirect). */
const G_CHORDS: ReadonlyArray<readonly [string, RegExp]> = [
  ['a', /\/admin\/analytics/],
  ['d', /\/admin\/domains/],
  ['f', /\/admin\/forms/],
  ['b', /\/admin\/billing/],
  // `l` → /admin/traces which itself redirects to /admin/logs?tab=traces (P0.69 alias).
  ['l', /\/admin\/logs/],
] as const;

const VALID_THEMES = ['dark', 'system', 'light'];

test.describe('Admin · keyboard nav — g-chords + theme cycle (P0-ADMIN)', () => {
  test('the g-chord navigates to each section (g a / g d / g f / g b / g l)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page
      .waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 200, { timeout: 15000 })
      .catch(() => {});

    for (const [key, urlRe] of G_CHORDS) {
      // Ensure focus is on <body> (not an input) so the chord handler fires.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      await page.keyboard.press('g');
      await page.keyboard.press(key);
      await expect(page, `g ${key} must navigate to ${urlRe}`).toHaveURL(urlRe, { timeout: 8000 });
    }
  });

  test('Cmd/Ctrl+. cycles the theme on <html data-theme> and persists it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page
      .waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 200, { timeout: 15000 })
      .catch(() => {});
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

    const readTheme = () =>
      page.evaluate(() => ({
        attr: document.documentElement.getAttribute('data-theme'),
        stored: localStorage.getItem('ps_theme'),
      }));

    // First toggle: sets a valid theme on <html> AND mirrors it to localStorage.
    await page.keyboard.press('ControlOrMeta+.');
    await expect
      .poll(async () => (await readTheme()).attr, { timeout: 6000 })
      .toBeTruthy();
    const s1 = await readTheme();
    expect(VALID_THEMES, `data-theme must be a real theme — got "${s1.attr}"`).toContain(s1.attr);
    expect(s1.stored, 'localStorage.ps_theme must mirror the applied theme').toBe(s1.attr);

    // Second toggle: advances to a DIFFERENT theme (the dark→system→light cycle).
    await page.keyboard.press('ControlOrMeta+.');
    await expect.poll(async () => (await readTheme()).attr, { timeout: 6000 }).not.toBe(s1.attr);
    const s2 = await readTheme();
    expect(VALID_THEMES).toContain(s2.attr);
    expect(s2.stored, 'localStorage.ps_theme must track the second toggle').toBe(s2.attr);
    expect(s2.attr, 'the theme must advance (cycle), not stay put').not.toBe(s1.attr);
  });
});
