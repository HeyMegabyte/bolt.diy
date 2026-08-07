/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — POPULATED-RENDER + XSS for the snapshot diff viewer
 * (`/admin/snapshots/diff?from=A&to=B`). Stubs a populated diff (added / removed / modified files)
 * with a hostile file path and asserts the file rows render + the path is inert. Completes the
 * diff viewer's data-state matrix alongside `snapshots-diff-error-state` (500 → error card).
 *
 * `snapshots-diff.component.ts`: file rows are `<li>` with a `<code [attr.title]="f.path">{{ f.path }}</code>`
 * across the added/removed/modified sections — `{{ }}` interpolation (innerHTML-free → escaped).
 * Reads `?from=&to=` from the URL → `GET /api/sites/:siteId/snapshots/diff`. Site-scoped.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./snapshots-diff-error-state.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const XSS = '<img src=x onerror="window.__xssHit=1">日本語 🎉';

function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

test.describe('Admin · Snapshots Diff populated-render + XSS (P0-ADMIN)', () => {
  test('a populated diff renders added/removed/modified file rows + a hostile path is inert', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let hadDialog = false;
    page.on('dialog', (d) => {
      hadDialog = true;
      d.dismiss().catch(() => {});
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/snapshots/diff**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: 'Added 1, removed 1, modified 1',
          from: { id: 'snap-a', name: 'Snapshot A', build_version: 'v1.0' },
          to: { id: 'snap-b', name: 'Snapshot B', build_version: 'v2.0' },
          added: [{ path: `assets/${XSS}.svg`, contents: '<svg></svg>', binary: false, truncated: false }],
          removed: [{ path: 'styles/legacy.css', contents: '/* old */', binary: false, truncated: false }],
          modified: [
            {
              path: 'index.html',
              before: '<h1>Old</h1>',
              after: '<h1>New</h1>',
              hunks: [
                { added: false, removed: true, value: '<h1>Old</h1>\n' },
                { added: true, removed: false, value: '<h1>New</h1>\n' },
              ],
              truncated: false,
            },
          ],
        }),
      }),
    );
    await page.goto('/admin/snapshots/diff?from=snap-a&to=snap-b', { waitUntil: 'domcontentloaded' });

    // Each file row renders its path in a `<code [title]>` — count them (added+removed+modified ≥ 3).
    const rows = page.locator('code[title]');
    await expect(rows.first(), 'the diff file rows render on a populated diff').toBeVisible({ timeout: 15000 });
    expect(await rows.count(), 'added + removed + modified file rows all render').toBeGreaterThanOrEqual(3);

    expect(
      await page.evaluate(() => (window as unknown as { __xssHit?: number }).__xssHit ?? 0),
      'the hostile file path did not execute',
    ).toBe(0);
    expect(hadDialog, 'no alert dialog from the hostile path').toBe(false);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a populated diff must not crash').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/snapshots-diff-populated.png' });
    expect(errors, `no console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
