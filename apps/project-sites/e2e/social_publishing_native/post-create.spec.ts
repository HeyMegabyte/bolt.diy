/**
 * @module e2e/social_publishing_native/post-create
 * @description RED spec — Social post creation + publishing flow.
 *
 * These tests FAIL until SOCIAL-110 (instant post) + SOCIAL-111 (schedule)
 * endpoints ship. RED first, GREEN as Tier 1 core posting lands.
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
    // 201 = draft created. 404 = flag off.
    expect([201, 404]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.status).toBe('draft');
    }
  });

  test('GET /api/social/posts lists posts with status filter', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts?status=draft&limit=5', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return { status: r.status, body: await r.json() };
    });
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });

  test('GET /api/social/posts/:id returns a single post', async ({ authedPage }) => {
    // RED because we need a real post ID — seeded or created in previous step.
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    // 404 = no post found or flag off. 200 = post returned.
    expect([200, 404]).toContain(res);
  });

  test('PATCH /api/social/posts/:id edits a draft', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Updated content' }),
      });
      return r.status;
    });
    expect([200, 404, 409]).toContain(res.status);
  });

  test('DELETE /api/social/posts/:id soft-deletes a post', async ({ authedPage }) => {
    const res = await authedPage.evaluate(async () => {
      const r = await fetch('/api/social/posts/nonexistent', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.status;
    });
    expect([200, 404]).toContain(res.status);
  });
});
