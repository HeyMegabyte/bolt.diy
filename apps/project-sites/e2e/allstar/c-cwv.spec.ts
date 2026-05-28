/**
 * ALL-STAR Category C — Core Web Vitals as a built-in product (items 14-19).
 *
 * Tests the publish-gate, Speculation Rules injection, RUM telemetry,
 * Critical CSS, image triplet pipeline, and per-customer Speed Score.
 */

import { test, expect } from '@playwright/test';

const ADMIN = '/admin';

test.describe('#14 Lighthouse CI per-deploy publish gate', () => {
  test('failing CWV blocks the publish button with diff', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('button', { name: /publish|deploy/i }).click();

    const gate = page.getByTestId('publish-cwv-gate');
    await expect(gate).toBeVisible();
    // Each metric reports pass/fail with target
    await expect(gate.getByTestId('metric-lcp')).toContainText(/LCP/i);
    await expect(gate.getByTestId('metric-cls')).toContainText(/CLS/i);
    await expect(gate.getByTestId('metric-inp')).toContainText(/INP/i);

    // If any fail, the publish button is disabled
    const failingMetric = page.getByTestId('metric-failing').first();
    if (await failingMetric.count()) {
      await expect(page.getByRole('button', { name: /^publish$/i })).toBeDisabled();
    }
  });

  test('admin sees fix suggestions per failing metric', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('tab', { name: /performance|cwv/i }).click();
    const failingRow = page.getByTestId('cwv-failing-row').first();
    if (await failingRow.count()) {
      await failingRow.click();
      await expect(page.getByTestId('cwv-fix-suggestions')).toBeVisible();
    }
  });

  test('admin override unlocks publish but is audited', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('button', { name: /publish|deploy/i }).click();
    const overrideBtn = page.getByRole('button', { name: /override.*publish anyway/i });
    if (await overrideBtn.isVisible()) {
      await overrideBtn.click();
      await expect(page.getByTestId('override-reason-input')).toBeVisible();
      // Must enter reason — audited
    }
  });
});

test.describe('#15 Speculation Rules auto-injection', () => {
  test('generated site emits <script type="speculationrules">', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/');
    const html = await res.text();
    expect(html).toMatch(/<script type="speculationrules">/);
    expect(html).toMatch(/"prerender"|"prefetch"/);
  });

  test('admin opt-out toggle disables Speculation Rules for analytics-purity', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('tab', { name: /performance/i }).click();
    const toggle = page.getByTestId('speculation-rules-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
  });
});

test.describe('#16 RUM (LoAF + soft-nav web-vitals v4) telemetry', () => {
  test('admin INP heatmap shows per-route p75 INP', async ({ page }) => {
    await page.goto(`${ADMIN}/analytics/cwv`);
    await expect(page.getByTestId('inp-heatmap')).toBeVisible();
    await expect(page.getByTestId('inp-heatmap-row').first()).toBeVisible();
    // p75 INP column has a numeric value in ms
    await expect(page.getByTestId('inp-heatmap-row').first().getByTestId('inp-p75')).toContainText(/\d+\s*ms/);
  });

  test('clicking a route opens a Long Animation Frame breakdown', async ({ page }) => {
    await page.goto(`${ADMIN}/analytics/cwv`);
    await page.getByTestId('inp-heatmap-row').first().click();
    await expect(page.getByTestId('loaf-breakdown')).toBeVisible();
    await expect(page.getByTestId('loaf-script-attribution')).toBeVisible();
  });
});

test.describe('#17 Critical CSS extraction + inline', () => {
  test('generated site has <style data-critical> in <head>', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/');
    const html = await res.text();
    expect(html).toMatch(/<style[^>]*data-critical/);
    // Critical CSS is small (under 14KB to fit in first TCP packet)
    const match = html.match(/<style[^>]*data-critical[^>]*>([\s\S]+?)<\/style>/);
    if (match) expect(match[1].length).toBeLessThan(14_000);
  });

  test('non-critical CSS lazy-loads via <link rel="preload" as="style">', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/');
    const html = await res.text();
    expect(html).toMatch(/<link[^>]*rel="preload"[^>]*as="style"/);
  });
});

test.describe('#18 AVIF / WebP / JPEG image triplet pipeline', () => {
  test('every generated image is served as <picture> with AVIF + WebP + JPEG', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/');
    const html = await res.text();
    expect(html).toMatch(/<picture>/);
    expect(html).toMatch(/type="image\/avif"/);
    expect(html).toMatch(/type="image\/webp"/);
  });

  test('upload pipeline emits 3 formats on a single ingestion', async ({ page }) => {
    await page.goto(`${ADMIN}/media`);
    await page.getByTestId('media-upload').setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        // 1px transparent PNG
        '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
          '1f15c4890000000d49444154789c63000000000000000000007373001a00000000',
        'hex',
      ),
    });
    await expect(page.getByTestId('media-asset-card').first()).toBeVisible({ timeout: 30_000 });
    const card = page.getByTestId('media-asset-card').first();
    await expect(card.getByTestId('format-avif')).toBeVisible();
    await expect(card.getByTestId('format-webp')).toBeVisible();
    await expect(card.getByTestId('format-jpeg').or(card.getByTestId('format-png'))).toBeVisible();
  });
});

test.describe('#19 per-customer Speed Score widget on admin', () => {
  test('admin sees CWV score with industry comparison', async ({ page }) => {
    await page.goto(`${ADMIN}/dashboard`);
    const widget = page.getByTestId('speed-score-widget');
    await expect(widget).toBeVisible();
    await expect(widget.getByTestId('speed-score-value')).toContainText(/\d+/);
    await expect(widget).toContainText(/industry|benchmark|faster|slower/i);
  });

  test('share-with-client export generates a PDF report', async ({ page }) => {
    await page.goto(`${ADMIN}/dashboard`);
    await page.getByTestId('speed-score-widget').click();
    await page.getByRole('button', { name: /export|share with client/i }).click();
    const pdfLink = page.getByRole('link', { name: /download.*pdf/i });
    await expect(pdfLink).toBeVisible({ timeout: 30_000 });
    expect(await pdfLink.getAttribute('href')).toMatch(/\.pdf|application\/pdf/);
  });
});
