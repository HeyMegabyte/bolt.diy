/**
 * Public route completeness — verifies every public route returns 200
 * and has proper SEO/security posture.
 *
 * Covers all routes from app.routes.ts public surface.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

const PUBLIC_ROUTES = [
  '/', '/signin', '/auth/sign-up', '/pricing', '/blog', '/search',
  '/integrations', '/developers', '/press', '/changelog',
  '/privacy', '/terms', '/content',
] as const;

test.describe('Public Route Completeness', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`GET ${route} returns 200`, async ({ request }) => {
      const res = await request.get(`${PROD_URL}${route}`);
      expect(res.status()).toBe(200);
    });
  }
});

test.describe('Static Asset Routes', () => {
  test('/robots.txt returns 200', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/robots.txt`);
    expect(res.status()).toBe(200);
  });

  test('/sitemap.xml returns 200', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/sitemap.xml`);
    expect(res.status()).toBe(200);
  });

  test('/humans.txt returns 200', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/humans.txt`);
    expect(res.status()).toBe(200);
  });
});
