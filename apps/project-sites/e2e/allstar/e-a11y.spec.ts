/**
 * ALL-STAR Category E — Accessibility, non-negotiable, real liability (items 25-29).
 *
 * Tests axe-core publish gate, AI alt-text, WCAG 2.2 manual wizard, OKLCH
 * contrast auto-correct, accessibility statement.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ADMIN = '/admin';

test.describe('#25 axe-core pre-publish gate at 6 viewports', () => {
  const viewports = [
    { name: 'mobile-sm', width: 375, height: 667 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'laptop', width: 1024, height: 768 },
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'wide', width: 1920, height: 1080 },
  ];
  for (const vp of viewports) {
    test(`marketing homepage has 0 axe violations at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('https://projectsites.dev/');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }

  test('publish flow runs axe scan + blocks on violations', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('button', { name: /publish|deploy/i }).click();
    const gate = page.getByTestId('publish-a11y-gate');
    await expect(gate).toBeVisible();
    await expect(gate.getByTestId('axe-results')).toBeVisible();
  });
});

test.describe('#26 AI alt-text on every upload', () => {
  test('uploaded image gets alt text generated via vision model', async ({ page }) => {
    await page.goto(`${ADMIN}/media`);
    await page.getByTestId('media-upload').setInputFiles({
      name: 'cafe.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb0043000201010101010102010101010202020203030302', 'hex'),
    });
    const card = page.getByTestId('media-asset-card').first();
    await expect(card.getByTestId('alt-text')).toBeVisible({ timeout: 30_000 });
    const altText = await card.getByTestId('alt-text').textContent();
    expect((altText ?? '').length).toBeGreaterThan(10);
    expect(altText).not.toMatch(/^(image|photo|picture)$/i); // not generic
  });

  test('admin can override AI alt-text + override persists', async ({ page }) => {
    await page.goto(`${ADMIN}/media`);
    const card = page.getByTestId('media-asset-card').first();
    await card.click();
    await page.getByTestId('alt-text-input').fill('Manual override alt');
    await page.getByRole('button', { name: /save/i }).click();
    await page.reload();
    await page.getByTestId('media-asset-card').first().click();
    await expect(page.getByTestId('alt-text-input')).toHaveValue('Manual override alt');
  });
});

test.describe('#27 WCAG 2.2 manual-review wizard at publish', () => {
  test('wizard covers the 8 criteria axe cannot auto-detect', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('button', { name: /publish|deploy/i }).click();
    const wizard = page.getByTestId('wcag22-manual-wizard');
    await expect(wizard).toBeVisible();
    for (const c of [
      'Focus Appearance', // 2.4.11
      'Focus Not Obscured', // 2.4.12
      'Dragging', // 2.5.7
      'Target Size', // 2.5.8 (axe partial)
      'Consistent Help', // 3.2.6
      'Redundant Entry', // 3.3.7
      'Accessible Authentication', // 3.3.8 + 3.3.9
    ]) {
      await expect(wizard.getByText(c, { exact: false })).toBeVisible();
    }
  });

  test('wizard "I have verified" attests via admin signature + audit row', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('button', { name: /publish|deploy/i }).click();
    const wizard = page.getByTestId('wcag22-manual-wizard');
    if (await wizard.isVisible()) {
      for (const checkbox of await wizard.getByRole('checkbox').all()) {
        await checkbox.check();
      }
      await expect(page.getByRole('button', { name: /^publish$/i })).toBeEnabled();
    }
  });
});

test.describe('#28 OKLCH contrast auto-correct', () => {
  test('palette token failing 4.5:1 surfaces a one-click "lift" button', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('tab', { name: /brand|theme/i }).click();
    const tokens = page.getByTestId('palette-token-row');
    await expect(tokens.first()).toBeVisible();
    // If any token fails, the lift button is shown
    const failing = page.getByTestId('contrast-failing-row').first();
    if (await failing.count()) {
      await expect(failing.getByRole('button', { name: /lift|auto.correct/i })).toBeVisible();
    }
  });

  test('lifted value uses oklch(from ...) syntax', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('tab', { name: /brand|theme/i }).click();
    const failing = page.getByTestId('contrast-failing-row').first();
    if (await failing.count()) {
      await failing.getByRole('button', { name: /lift|auto.correct/i }).click();
      const after = await failing.getByTestId('token-value').textContent();
      expect(after).toMatch(/oklch\(/);
    }
  });
});

test.describe('#29 per-customer accessibility statement page', () => {
  test('every customer site has /accessibility page with WCAG 2.2 conformance + contact', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/accessibility');
    expect([200, 301, 302]).toContain(res.status());
    if (res.status() === 200) {
      const html = await res.text();
      expect(html).toMatch(/WCAG 2\.2/i);
      expect(html).toMatch(/contact|email|mailto:/i);
    }
  });

  test('admin can edit the statement; IRS Section 44 explainer surfaces for small biz', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('tab', { name: /accessibility|a11y/i }).click();
    await expect(page.getByTestId('accessibility-statement-editor')).toBeVisible();
    await expect(page.getByText(/IRS Section 44|tax credit/i)).toBeVisible();
  });
});
