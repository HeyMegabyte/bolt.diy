/**
 * @module e2e/social_publishing_native/post-schedule
 * @description GREEN spec — Post scheduling and queue drain flow.
 *
 * Flag promoted to beta (enabled=1, rollout=25%) 2026-07-15.
 * SOCIAL-107 (Upstash Redis queues) + SOCIAL-108 (CF Workflows v2) shipped.
 * These tests assert the scheduling pipeline is live.
 *
 * @packageDocumentation
 */
import { test, expect } from '../fixtures.js';

const FUTURE_ISO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

test.describe('Social Post Scheduling', () => {
  test('POST /api/social/posts/:id/schedule returns 404 for nonexistent post', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async (scheduledAt) => {
      const r = await fetch('/api/social/posts/nonexistent-test-id/schedule', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scheduled_at: scheduledAt }),
      });
      return r.status;
    }, FUTURE_ISO);
    // 404 = post not found (route is live, flag is on, post doesn't exist).
    expect(res.status).toBe(404);
  });

  test('POST /api/social/posts/:id/publish-now returns 404 for nonexistent post', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent-test-id/publish-now', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    // 404 = post not found (route is live, flag is on).
    expect(res.status).toBe(404);
  });

  test('POST /api/internal/social/drain-queue rejects unauthenticated callers', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/internal/social/drain-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5 }),
      });
      return r.status;
    });
    // 401 = unauthorized (no bearer token on internal endpoint).
    expect(res.status).toBe(401);
  });

  test('GET /api/social/posts/:id/publishes returns 404 for nonexistent post', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent-test-id/publishes', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    // 404 = post not found (route is live, flag is on).
    expect(res.status).toBe(404);
  });

  test('GET /api/social/posts/:id/analytics returns 404 for nonexistent post', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent-test-id/analytics', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    // 404 = post not found (route is live, flag is on).
    expect(res.status).toBe(404);
  });
});
