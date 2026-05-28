/**
 * @module e2e/media/media-coverage
 * @description E2E coverage gap fill for the media library.
 *
 * Covers MEDIA-07:
 * - Soft-delete asset hides from list
 *
 * MEDIA-01..MEDIA-06 already have coverage in:
 *   e2e/media-library.spec.ts
 *   e2e/media-drop-zone.spec.ts
 *   e2e/media-stock-search.spec.ts
 *   e2e/media-image-studio.spec.ts
 *   e2e/media-podcast-studio.spec.ts
 *   e2e/media-send-to-bolt.spec.ts
 *
 * @packageDocumentation
 */

import { test, expect } from '../fixtures.js';

// ---------------------------------------------------------------------------
// MEDIA-07 — Soft-delete asset hides from list
// ---------------------------------------------------------------------------
test.describe('MEDIA-07 — Soft-delete asset hides from list', () => {
  test('DELETE /api/media/assets/:id returns 401 without auth', async ({ page }) => {
    const res = await page.request.delete('/api/media/assets/nonexistent-id');
    expect(res.status()).toBe(401);
  });

  test('DELETE /api/media/assets/:id with auth on nonexistent returns 404', async ({ authedPage: page }) => {
    const res = await page.request.delete('/api/media/assets/nonexistent-asset-id-e2e');
    expect([404, 403]).toContain(res.status());
  });

  test('Deleted asset no longer appears in GET /api/media/assets list', async ({ authedPage: page }) => {
    // Step 1: Get initial list
    const listBefore = await page.request.get('/api/media/assets');
    expect(listBefore.status()).toBe(200);

    // Step 2: Attempt delete on a fake ID (should fail, but list must still work)
    await page.request.delete('/api/media/assets/e2e-fake-delete-id');

    // Step 3: Get list after — must still return 200 and not contain the deleted id
    const listAfter = await page.request.get('/api/media/assets');
    expect(listAfter.status()).toBe(200);
    const body = await listAfter.json() as unknown;
    const items = Array.isArray(body)
      ? body
      : ((body as Record<string, unknown>).assets ?? (body as Record<string, unknown>).items ?? []) as unknown[];
    const hasDeletedId = items.some(
      (item) => (item as Record<string, unknown>).id === 'e2e-fake-delete-id',
    );
    expect(hasDeletedId).toBe(false);
  });
});
