import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

/**
 * Landmark + skip-link regression guard for the public homepage (the dashboard's
 * front door). Locks in the WCAG 1.3.1 / 2.4.1 a11y work:
 *   - exactly one <main id="main-content"> (the app-shell landmark; no duplicates)
 *   - the primary <nav> carries an accessible name
 *   - the footer is exposed as a contentinfo landmark
 *   - the skip-link targets a real #main-content anchor
 *   - exactly one <h1>
 *
 * Runs unauthenticated against the live homepage, so it's a true prod gate
 * (unlike the auth-gated axe admin scan in admin-a11y.e2e.ts).
 */
test.describe('homepage — landmark a11y', () => {
  test('single labeled main + named nav + contentinfo + working skip-link', async ({ page }) => {
    await page.goto('/');
    // Wait for Angular to finish rendering the shell (the labeled nav + main
    // exist only after hydration) so we assert the steady state, not a
    // pre-hydration frame.
    await page.waitForSelector('main#main-content', { state: 'attached' });
    await page.waitForSelector('nav[aria-label]', { state: 'attached' });

    const audit = await page.evaluate(() => {
      const q = (s: string) => Array.from(document.querySelectorAll(s));
      const mains = q('main, [role="main"]');
      const navs = q('nav, [role="navigation"]');
      const name = (el: Element) =>
        el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') ? '(labelledby)' : '');
      return {
        mainCount: mains.length,
        mainId: mains[0]?.id ?? '',
        navNames: navs.map(name),
        contentinfoCount: document.querySelectorAll('[role="contentinfo"], footer[role="contentinfo"]').length,
        skipLink: !!document.querySelector('a.skip-link[href="#main-content"]'),
        skipTarget: !!document.getElementById('main-content'),
        h1Count: q('h1').length,
      };
    });

    // Exactly one main landmark, and it is the skip-link target.
    expect(audit.mainCount).toBe(1);
    expect(audit.mainId).toBe('main-content');

    // Every navigation landmark has an accessible name (no bare "navigation").
    expect(audit.navNames.length).toBeGreaterThan(0);
    for (const n of audit.navNames) expect(n).not.toBe('');

    // Footer is a real contentinfo landmark.
    expect(audit.contentinfoCount).toBeGreaterThanOrEqual(1);

    // Skip-link wired to a real target.
    expect(audit.skipLink).toBe(true);
    expect(audit.skipTarget).toBe(true);

    // Exactly one top-level heading.
    expect(audit.h1Count).toBe(1);
  });

  test('no serious/critical axe violations on the homepage', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('main#main-content', { state: 'attached' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const blocking = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.impact} · ${v.id} · ${v.nodes.length}× · ${v.help}`);

    // eslint-disable-next-line no-console
    console.warn(`\n=== homepage axe BLOCKING (serious/critical): ${blocking.length} ===\n${blocking.join('\n') || '  ✓ none'}`);
    expect(blocking, blocking.join('\n')).toEqual([]);
  });
});
