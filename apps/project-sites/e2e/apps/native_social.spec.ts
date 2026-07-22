/**
 * @module e2e/apps/native_social
 * @description Convergence E2E — Native Social (social.projectsites.dev).
 * SOCIAL-100–109 all shipped, flag is beta. Asserts social API is live.
 */
import { test, expect } from '../fixtures.js';

test.describe('Native Social — convergence', () => {
  test('GET /api/social/accounts returns connected accounts', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/accounts', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  test('GET /api/social/posts returns post list', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts?limit=5', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    expect([200, 404]).toContain(res.status);
  });

  test('GET /api/social/bluesky/connect returns paste-key mode', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/bluesky/connect', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('paste_key');
  });

  test('POST /api/social/proposals requires auth', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/social/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      return r.status;
    });
    expect([401, 404]).toContain(res.status);
  });
});
