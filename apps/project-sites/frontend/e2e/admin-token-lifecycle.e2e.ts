import { test, expect, type Page } from '@playwright/test';

/**
 * API-token WRITE lifecycle — the create → read → revoke path against PROD.
 *
 * WHY THIS EXISTS: `flows-team-tokens.flow.e2e.ts` deliberately never submits the
 * create dialog ("No real API tokens are created") — so the actual WRITE path had
 * NO end-to-end guard. That write path was 404-DEAD for every org for a long time
 * (an un-flag migration left an orphan `public_api` gate on `api_tokens_admin.ts`,
 * fixed 2026-08-16) and the gap was invisible because only the READ was ever tested.
 * A read-only check can't catch a broken write — this spec closes that.
 *
 * It creates a real disposable token and IMMEDIATELY revokes it (self-cleaning), so
 * it leaves only a soft-deleted row on the E2E org — safe, disposable test data.
 *
 * All mutations run via `page.evaluate(fetch + Bearer)` from inside the loaded admin
 * page: the browser context clears Cloudflare's bot-challenge that 403s raw
 * (curl/headless) POST/DELETE calls — the same reason the admin UI's own fetches work.
 */

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch {
      /* private mode */
    }
  }, KEY);
}

test.describe('admin — API-token write lifecycle (create → read → revoke)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('create → list(present, no secret leak) → revoke → list(gone) → double-revoke 404', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await seed(page);
    // Load the admin surface so the context clears the CF bot-challenge.
    await page.goto('/admin/settings', { waitUntil: 'load' });
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 30_000 });

    const name = `loop-lifecycle-${Date.now()}`;
    const r = await page.evaluate(
      async ({ key, tokenName }) => {
        const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
        const out: Record<string, unknown> = {};
        // CREATE
        const cRes = await fetch('/api/v1-tokens', {
          method: 'POST',
          headers: H,
          body: JSON.stringify({ name: tokenName, scopes: ['sites:read'] }),
        });
        out.createStatus = cRes.status;
        const cBody = await cRes.json().catch(() => ({}));
        out.plaintextPrefix = (cBody.plaintext || '').slice(0, 4);
        out.hasWarning = !!cBody.warning;
        const id = cBody.token?.id ?? null;
        out.id = id;
        // READ — present + no secret leak in the list projection
        const l1 = await (await fetch('/api/v1-tokens', { headers: H })).json();
        const mine = (l1.data || []).filter((t: { name: string }) => t.name === tokenName);
        out.present = mine.length === 1;
        out.leaksSecret = mine[0]
          ? ['token_hash', 'plaintext', 'token'].some((k) => k in mine[0])
          : false;
        // REVOKE
        if (id) out.revokeStatus = (await fetch(`/api/v1-tokens/${id}`, { method: 'DELETE', headers: H })).status;
        // READ — gone
        const l2 = await (await fetch('/api/v1-tokens', { headers: H })).json();
        out.goneAfterRevoke = !(l2.data || []).some((t: { name: string }) => t.name === tokenName);
        // IDEMPOTENT double-revoke → 404 (never 200/500)
        if (id) out.doubleRevokeStatus = (await fetch(`/api/v1-tokens/${id}`, { method: 'DELETE', headers: H })).status;
        return out;
      },
      { key: KEY, tokenName: name },
    );

    expect(r.createStatus, 'POST create returns 201 (write path alive — not the old 404)').toBe(201);
    expect(r.plaintextPrefix, 'a psk_ plaintext is minted once').toBe('psk_');
    expect(r.hasWarning, 'copy-once warning present').toBe(true);
    expect(r.present, 'created token appears in the list (read reconciles the write)').toBe(true);
    expect(r.leaksSecret, 'the list projection NEVER leaks token_hash/plaintext').toBe(false);
    expect(r.revokeStatus, 'revoke returns 200').toBe(200);
    expect(r.goneAfterRevoke, 'revoked token disappears from the list').toBe(true);
    expect(r.doubleRevokeStatus, 'double-revoke is idempotent (404, not 200/500)').toBe(404);
  });
});
