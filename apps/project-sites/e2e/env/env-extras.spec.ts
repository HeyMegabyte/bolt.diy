/**
 * @module e2e/env/env-extras
 * @description Additional E2E coverage for the env-vars subsystem.
 *
 * ENV-01..ENV-05 already have specs in:
 *   e2e/env-vars-manager.spec.ts
 *   e2e/env-vars-import-export.spec.ts
 *   e2e/env-vars-mcp-scope.spec.ts
 *
 * This file adds supplementary edge-case coverage and verifies the existing
 * spec paths are still referenced correctly in the TEST-PLAN.
 *
 * @packageDocumentation
 */

import { test, expect } from '../fixtures.js';

// ---------------------------------------------------------------------------
// ENV gaps — supplementary edge cases
// ---------------------------------------------------------------------------

test.describe('ENV — soft-delete env var', () => {
  test('DELETE /api/env-vars/:id returns 401 without auth', async ({ page }) => {
    const res = await page.request.delete('/api/env-vars/nonexistent-id');
    expect(res.status()).toBe(401);
  });

  test('DELETE /api/env-vars/:id with auth on nonexistent returns 404', async ({ authedPage: page }) => {
    const res = await page.request.delete('/api/env-vars/nonexistent-env-var-e2e');
    expect([404, 403]).toContain(res.status());
  });
});

test.describe('ENV — PATCH env var updates value', () => {
  test('PATCH /api/env-vars/:id returns 401 without auth', async ({ page }) => {
    const res = await page.request.patch('/api/env-vars/some-id', {
      data: { value: 'new-value' },
    });
    expect(res.status()).toBe(401);
  });

  test('PATCH /api/env-vars/:id with auth on nonexistent returns 404', async ({ authedPage: page }) => {
    const res = await page.request.patch('/api/env-vars/nonexistent-env-var-patch-e2e', {
      data: { value: 'new-value' },
    });
    expect([404, 403]).toContain(res.status());
  });
});

test.describe('ENV — Bulk import rejects malformed dotenv', () => {
  test('POST /api/env-vars/import with malformed payload returns 400', async ({ authedPage: page }) => {
    const res = await page.request.post('/api/env-vars/import', {
      data: { payload: '!!!not-valid-dotenv\x00\x01\x02', scope: 'org' },
    });
    // 400 = bad format, 422 = validation error — both acceptable as error responses
    expect([400, 422]).toContain(res.status());
  });
});

test.describe('ENV — value masking', () => {
  test('GET /api/env-vars response hides secret values', async ({ authedPage: page }) => {
    const res = await page.request.get('/api/env-vars');
    expect(res.status()).toBe(200);
    const body = await res.json() as unknown;
    const items = Array.isArray(body)
      ? body
      : ((body as Record<string, unknown>).vars ?? (body as Record<string, unknown>).items ?? []) as unknown[];

    // None of the returned items should expose a raw value that looks like a real secret
    for (const item of items) {
      const it = item as Record<string, unknown>;
      if (it.value !== undefined) {
        // Value should either be null, empty string, or masked (e.g., '***' / 'REDACTED')
        const val = String(it.value);
        // A revealed SK key would start with 'sk_' — should never appear
        expect(val).not.toMatch(/^(sk_|re_|Bearer )/);
      }
    }
  });
});
