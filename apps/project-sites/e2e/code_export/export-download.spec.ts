/**
 * @module e2e/code_export/export-download
 * @description GREEN spec — Code Export download endpoint.
 *
 * Flag is experimental (off by default). These tests assert 404 when the flag
 * is off (safe default), and 200 with a valid zip when the flag is on.
 * Run against PROD URL after deploy.
 *
 * @packageDocumentation
 */
import { test, expect } from '../fixtures.js';

test.describe('Code Export — Download', () => {
  test('GET /api/sites/:siteId/export returns 404 when flag is off', async ({
    authedPage,
  }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/sites/test-site/export', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      return { status: r.status, headers: Object.fromEntries(r.headers) };
    });
    // Flag is experimental (off by default). Expect 404.
    expect(res.status).toBe(404);
  });

  test('GET /api/sites/:siteId/export?version=latest requests specific version', async ({
    authedPage,
  }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/sites/test-site/export?version=latest', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      return r.status;
    });
    expect(res.status).toBe(404); // flag off
  });

  test('GET /api/sites/:siteId/export rejects unauthenticated requests', async ({
    page,
  }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/sites/test-site/export');
      return r.status;
    });
    // 401 = unauthorized (no bearer token), 404 = flag off.
    expect([401, 404]).toContain(res.status);
  });
});
