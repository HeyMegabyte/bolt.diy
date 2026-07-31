/**
 * @fortress UNIFIED_INBOX — adversarial evidence  (flag `unified_inbox`)
 *
 * ── Surface reality (grepped + probed 2026-07-31) ───────────────────────────
 * The gated API family is `/api/inbox/conversations*` (src/routes/inbox.ts). The
 * old adversarial spec targeted `/api/inbox/tasks/:id/{resolve,assign,draft}` —
 * those are the DIFFERENT Task-Tray endpoints, and they no longer exist in that
 * shape, so every probe missed the real surface.
 *
 * ── Live-prod behaviour observed for the REAL endpoints ─────────────────────
 *  - GET  /api/inbox/conversations              → 200 (flag currently ON) OR 404 dark
 *  - GET  /api/inbox/conversations/<bogus-id>   → 404 (org-scoped non-leak)
 *  - GET  /api/inbox/<unknown>                  → 404 {code:"NOT_FOUND"} (clean JSON)
 *  - POST /api/inbox/conversations/<id>/reply   → **403 Cloudflare Bot Fight Mode**
 *    interstitial ("Just a moment…") — inbound M2M POSTs from a non-browser TLS
 *    fingerprint are challenged at the edge BEFORE the Worker runs
 *    (see MEMORY [[bot-fight-mode-blocks-inbound-webhooks]]). This is expected
 *    and is itself a hardening signal: hostile POSTs never reach app logic.
 *
 * ── Break-it angles (all assert: clean rejection, NEVER 500 / stack-trace / HTML app-shell) ─
 *  IB-ADV-01  list without auth                     → 200|404 (never 500), JSON, no stack trace
 *  IB-ADV-02  XSS-shaped id in the path (GET detail) → 404, no reflected <script>, no 500
 *  IB-ADV-03  SQLi-shaped id in the path (GET detail)→ 404, no SQL echo, no 500
 *  IB-ADV-04  oversized query string on the list     → clean status (2xx|4xx), never 500
 *  IB-ADV-05  injection-shaped POST /reply body       → rejected upstream (BFM 403) OR by the
 *             handler (401|404|400) — the invariant is NO 500 and NO stack trace / SQL leak,
 *             whether the edge or the app does the rejecting.
 *  IB-ADV-06  oversized (~200KB) POST /reply body      → 403|413|401|404|400, never 500
 *
 * Bounded per-attempt timeout via resilientGet/resilientPost (12s, 3 tries). No
 * networkidle, no arbitrary sleeps. Mutations are safe-to-resend probes only
 * (auth/edge-gate checks) per resilientPost's re-send contract.
 */
import { test, expect } from '../../fixtures.js';
import { resilientGet, resilientPost } from '../../helpers/api-request.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

/** Body text must never leak an internal stack trace / SQL / raw error surface. */
function assertNoServerLeak(bodyText: string, label: string): void {
  const lc = bodyText.toLowerCase();
  expect(lc, `${label}: no stack trace leaked`).not.toContain('    at ');
  expect(lc, `${label}: no SQL leaked`).not.toContain('sqlite_');
  expect(lc, `${label}: no D1/SQL error leaked`).not.toContain('d1_error');
  expect(lc, `${label}: no unhandled-rejection dump`).not.toContain('unhandledrejection');
}

