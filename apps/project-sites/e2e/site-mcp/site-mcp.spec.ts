import { test, expect } from '@playwright/test';
import { signInAsTestUser } from '../helpers/auth.js';
import { checkA11y } from '../helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

/**
 * e2e/site-mcp — Per-site MCP server (flag `site_mcp_server`, FLAG_DOCS evidence spec).
 *
 * SURFACE REALITY (grepped 2026-07-31):
 * - UI: `/admin/sites/:id/mcp-server` → SiteMcpServerComponent
 *   (frontend/src/app/pages/admin/sections/site-mcp-server.component.ts). All legacy
 *   testids are STILL LIVE: `site-mcp-server`(:63) `tokens-table`(:160)
 *   `test-tool-btn`(:234), plus `new-token-label` `mint-token-btn` `new-token-banner`
 *   `token-row-{id}` `revoke-token-btn` `tool-row-{name}` `tool-playground`
 *   `playground-args` `playground-run-btn` `playground-result`.
 * - Worker: src/routes/mcp_site.ts — admin family GET/POST `/api/sites/:siteId/mcp/tokens`,
 *   DELETE `/api/sites/:siteId/mcp/tokens/:tokenId`, GET `.../mcp/tools` + `.../mcp/tool-usage`
 *   (auth-gated via `unauthorized()`; NOT isFlagOn-gated), public JSON-RPC POST `/:slug/mcp`
 *   + discovery GET `/:slug/.well-known/mcp`.
 * - Component quirks the stubs must honor: token GET shape `{tokens:[]}` is
 *   Array.isArray-guarded (shapeless 200 → error card, never fake-empty); mint POST
 *   returns `{id, token}` then refetches the list; empty label auto-names
 *   `Token ${tokens.length+1}`; revoke + mutating-tool playground runs go through
 *   ConfirmService (`confirm-accept` / `confirm-cancel`); playground posts JSON-RPC
 *   `tools/call` to `/{slug}/mcp` via raw HttpClient (not /api).
 *
 * WHY YESTERDAY'S 5 FAILED (inferred from markup/route reality — nothing was run):
 * 1. `POST /demo/mcp initialize` + `tools/call auth gate` asserted `[200,404]` —
 *    unauthed datacenter POSTs to `/{slug}/mcp` sit OUTSIDE the WAF skip rule
 *    (skips cover `/api/mcp` + `/oauth/*` only) → an edge challenge 403 breaks the
 *    two-value set; the `demo` slug's existence is also env-dependent.
 * 2-4. Token-mgmt trio asserted EXACT `.toBe(401)` — unauth POST/DELETE from CI IPs
 *    can be edge-challenged (403) instead of reaching the worker's 401; exact-401
 *    is brittle → modernized to a not-authenticated contract ([401,403], never 2xx).
 * 5. `Homepage loads without console errors` used `waitForLoadState('networkidle')`
 *    (banned) — PostHog/GA keepalives prevent settle → timeout flake.
 * The pass-9-revived admin-UI test's selectors were verified against the live
 * component and are kept + extended below.
 */

interface StubMcpToken {
  id: string;
  label: string;
  last_used: string | null;
  created_at: string;
}

const INJECTION_LABEL = '<img src=x onerror=window.__pwned=1>bot';
const RAW_TOKEN = 'mcp_tok_e2e_reveal_001';

