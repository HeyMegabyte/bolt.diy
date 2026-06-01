/**
 * @module e2e/editor-proxy
 *
 * Smoke/verification test for the round-145 worker fix (the editor-crash P1).
 *
 * ROOT CAUSE (round 144): the worker's `editor.projectsites.dev → bolt-diy Pages`
 * proxy was a LATE fallback running after the `/api/*` route mounts, so
 * `editor.projectsites.dev/api/*` was pre-empted by the worker's own
 * projectsites.dev /api routing and returned the worker's `{"error":"not_found"}`
 * 404 — which crashed the bolt editor's `/api/models` fetch (undefined.length).
 *
 * FIX (round 145): hoisted the BOLT_BASE host-proxy to early middleware so every
 * editor.projectsites.dev/* path (incl /api/*) proxies to Pages.
 *
 * This test is `fixme` because the fix is a WORKER change committed but NOT yet
 * deployed (Docker is required for the SiteBuilderContainer build + was
 * unavailable). UN-FIXME it after the next `wrangler deploy --env production`
 * from a Docker-capable env — it then verifies editor /api/* proxies to Pages
 * instead of returning the worker's 404 envelope.
 */
import { test, expect } from '@playwright/test';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

test.describe('editor.projectsites.dev — worker proxy (round-145 fix)', () => {
  // Pending the round-145 worker deploy (Docker-blocked). Un-fixme after deploy.
  test.fixme('editor /api/* proxies to bolt Pages, not the worker 404 envelope', async ({ request }) => {
    const res = await request.get('https://editor.projectsites.dev/api/models', {
      headers: { 'User-Agent': UA },
    });
    const body = await res.text();
    // The worker's own not-found envelope means the proxy was pre-empted by the
    // worker's /api routing (the bug). Post-fix the request reaches bolt Pages.
    expect(body.trim(), 'editor /api/models must proxy to bolt Pages, not return the worker 404 envelope').not.toBe(
      '{"error":"not_found"}',
    );
  });

  // Sanity (always runs): non-/api editor paths already proxy to Pages today
  // (this worked before the fix too — proves the proxy itself is healthy).
  test('editor root proxies to bolt Pages (HTML)', async ({ request }) => {
    const res = await request.get('https://editor.projectsites.dev/', { headers: { 'User-Agent': UA } });
    expect(res.status()).toBe(200);
    expect((res.headers()['content-type'] ?? '')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<!DOCTYPE html>');
  });
});