test.describe('UNIFIED_INBOX ADV — gated endpoints reject cleanly, never 500', () => {
  test('IB-ADV-01 GET list without auth returns a clean contract (never 500)', async ({ request }) => {
    const res = await resilientGet(request, `${BASE}/api/inbox/conversations`, { timeout: 15_000 });
    expect([200, 401, 404], `unexpected ${res.status()}`).toContain(res.status());
    expect(res.status(), 'must never 500').not.toBe(500);
    assertNoServerLeak(await res.text(), 'list no-auth');
  });

  test('IB-ADV-02 XSS-shaped conversation id in the path is inert (404, no reflection, no 500)', async ({
    request,
  }) => {
    const xssId = encodeURIComponent('<script>window.__IB_XSS__=1</script>');
    const res = await resilientGet(request, `${BASE}/api/inbox/conversations/${xssId}`, {
      timeout: 15_000,
    });
    expect(res.status(), 'XSS id must not 500').not.toBe(500);
    expect([400, 404], `unexpected ${res.status()}`).toContain(res.status());
    const body = await res.text();
    // The raw <script> must never be reflected back verbatim into a response.
    expect(body, 'no reflected <script>').not.toContain('<script>window.__IB_XSS__');
    assertNoServerLeak(body, 'xss id');
  });

  test('IB-ADV-03 SQLi-shaped conversation id in the path is inert (404, no SQL echo, no 500)', async ({
    request,
  }) => {
    const sqlId = encodeURIComponent("1' OR '1'='1'; DROP TABLE conversations; --");
    const res = await resilientGet(request, `${BASE}/api/inbox/conversations/${sqlId}`, {
      timeout: 15_000,
    });
    expect(res.status(), 'SQLi id must not 500').not.toBe(500);
    expect([400, 404], `unexpected ${res.status()}`).toContain(res.status());
    assertNoServerLeak(await res.text(), 'sqli id');
  });

  test('IB-ADV-04 oversized query string on the list is tolerated (clean status, never 500)', async ({
    request,
  }) => {
    const huge = 'x'.repeat(6_000);
    const res = await resilientGet(
      request,
      `${BASE}/api/inbox/conversations?status=${huge}&channel=${huge}`,
      { timeout: 15_000 },
    );
    // Edge may 414 (URI too long) or the handler may 200/404 — anything but 500.
    expect(res.status(), 'oversized query must not 500').not.toBe(500);
    expect([200, 400, 404, 414], `unexpected ${res.status()}`).toContain(res.status());
  });

  test('IB-ADV-05 injection-shaped POST /reply body is rejected cleanly (edge BFM or handler), never 500', async ({
    request,
  }) => {
    // POST reply requires auth + a real conversation. From a non-browser client
    // Cloudflare Bot Fight Mode challenges the request at the edge (403) before
    // the Worker runs; if it did run it would 401 (no bearer) or 404 (org). Any
    // of those is a CLEAN rejection. The invariant is: no 500, no leak.
    const res = await resilientPost(
      request,
      `${BASE}/api/inbox/conversations/00000000-0000-0000-0000-000000000000/reply`,
      {
        data: { body: "<img src=x onerror=alert(1)>'; DROP TABLE inbox_messages; --" },
        headers: { 'Content-Type': 'application/json' },
        timeout: 15_000,
      },
    );
    expect(res.status(), 'injection POST must not 500').not.toBe(500);
    expect([400, 401, 403, 404], `unexpected ${res.status()}`).toContain(res.status());
    assertNoServerLeak(await res.text(), 'injection reply');
  });

  test('IB-ADV-06 oversized POST /reply body is rejected cleanly, never 500', async ({ request }) => {
    // ~200KB body — well over the 256KB global payload limit boundary region and
    // the Zod max(10000) on `body`. Whichever gate fires (edge BFM 403, 413
    // payload-too-large, 401 auth, or 404 org), it must be clean.
    const res = await resilientPost(
      request,
      `${BASE}/api/inbox/conversations/00000000-0000-0000-0000-000000000000/reply`,
      {
        data: { body: 'A'.repeat(200_000) },
        headers: { 'Content-Type': 'application/json' },
        timeout: 15_000,
      },
    );
    expect(res.status(), 'oversized POST must not 500').not.toBe(500);
    expect([400, 401, 403, 404, 413], `unexpected ${res.status()}`).toContain(res.status());
    assertNoServerLeak(await res.text(), 'oversized reply');
  });
});