test.describe('Site MCP Server — discovery + unauth API contract', () => {
  test('well-known discovery: nonexistent slug is a hard 404, root never 5xx', async ({ request }) => {
    const missing = await request.get(
      `${PROD_URL}/totally-nonexistent-slug-e2e/.well-known/mcp`,
    );
    expect(missing.status()).toBe(404);

    // Marketing-root capability doc — contract is "never a worker crash".
    const root = await request.get(`${PROD_URL}/.well-known/mcp`);
    expect(root.status()).toBeLessThan(500);
  });

  test('token management endpoints reject unauthenticated callers', async ({ request }) => {
    // Worker gate is 401 (`unauthorized()` in mcp_site.ts); 403 is the edge
    // challenge for unauth datacenter traffic. Either way: NEVER 2xx, NEVER 5xx.
    const list = await request.get(`${PROD_URL}/api/sites/e2e-nope/mcp/tokens`);
    expect([401, 403]).toContain(list.status());
    if (list.status() === 401) {
      const body = (await list.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe('UNAUTHORIZED');
    }

    // Valid body so zValidator (which runs BEFORE the auth gate) passes and the
    // response exercises the auth contract, not the 400 validation path.
    const mint = await request.post(`${PROD_URL}/api/sites/e2e-nope/mcp/tokens`, {
      data: { label: 'e2e' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(mint.status());

    const revoke = await request.delete(
      `${PROD_URL}/api/sites/e2e-nope/mcp/tokens/tok-e2e`,
    );
    expect([401, 403]).toContain(revoke.status());
  });
});

test.describe('Site MCP Server — admin UI (stub-authed journey)', () => {
  test('tokens table, mint value-domains, revoke confirm, tool playground', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // 1) Auth FIRST — helper registers its benign catch-alls before our stubs,
    // so ours (registered after) match first.
    await signInAsTestUser(page);

    // 2) Mutation guard — any POST/PATCH/PUT/DELETE not claimed below is
    // intercepted here, never reaching real prod.
    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    // 3) Section stubs (registered LAST → matched FIRST). Mutable token state so
    // mint round-trips through the component's list refetch.
    // glob-ok: exact leaf — loadSiteSlug() GETs /api/sites/e2e-site-001 with no
    // query; deeper /mcp/* paths are claimed by their own routes below.
    await page.route('**/api/sites/e2e-site-001', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { id: 'e2e-site-001', slug: 'e2e-test-site', name: 'E2E Test Site' },
        }),
      }),
    );

    const tokens: StubMcpToken[] = [
      { id: 'tok-1', label: 'Zapier Bridge', last_used: null, created_at: '2026-07-01T00:00:00.000Z' },
    ];
    const mintedLabels: string[] = [];
    let mintSeq = 0;

    // glob-ok: query-suffix only — bare tokens leaf (GET list + POST mint); the
    // /:tokenId subresource is claimed by the '/**' twin below (mid-token **
    // cannot cross '/').
    await page.route('**/api/sites/e2e-site-001/mcp/tokens**', (route) => {
      const m = route.request().method();
      if (m === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ tokens }),
        });
      }
      if (m === 'POST') {
        const body = (route.request().postDataJSON() ?? {}) as { label?: string };
        const label = body.label ?? '';
        mintedLabels.push(label);
        mintSeq += 1;
        tokens.push({
          id: `tok-new-${mintSeq}`,
          label,
          last_used: null,
          created_at: '2026-07-31T00:00:00.000Z',
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: `tok-new-${mintSeq}`, token: RAW_TOKEN }),
        });
      }
      return route.fallback();
    });

    // Glob-law twin: DELETE /mcp/tokens/:tokenId lives one segment deeper —
    // the leaf glob above can never match it.
    const revokedIds: string[] = [];
    await page.route('**/api/sites/e2e-site-001/mcp/tokens/**', (route) => {
      if (route.request().method() === 'DELETE') {
        const id = route.request().url().split('?')[0].split('/').pop() ?? '';
        revokedIds.push(id);
        const idx = tokens.findIndex((t) => t.id === id);
        if (idx >= 0) tokens.splice(idx, 1);
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    // glob-ok: query-suffix only — 'tools**' cannot match the sibling
    // /mcp/tool-usage leaf (literal 'tools' vs 'tool-').
    await page.route('**/api/sites/e2e-site-001/mcp/tools**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tools: [
            { name: 'list_pages', description: 'List all site pages', requiresAuth: false },
            { name: 'update_page', description: 'Update page content', requiresAuth: true },
            { name: 'get_analytics_summary', description: 'Traffic summary', requiresAuth: false },
          ],
        }),
      }),
    );

    const today = new Date().toISOString().slice(0, 10);
    // glob-ok: query-suffix only — flat leaf, no subresources.
    await page.route('**/api/sites/e2e-site-001/mcp/tool-usage**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          usage: [
            { tool_name: 'list_pages', day: today, call_count: 7, error_count: 0 },
            { tool_name: 'update_page', day: today, call_count: 5, error_count: 1 },
          ],
        }),
      }),
    );

    // Public JSON-RPC playground endpoint — NOT under /api (raw HttpClient in the
    // component posts to `/{slug}/mcp`), so the /api mutation guard cannot claim it.
    const rpcCalls: Array<{ method?: string; params?: { name?: string } }> = [];
    await page.route('**/e2e-test-site/mcp', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = (route.request().postDataJSON() ?? {}) as {
        method?: string;
        params?: { name?: string };
      };
      rpcCalls.push(body);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: 'Found 3 pages' }] },
        }),
      });
    });

    await page.goto(`${PROD_URL}/admin/sites/e2e-site-001/mcp-server`, {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    expect(page.url()).not.toContain('/signin');
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    // ── Step 1: section renders from stubbed data ──
    const section = page.getByTestId('site-mcp-server');
    await expect(section).toBeVisible({ timeout: 20_000 });
    // Slug-derived endpoint line proves the /api/sites/:id stub drove the render.
    await expect(section.getByText('https://e2e-test-site.projectsites.dev/mcp')).toBeVisible({ timeout: 10_000 });
    // Calls-today pill counts today's stubbed usage (7+5) — never the "—" unknown state.
    await expect(section.getByText(/\d+ calls today/)).toBeVisible({ timeout: 10_000 });
    await expect(section.getByText('Tools')).toBeVisible();
    await expect(section.getByText('Tokens')).toBeVisible();

    const table = page.getByTestId('tokens-table');
    await expect(table).toBeVisible({ timeout: 10_000 });
    await expect(table.getByText('Zapier Bridge')).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(1);

    // Per-tool 30d counts are plain interpolation — deterministic hard asserts.
    await expect(page.getByTestId('tool-row-list_pages')).toBeVisible();
    await expect(page.getByTestId('tool-row-list_pages').getByText('7 calls (30d)')).toBeVisible();
    await expect(page.getByTestId('tool-row-update_page').getByText('auth required')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/site-mcp/01-section.png', fullPage: true });

    // ── Step 2: value domain OVERLONG — maxlength=48 clamps typed input ──
    const labelInput = page.getByTestId('new-token-label');
    await expect(labelInput).toHaveAttribute('maxlength', '48');
    await labelInput.pressSequentially('L'.repeat(60), { timeout: 15_000 });
    expect((await labelInput.inputValue()).length).toBe(48);
    await labelInput.fill('');

    // ── Step 3: value domain VALID → one-time reveal banner ──
    await labelInput.fill('Cursor CLI');
    await page.getByTestId('mint-token-btn').click();
    const banner = page.getByTestId('new-token-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner.getByText(RAW_TOKEN)).toBeVisible();
    await expect(banner.getByText(/Copy this token now/)).toBeVisible();
    // Shown exactly once in the DOM.
    await expect(page.getByText(RAW_TOKEN)).toHaveCount(1);
    expect(mintedLabels).toEqual(['Cursor CLI']);
    await expect(table.getByText('Cursor CLI')).toBeVisible({ timeout: 10_000 }); // refetched list
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await page.screenshot({ path: 'e2e/screenshots/site-mcp/02-mint-reveal.png', fullPage: true });
    await banner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toBeHidden({ timeout: 5_000 });
    await expect(page.getByText(RAW_TOKEN)).toHaveCount(0);

    // ── Step 4: value domain EMPTY — component auto-labels `Token N` ──
    await labelInput.fill('');
    await page.getByTestId('mint-token-btn').click();
    await expect(page.getByTestId('new-token-banner')).toBeVisible({ timeout: 10_000 });
    // List had 2 rows at mint time → auto-label is Token 3 (tokens.length + 1).
    expect(mintedLabels[1]).toBe('Token 3');
    await expect(table.getByText('Token 3')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('new-token-banner').getByRole('button', { name: 'Dismiss' }).click();

    // ── Step 5: value domain INJECTION-SHAPED — literal text, never markup ──
    await labelInput.fill(INJECTION_LABEL);
    await page.getByTestId('mint-token-btn').click();
    await expect(page.getByTestId('new-token-banner')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('new-token-banner').getByRole('button', { name: 'Dismiss' }).click();
    await expect(table.getByText(INJECTION_LABEL)).toBeVisible({ timeout: 10_000 });
    await expect(table.locator('img')).toHaveCount(0); // interpolation, not innerHTML
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
    await expect(table.locator('tbody tr')).toHaveCount(4);
    await page.screenshot({ path: 'e2e/screenshots/site-mcp/03-value-domains.png', fullPage: true });

    // ── Step 6: revoke — danger confirm, DELETE intercepted, row removed ──
    await page.getByTestId('token-row-tok-1').getByTestId('revoke-token-btn').click();
    await expect(page.getByTestId('confirm-message')).toContainText('Revoke this MCP access token', { timeout: 10_000 });
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByTestId('token-row-tok-1')).toBeHidden({ timeout: 10_000 });
    expect(revokedIds).toEqual(['tok-1']);
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await page.screenshot({ path: 'e2e/screenshots/site-mcp/04-revoked.png', fullPage: true });

    // ── Step 7: playground — invalid-JSON value domain fires NO request ──
    await page.getByTestId('tool-row-list_pages').getByTestId('test-tool-btn').click();
    const playground = page.getByTestId('tool-playground');
    await expect(playground).toBeVisible({ timeout: 10_000 });
    await expect(playground.getByText('list_pages')).toBeVisible();
    await page.getByTestId('playground-args').fill('{nope');
    await page.getByTestId('playground-run-btn').click();
    await expect(page.getByText('Invalid JSON arguments')).toBeVisible({ timeout: 10_000 });
    expect(rpcCalls).toHaveLength(0);

    // ── Step 8: playground valid run — JSON-RPC tools/call intercepted + asserted ──
    await page.getByTestId('playground-args').fill('{}');
    await page.getByTestId('playground-run-btn').click();
    await expect(page.getByTestId('playground-result')).toContainText('Found 3 pages', { timeout: 10_000 });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.method).toBe('tools/call');
    expect(rpcCalls[0]?.params?.name).toBe('list_pages');
    await page.screenshot({ path: 'e2e/screenshots/site-mcp/05-playground.png', fullPage: true });

    // ── Step 9: mutating tool run requires the danger confirm before firing ──
    await page.getByTestId('tool-row-update_page').getByTestId('test-tool-btn').click();
    await expect(playground.getByText('update_page')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('playground-run-btn').click();
    await expect(page.getByTestId('confirm-message')).toContainText('modify live site content', { timeout: 10_000 });
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByTestId('playground-result')).toBeVisible({ timeout: 10_000 });
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[1]?.params?.name).toBe('update_page');
    await page.screenshot({ path: 'e2e/screenshots/site-mcp/06-mutating-confirm.png', fullPage: true });

    await checkA11y(page, 'site-mcp-server');

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: 'e2e/screenshots/site-mcp/07-mobile.png', fullPage: true });

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED_BY_CLIENT') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('dark worker state shows calm error cards, never fake-empty or crash', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await signInAsTestUser(page);

    const dark = {
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'NOT_FOUND', message: 'Not found', request_id: 'req-e2e-dark' },
      }),
    };
    // glob-ok: query-suffix leaves — every /mcp/* feed is dark for this test.
    await page.route('**/api/sites/e2e-site-001/mcp/tokens**', (route) => route.fulfill(dark));
    await page.route('**/api/sites/e2e-site-001/mcp/tools**', (route) => route.fulfill(dark));
    await page.route('**/api/sites/e2e-site-001/mcp/tool-usage**', (route) => route.fulfill(dark));

    await page.goto(`${PROD_URL}/admin/sites/e2e-site-001/mcp-server`, {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });

    const section = page.getByTestId('site-mcp-server');
    await expect(section).toBeVisible({ timeout: 20_000 });
    // Calm typed error cards — the component's Array.isArray shape-guards mean a
    // dark 404 NEVER renders as a confident "no tokens/tools" fake-empty.
    await expect(section.getByText(/Couldn.t load tokens/)).toBeVisible({ timeout: 15_000 });
    await expect(section.getByText(/Couldn.t load tools/)).toBeVisible({ timeout: 15_000 });
    // Calls-today pill degrades to the explicit unknown state, not a lying "0".
    await expect(section.getByLabel(/Calls today: unknown/)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'e2e/screenshots/site-mcp/08-dark-state.png', fullPage: true });

    expect(pageErrors).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/sites/e2e-site-001/mcp-server`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form').first(),
    ).toBeVisible();
  });
});
