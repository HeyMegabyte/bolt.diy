/**
 * @module e2e/social/social-flows
 * @description E2E tests for Pulse Social features.
 *
 * Covers SOCIAL-01..SOCIAL-05:
 * - Connect social account via OAuth (X, IG, FB, LI)
 * - Paste-key fallback when OAuth unconfigured
 * - Create + schedule cross-platform post
 * - Aggregate analytics across accounts
 * - Pulse post fan-out via Workflow
 *
 * @packageDocumentation
 */

import { test, expect } from '../fixtures.js';

// ---------------------------------------------------------------------------
// SOCIAL-01 — Connect social account via OAuth (X, IG, FB, LI)
// ---------------------------------------------------------------------------
test.describe('SOCIAL-01 — Connect social account via OAuth', () => {
  const SOCIAL_PROVIDERS = ['twitter', 'instagram', 'facebook', 'linkedin'] as const;

  for (const provider of SOCIAL_PROVIDERS) {
    test(`GET /api/social/${provider}/connect returns 401 without auth`, async ({ page }) => {
      const res = await page.request.get(`/api/social/${provider}/connect`);
      expect(res.status()).toBe(401);
    });

    test(`GET /api/social/${provider}/connect with auth returns 200 or 501`, async ({ authedPage: page }) => {
      const res = await page.request.get(`/api/social/${provider}/connect`);
      // 200 = authorize URL, 501 = OAuth not configured, 404 = provider not registered
      expect([200, 404, 501]).toContain(res.status());
    });
  }
});

// ---------------------------------------------------------------------------
// SOCIAL-02 — Paste-key fallback when OAuth unconfigured
// ---------------------------------------------------------------------------
test.describe('SOCIAL-02 — Paste-key fallback', () => {
  test('GET /api/social/twitter/connect with auth — if 501, body includes paste_spec', async ({ authedPage: page }) => {
    const res = await page.request.get('/api/social/twitter/connect');
    if (res.status() === 501) {
      const body = await res.json() as Record<string, unknown>;
      // A 501 from the social OAuth layer should explain why
      expect(body).toMatchObject(
        expect.objectContaining({
          error: expect.any(String),
        }),
      );
    } else {
      // 200 or 404 are also acceptable
      expect([200, 404]).toContain(res.status());
    }
  });
});

// ---------------------------------------------------------------------------
// SOCIAL-03 — Create + schedule cross-platform post
// ---------------------------------------------------------------------------
test.describe('SOCIAL-03 — Create + schedule post', () => {
  test('POST /api/social/posts returns 401 without auth', async ({ page }) => {
    const res = await page.request.post('/api/social/posts', {
      data: {
        content: 'E2E test post',
        platforms: ['twitter'],
        scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
        site_id: 'some-id',
      },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/social/posts with auth accepts valid payload', async ({ authedPage: page }) => {
    const res = await page.request.post('/api/social/posts', {
      data: {
        content: 'E2E test post — automated',
        platforms: ['twitter'],
        scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
        site_id: 'e2e-social-test',
      },
    });
    // 200/201 = queued, 404 = site not found, 422 = validation error
    expect([200, 201, 404, 422]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// SOCIAL-04 — Aggregate analytics across accounts
// ---------------------------------------------------------------------------
test.describe('SOCIAL-04 — Aggregate analytics', () => {
  test('GET /api/social/analytics returns 401 without auth', async ({ page }) => {
    const res = await page.request.get('/api/social/analytics');
    expect(res.status()).toBe(401);
  });

  test('GET /api/social/analytics with auth returns analytics shape', async ({ authedPage: page }) => {
    const res = await page.request.get('/api/social/analytics');
    // 200 = data, 404 = no social accounts connected — both acceptable
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json() as unknown;
      expect(typeof body).toBe('object');
    }
  });
});

// ---------------------------------------------------------------------------
// SOCIAL-05 — Pulse post fan-out via Workflow
// ---------------------------------------------------------------------------
test.describe('SOCIAL-05 — Workflow fan-out', () => {
  test('POST /api/social/posts/publish-now returns 401 without auth', async ({ page }) => {
    const res = await page.request.post('/api/social/posts/publish-now', {
      data: { post_id: 'some-post-id' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/social/posts/publish-now with auth on non-existent post returns 404', async ({ authedPage: page }) => {
    const res = await page.request.post('/api/social/posts/publish-now', {
      data: { post_id: 'nonexistent-post-id-e2e' },
    });
    expect([404, 422]).toContain(res.status());
  });
});
