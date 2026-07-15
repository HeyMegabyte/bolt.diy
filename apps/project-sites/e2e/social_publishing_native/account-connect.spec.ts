/**
 * @module e2e/social_publishing_native/account-connect
 * @description GREEN spec — Social account OAuth connect flow.
 *
 * Flag promoted to beta (enabled=1, rollout=25%) 2026-07-15.
 * SOCIAL-100 through SOCIAL-109 all shipped. These tests assert the
 * native social API is live and responding with 200.
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
    // Flag is beta (enabled=1). Expect 200 with data array.
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/social/:platform/connect returns authorize URL or paste-key for X/Twitter', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/twitter/connect', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: r.status, body: await r.json() };
    });
    // 200 with authorize_url when OAuth creds set, 501 when missing (paste-key fallback).
    expect([200, 501]).toContain(res.status);
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
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('paste_key');
  });

  test('DELETE /api/social/accounts/:id disconnects an account', async ({ authedPage }) => {
    // Uses a non-existent ID — expects 404 (not found) from the API.
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/accounts/nonexistent-test-id', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    // 404 = not found (no such account). 200 would mean it was deletable.
    expect(res.status).toBe(404);
  });
});
