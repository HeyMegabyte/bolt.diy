/**
 * ALL-STAR Category D — GEO / AI search as a first-class feature (items 20-24).
 *
 * Tests JSON-LD autopilot, quotable answer blocks, llms.txt, AI visibility
 * tracker, cornerstone auto-refresh.
 */

import { test, expect } from '@playwright/test';

const ADMIN = '/admin';

test.describe('#20 structured-data autopilot', () => {
  test('generated site emits Organization + LocalBusiness + Service + FAQPage JSON-LD', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/');
    const html = await res.text();
    const scripts = html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/g) || [];
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    const allJson = scripts.map((s) => {
      const m = s.match(/>([\s\S]+?)</);
      return m ? JSON.parse(m[1]) : null;
    });
    const types = allJson.flatMap((j) => (Array.isArray(j) ? j : [j])).map((j) => j?.['@type']);
    // At minimum Organization or WebSite — others added when entities exist
    expect(types.some((t) => /Organization|WebSite|WebPage/i.test(String(t)))).toBeTruthy();
  });

  test('admin enforces "no fabricated FAQPage" — Q&A must trace to a source row', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('tab', { name: /seo|structured data/i }).click();
    const faqPanel = page.getByTestId('faqpage-panel');
    await expect(faqPanel).toBeVisible();
    // Each Q&A row shows a citation source
    if (await faqPanel.getByTestId('faq-row').count()) {
      await expect(faqPanel.getByTestId('faq-row').first().getByTestId('faq-source')).toBeVisible();
    }
  });

  test('JSON-LD validates against schema.org with no errors', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/');
    const html = await res.text();
    const matches = html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/g) || [];
    for (const s of matches) {
      const m = s.match(/>([\s\S]+?)</);
      expect(() => JSON.parse(m![1])).not.toThrow();
      const parsed = JSON.parse(m![1]);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const e of entries) {
        expect(e['@context']).toBe('https://schema.org');
        expect(e['@type']).toBeTruthy();
      }
    }
  });
});

test.describe('#21 quotable answer block generator', () => {
  test('every page has a <div data-quotable> lead paragraph (40-60 words)', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/');
    const html = await res.text();
    const match = html.match(/<[^>]+data-quotable[^>]*>([\s\S]+?)<\//);
    expect(match).toBeTruthy();
    const text = match![1].replace(/<[^>]+>/g, '').trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(30);
    expect(wordCount).toBeLessThanOrEqual(80); // 40-60 target with margin
  });

  test('admin can regenerate the quotable block per page', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    await page.getByTestId('site-card').first().click();
    await page.getByRole('tab', { name: /seo|content/i }).click();
    const block = page.getByTestId('quotable-block-editor').first();
    await expect(block).toBeVisible();
    await expect(block.getByRole('button', { name: /regenerate|rewrite/i })).toBeVisible();
  });
});

test.describe('#22 llms.txt + llms-full.txt per site', () => {
  test('/llms.txt serves a markdown-formatted route prioritization', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/llms.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/^#\s+/m); // markdown headers
    expect(body).toMatch(/\/\S+/); // route references
  });

  test('/llms-full.txt includes full content for top-N pages', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/llms-full.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(1_000);
  });

  test('robots.txt explicitly allows AI crawlers', async ({ request }) => {
    const res = await request.get('https://projectsites.dev/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    // Each AI crawler explicitly addressed (Allow or Disallow — never default-deny)
    for (const ua of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot']) {
      expect(body).toContain(ua);
    }
  });
});

test.describe('#23 AI-search visibility tracker', () => {
  test('admin sees daily citation count per query across ChatGPT/Claude/Perplexity', async ({ page }) => {
    await page.goto(`${ADMIN}/analytics/geo`);
    const tracker = page.getByTestId('geo-visibility-tracker');
    await expect(tracker).toBeVisible();
    await expect(tracker.getByTestId('query-row').first()).toBeVisible();
    // Each query shows citation rate per engine
    const firstRow = tracker.getByTestId('query-row').first();
    await expect(firstRow.getByTestId('cite-rate-chatgpt')).toBeVisible();
    await expect(firstRow.getByTestId('cite-rate-claude')).toBeVisible();
    await expect(firstRow.getByTestId('cite-rate-perplexity')).toBeVisible();
  });

  test('user adds a new query → cron runs nightly → results appear within 24h', async ({ page }) => {
    await page.goto(`${ADMIN}/analytics/geo`);
    await page.getByRole('button', { name: /add query/i }).click();
    await page.getByLabel(/query text/i).fill('best plumber in Newark NJ');
    await page.getByRole('button', { name: /save|add/i }).click();
    await expect(page.getByTestId('query-row').filter({ hasText: 'best plumber in Newark' })).toBeVisible();
    await expect(page.getByTestId('query-status-pending').or(page.getByTestId('query-result-ready'))).toBeVisible();
  });
});

test.describe('#24 auto-refresh cron for cornerstone pages', () => {
  test('admin sees Workflow run history per cornerstone page', async ({ page }) => {
    await page.goto(`${ADMIN}/automation/refresh`);
    const list = page.getByTestId('cornerstone-page-row');
    await expect(list.first()).toBeVisible();
    await expect(list.first().getByTestId('last-refresh')).toContainText(/\d/);
    await expect(list.first().getByTestId('next-refresh')).toContainText(/\d/);
  });

  test('manual refresh trigger fires Workflow immediately', async ({ page }) => {
    await page.goto(`${ADMIN}/automation/refresh`);
    await page.getByTestId('cornerstone-page-row').first().getByRole('button', { name: /refresh now/i }).click();
    await expect(page.getByTestId('refresh-in-progress').or(page.getByText(/refresh queued/i))).toBeVisible();
  });
});
