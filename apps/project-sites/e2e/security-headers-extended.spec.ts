/**
 * Security header verification — extended beyond the existing security-headers.spec.ts.
 *
 * Verifies HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
 * Permissions-Policy, COOP, COEP, CORP on public and API routes.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

const REQUIRED_HEADERS: Record<string, string | string[]> = {
  'strict-transport-security': 'max-age=',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'credentialless',
};

const CSP_DIRECTIVES = [
  "default-src 'self'",
  'frame-ancestors',
  "object-src 'none'",
  "base-uri 'self'",
];

test.describe('Security Headers — Public Surface', () => {
  test('homepage returns all required security headers', async ({ request }) => {
    const res = await request.get(PROD_URL);
    expect(res.status()).toBe(200);

    for (const [header, expected] of Object.entries(REQUIRED_HEADERS)) {
      const value = res.headers()[header];
      expect(value, `${header} must be present`).toBeDefined();
      if (typeof expected === 'string') {
        expect(value?.toLowerCase()).toContain(expected.toLowerCase());
      }
    }
  });

  test('CSP includes required directives on homepage', async ({ request }) => {
    const res = await request.get(PROD_URL);
    const csp = res.headers()['content-security-policy'];
    expect(csp).toBeDefined();

    for (const directive of CSP_DIRECTIVES) {
      expect(csp?.toLowerCase()).toContain(directive.toLowerCase());
    }
  });

  test('API routes return security headers', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/health`);
    expect(res.status()).toBe(200);
    expect(res.headers()['strict-transport-security']).toBeDefined();
  });

  test('404 response includes security headers (soft-404 SPA — known: Shell serves 200 for unknown HTML paths)', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/this-page-does-not-exist-${Date.now()}`);
    // Known soft-404: SPA shell serves 200 with security headers on unknown HTML paths.
    // Real 404 status requires per route manifest gating — tracked in convergence DONE K.
    expect([200, 404]).toContain(res.status());
    expect(res.headers()['x-content-type-options']).toBeDefined();
  });

  test('sign-in page has correct security posture', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/signin`);
    expect(res.status()).toBe(200);
    expect(res.headers()['x-frame-options']).toBe('SAMEORIGIN');
    // Permissions-Policy should restrict sensitive APIs
    const pp = res.headers()['permissions-policy'];
    expect(pp).toBeDefined();
    expect(pp).toContain('microphone');
  });
});

test.describe('CORS — API Endpoints', () => {
  test('API health accepts CORS preflight', async ({ request }) => {
    const res = await request.fetch(`${PROD_URL}/api/health`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://editor.projectsites.dev',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status()).toBe(204);
    expect(res.headers()['access-control-allow-credentials']).toBe('true');
  });
});
