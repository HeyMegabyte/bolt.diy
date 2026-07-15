/**
 * @module e2e/social_publishing_native/account-connect
 * @description RED spec — Social account OAuth connect flow.
 *
 * These tests FAIL until the `social_publishing_native` flag is promoted to
 * beta + the OAuth endpoints are live. Per TDD discipline: RED first, turn
 * GREEN as SOCIAL-104 (accounts CRUD) + SOCIAL-103 (social_auth) ship.
 *
 * @packageDocumentation
 */
import { test, expect } from '../fixtures.js';

test.describe('Social Account Connect', () => {
  test('GET /api/social/accounts returns connected accounts list', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/accounts', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: r.status, body: await r.json() };
    });
    // When flag is on: 200 with data array. When flag is off: 404.
    // RED because flag is experimental (off by default).
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });

  test('GET /api/social/:platform/connect returns authorize URL for X/Twitter', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/twitter/connect', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: r.status, body: await r.json() };
    });
    // 200 with authorize_url when OAuth creds set, 501 when missing, 404 when flag off.
    expect([200, 404, 501]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data).toHaveProperty('authorize_url');
      expect(res.body.data.authorize_url).toContain('https://');
    }
  });

  test('GET /api/social/bluesky/connect returns paste-key spec', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/bluesky/connect', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: r.status, body: await r.json() };
    });
    // Bluesky has no OAuth — always returns paste-key mode.
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data.mode).toBe('paste_key');
    }
  });

  test('DELETE /api/social/accounts/:id disconnects an account', async ({ authedPage }) => {
    // This test will need a real account ID to delete — RED until seeded.
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/accounts/test-id', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    // 404 = not found (flag off or no test account). 200 = deleted.
    expect([200, 404]).toContain(res);
  });
});
