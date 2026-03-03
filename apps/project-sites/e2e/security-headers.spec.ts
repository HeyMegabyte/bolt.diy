/**
 * E2E tests for security headers, CSP, CORS, and request tracing.
 */
import { test, expect } from './fixtures.js';

test.describe('Security Headers', () => {
  test('homepage returns HSTS header', async ({ request }) => {
    const res = await request.get('/');
    const hsts = res.headers()['strict-transport-security'];
    expect(hsts).toContain('max-age=');
    expect(hsts).toContain('includeSubDomains');
  });

  test('homepage returns X-Content-Type-Options', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('homepage returns X-Frame-Options', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['x-frame-options']).toBe('DENY');
  });

  test('homepage returns Referrer-Policy', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('homepage returns Permissions-Policy', async ({ request }) => {
    const res = await request.get('/');
    const pp = res.headers()['permissions-policy'];
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
  });

  test('homepage returns Content-Security-Policy', async ({ request }) => {
    const res = await request.get('/');
    const csp = res.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src");
    expect(csp).toContain("'unsafe-inline'");
  });

  test('CSP allows Stripe JS', async ({ request }) => {
    const res = await request.get('/');
    const csp = res.headers()['content-security-policy'];
    expect(csp).toContain('js.stripe.com');
  });

  test('API endpoints return security headers', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['x-frame-options']).toBe('DENY');
  });
});

test.describe('CORS Headers', () => {
  test('CORS allows projectsites.dev origin', async ({ request }) => {
    const res = await request.get('/health', {
      headers: { Origin: 'https://projectsites.dev' },
    });
    const acao = res.headers()['access-control-allow-origin'];
    expect(acao).toBe('https://projectsites.dev');
  });

  test('CORS allows editor.projectsites.dev origin', async ({ request }) => {
    const res = await request.get('/health', {
      headers: { Origin: 'https://editor.projectsites.dev' },
    });
    const acao = res.headers()['access-control-allow-origin'];
    expect(acao).toBe('https://editor.projectsites.dev');
  });

  test('CORS allows localhost:5173 origin', async ({ request }) => {
    const res = await request.get('/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    const acao = res.headers()['access-control-allow-origin'];
    expect(acao).toBe('http://localhost:5173');
  });

  test('CORS allows subdomain origins', async ({ request }) => {
    const res = await request.get('/health', {
      headers: { Origin: 'https://my-business.projectsites.dev' },
    });
    const acao = res.headers()['access-control-allow-origin'];
    expect(acao).toBe('https://my-business.projectsites.dev');
  });

  test('CORS includes credentials header', async ({ request }) => {
    const res = await request.get('/health', {
      headers: { Origin: 'https://projectsites.dev' },
    });
    expect(res.headers()['access-control-allow-credentials']).toBe('true');
  });

  test('OPTIONS preflight returns 204', async ({ request }) => {
    const res = await request.fetch('/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://projectsites.dev',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status()).toBe(204);
  });
});

test.describe('Request Tracing', () => {
  test('all responses include x-request-id', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['x-request-id']).toBeDefined();
    expect(res.headers()['x-request-id'].length).toBeGreaterThan(0);
  });

  test('x-request-id is a UUID format', async ({ request }) => {
    const res = await request.get('/health');
    const id = res.headers()['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$|^e2e-/);
  });

  test('custom x-request-id is propagated', async ({ request }) => {
    const customId = `test-${Date.now()}`;
    const res = await request.get('/health', {
      headers: { 'x-request-id': customId },
    });
    expect(res.headers()['x-request-id']).toBe(customId);
  });
});

test.describe('Payload Limits', () => {
  test('rejects payloads over 256KB', async ({ request }) => {
    const largeBody = 'x'.repeat(300_000);
    const res = await request.post('/api/auth/magic-link', {
      data: largeBody,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(largeBody.length),
      },
    });
    expect([400, 413]).toContain(res.status());
  });

  test('accepts normal-sized payloads', async ({ request }) => {
    const normalBody = JSON.stringify({ email: 'test@example.com' });
    const res = await request.post('/api/auth/magic-link', {
      data: normalBody,
      headers: { 'Content-Type': 'application/json' },
    });
    // Should not be 413
    expect(res.status()).not.toBe(413);
  });
});
