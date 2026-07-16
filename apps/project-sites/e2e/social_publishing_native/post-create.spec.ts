/**
 * @module e2e/social_publishing_native/post-create
 * @description GREEN spec — Social post creation + publishing flow.
 *
 * Flag promoted to beta (enabled=1, rollout=25%) 2026-07-15.
 * SOCIAL-100 through SOCIAL-109 all shipped. These tests assert the
 * native social post CRUD API is live.
 *
 * @packageDocumentation
 */
import { test, expect } from '../fixtures.js';

const TEST_POST = {
  content: 'Hello from E2E test — please ignore.',
  platforms: ['twitter'] as const,
  hashtags: ['test'],
};

test.describe('Social Post Create + Publish', () => {
  test('POST /api/social/posts creates a draft', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async (body) => {
      const r = await fetch('/api/social/posts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    }, TEST_POST);
    // 201 = draft created. Flag is beta (enabled=1).
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.status).toBe('draft');
  });

  test('GET /api/social/posts lists posts with status filter', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts?status=draft&limit=5', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/social/posts/:id returns 404 for nonexistent post', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent-test-id', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    // 404 = post not found (flag is on, route is live, post just doesn't exist).
    expect(res.status).toBe(404);
  });

  test('PATCH /api/social/posts/:id returns 404 for nonexistent post', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent-test-id', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Updated content' }),
      });
      return r.status;
    });
    // 404 = post not found (route is live, flag is on).
    expect(res.status).toBe(404);
  });

  test('DELETE /api/social/posts/:id returns 404 for nonexistent post', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent-test-id', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    // 404 = post not found (route is live, flag is on).
    expect(res.status).toBe(404);
  });
});
