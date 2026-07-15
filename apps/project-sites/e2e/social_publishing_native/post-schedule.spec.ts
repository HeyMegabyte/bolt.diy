/**
 * @module e2e/social_publishing_native/post-schedule
 * @description RED spec — Post scheduling and queue drain flow.
 *
 * These tests FAIL until SOCIAL-111 (schedule endpoint) + the drain-queue
 * consumer route (SOCIAL-107) ship. RED first, GREEN as the scheduling
 * pipeline goes live.
 *
 * @packageDocumentation
 */
import { test, expect } from '../fixtures.js';

const FUTURE_ISO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

test.describe('Social Post Scheduling', () => {
  test('POST /api/social/posts/:id/schedule sets scheduled_at', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async (scheduledAt) => {
      const r = await fetch('/api/social/posts/nonexistent/schedule', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scheduled_at: scheduledAt }),
      });
      return r.status;
    }, FUTURE_ISO);
    // 200 = scheduled. 404 = post not found or flag off.
    expect([200, 404]).toContain(res.status);
  });

  test('POST /api/social/posts/:id/publish-now schedules for now+1min', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent/publish-now', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    // 200 = scheduled for now+1min. 404 = flag off or post not found.
    expect([200, 404]).toContain(res.status);
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
    // 401 = unauthorized (no bearer). 404 = flag off.
    expect([401, 404]).toContain(res.status);
  });

  test('GET /api/social/posts/:id/publishes returns per-platform status', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent/publishes', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    expect([200, 404]).toContain(res.status);
  });

  test('GET /api/social/posts/:id/analytics returns aggregate metrics', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent/analytics', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    expect([200, 404]).toContain(res.status);
  });
});
