import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

/**
 * /admin/api-tokens — Public API v1 token management journey.
 *
 * Contract: signInAsTestUser FIRST (helper catch-alls match LAST); the mutation
 * guard + section stubs below are registered AFTER it so they match FIRST.
 * Unstubbed GETs land in the helper catch-all; ALL POST/PATCH/PUT/DELETE are
 * intercepted (guard) or claimed by the /v1-tokens handlers.
 *
 * Backend (api-tokens.component.ts): GET/POST /api/v1-tokens (list + create;
 * create returns { token, plaintext, warning } — the ONE-TIME reveal payload)
 * and DELETE /api/v1-tokens/:id (revoke). Reveal auto-hide mechanism (grepped):
 * there is NO hide timer — the dialog hides on dismiss ("Done" button /
 * dialog close) or navigation via clearCreatedToken(); the only setTimeout
 * (2500 ms) reverts the Copy button label after copyToken().
 *
 * Value domains (TDD Contract #10) on the name input: valid / empty /
 * overlong(300) / injection-shaped. Empty = disabled-submit rejection contract
 * (never click a disabled button); overlong = intercepted 400 → inline error
 * toast; injection = rendered as literal text, never markup.
 */

interface StubToken {
  id: string;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

const INJECTION_NAME = '<img src=x onerror=window.__pwned=1>bot';
const PLAINTEXT = 'psk_test_reveal_abc';

test.describe('Admin — API Tokens (authenticated journey)', () => {
  test('list, one-time reveal + auto-hide, name value-domains, revoke', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // Chromium project — allow navigator.clipboard.writeText in copyToken().
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);

    // 1) Auth FIRST — helper registers its benign catch-alls before our stubs.
    await signInAsTestUser(page);

    // 2) Mutation guard — any POST/PATCH/PUT/DELETE not claimed by the
    // /v1-tokens handlers below is intercepted here, never reaching real prod.
    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    // 3) Section stubs — registered LAST so they match FIRST. Mutable state so
    // create/revoke round-trip through the list refetch.
    const tokens: StubToken[] = [
      {
        id: 'tok-prod-001',
        name: 'Production Deploy',
        scopes: ['sites:read', 'sites:write'],
        last_used_at: '2026-07-29T09:00:00Z',
        expires_at: null,
        created_at: '2026-06-01T00:00:00Z',
      },
      {
        id: 'tok-ci-002',
        name: 'CI Read-only',
        scopes: ['sites:read'],
        last_used_at: null,
        expires_at: '2027-01-01T00:00:00Z',
        created_at: '2026-07-01T00:00:00Z',
      },
    ];
    let createSeq = 0;

    // glob-ok: query-suffix only — bare /api/v1-tokens list+create leaf; the
    // /:id subresource is claimed by the '**/api/v1-tokens/**' twin below
    // (mid-token ** cannot cross '/').
    await page.route('**/api/v1-tokens**', (route) => {
      const m = route.request().method();
      if (m === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: tokens }),
        });
      }
      if (m === 'POST') {
        const body = (route.request().postDataJSON() ?? {}) as { name?: string; scopes?: string[]; expires_at?: string | null };
        const name = body.name ?? '';
        // Server-side boundary rejection for the overlong(300) value class.
        if (name.length > 128) {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Token name must be 128 characters or fewer', request_id: 'req-e2e-400' } }),
          });
        }
        createSeq += 1;
        const created: StubToken = {
          id: `tok-new-00${createSeq}`,
          name,
          scopes: body.scopes ?? ['sites:read'],
          last_used_at: null,
          expires_at: body.expires_at ?? null,
          created_at: '2026-07-31T00:00:00Z',
        };
        tokens.push(created);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ token: created, plaintext: PLAINTEXT, warning: 'Store this token securely — it will not be shown again.' }),
        });
      }
      return route.fallback();
    });

    // Glob-law twin: DELETE /api/v1-tokens/:id lives one path segment deeper —
    // '**/api/v1-tokens**' can never match it, so the revoke needs this route.
    await page.route('**/api/v1-tokens/**', (route) => {
      if (route.request().method() === 'DELETE') {
        const id = route.request().url().split('?')[0].split('/').pop() ?? '';
        const idx = tokens.findIndex((t) => t.id === id);
        if (idx >= 0) tokens.splice(idx, 1);
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await page.goto(`${PROD_URL}/admin/api-tokens`, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    expect(page.url()).not.toContain('/signin');
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });

    // ── Step 1: list renders the stubbed tokens with actual cell text ──
    await expect(page.getByRole('heading', { name: 'API Tokens' })).toBeVisible({ timeout: 15_000 });
    const table = page.locator('[data-testid="api-tokens-table"]');
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(table.getByText('Production Deploy')).toBeVisible();
    await expect(table.getByText('CI Read-only')).toBeVisible();
    await expect(table.getByText('sites:write').first()).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await page.screenshot({ path: 'e2e/screenshots/admin-api-tokens-journey/01-list.png', fullPage: true });

    // ── Step 2: value domain EMPTY — submit disabled, never clicked ──
    await page.locator('[data-testid="at-create-open"]').click();
    const nameInput = page.locator('[data-testid="at-name-input"]');
    const submitBtn = page.locator('[data-testid="at-create-submit"]');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await expect(nameInput).toHaveValue('');
    await expect(submitBtn).toBeDisabled();
    await page.screenshot({ path: 'e2e/screenshots/admin-api-tokens-journey/02-empty-disabled.png', fullPage: true });

    // ── Step 3: value domain VALID → ONE-TIME REVEAL micro-feature ──
    await nameInput.fill('CI Deploy Bot');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    const reveal = page.locator('[data-testid="at-token-reveal"]');
    const plaintext = page.locator('[data-testid="at-token-plaintext"]');
    await expect(reveal).toBeVisible({ timeout: 10_000 });
    await expect(plaintext).toHaveText(PLAINTEXT);
    // Shown exactly ONCE — the plaintext exists in one place in the DOM.
    await expect(page.getByText(PLAINTEXT)).toHaveCount(1);
    await expect(page.getByText(/will\s+not\s+be shown again/i).first()).toBeVisible();

    // Copy control exists and works (clipboard granted) — fallback toast is the
    // tolerated alternate path when the clipboard API is unavailable.
    const copyBtn = page.locator('[data-testid="at-copy-btn"]');
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    const copiedShown = await expect(copyBtn).toHaveText(/✓ Copied/, { timeout: 3_000 }).then(() => true).catch(() => false);
    if (copiedShown) {
      // Documented 2500 ms label revert — wait for the REAL timer, tolerant window.
      await expect(copyBtn).toHaveText(/^\s*Copy\s*$/, { timeout: 6_000 });
    } else {
      await expect(page.getByText('Copy failed — select the token text manually')).toBeVisible({ timeout: 3_000 });
    }
    await page.screenshot({ path: 'e2e/screenshots/admin-api-tokens-journey/03-one-time-reveal.png', fullPage: true });

    // AUTO-HIDE: no timer exists — the documented hide is dismiss/navigation.
    // Dismiss via the Done button and assert the plaintext is GONE for good.
    await page.locator('[data-testid="at-reveal-done"]').click();
    await expect(reveal).toBeHidden({ timeout: 5_000 });
    await expect(page.getByText(PLAINTEXT)).toHaveCount(0);
    // List refetched — the new token row shows, but never its plaintext.
    await expect(table.getByText('CI Deploy Bot')).toBeVisible({ timeout: 10_000 });
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await page.screenshot({ path: 'e2e/screenshots/admin-api-tokens-journey/04-after-done-hidden.png', fullPage: true });

    // ── Step 4: value domain OVERLONG(300) — API-boundary 400 → inline error ──
    await page.locator('[data-testid="at-create-open"]').click();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill('A'.repeat(300));
    await expect(submitBtn).toBeEnabled(); // no client cap — boundary rejects
    await submitBtn.click();
    await expect(page.getByText('Failed to create token')).toBeVisible({ timeout: 10_000 });
    await expect(reveal).toHaveCount(0); // 400 → NO reveal dialog
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(nameInput).toBeHidden({ timeout: 5_000 });
    await page.screenshot({ path: 'e2e/screenshots/admin-api-tokens-journey/05-overlong-rejected.png', fullPage: true });

    // ── Step 5: value domain INJECTION-SHAPED — rendered as text, never markup ──
    await page.locator('[data-testid="at-create-open"]').click();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill(INJECTION_NAME);
    await submitBtn.click();
    await expect(reveal).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="at-reveal-done"]').click();
    await expect(reveal).toBeHidden({ timeout: 5_000 });
    await expect(table.getByText(INJECTION_NAME)).toBeVisible({ timeout: 10_000 });
    await expect(table.locator('img')).toHaveCount(0); // interpolation, not innerHTML
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect(table.locator('tbody tr')).toHaveCount(4);
    await page.screenshot({ path: 'e2e/screenshots/admin-api-tokens-journey/06-injection-literal.png', fullPage: true });

    // ── Step 6: revoke flow — DELETE intercepted, row removed ──
    await page.locator('[data-testid="at-revoke-btn"]').first().click();
    await expect(page.getByText('Any integrations using this token will stop working immediately.')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="at-revoke-confirm"]').click();
    await expect(page.getByText(/revoked/).first()).toBeVisible({ timeout: 10_000 });
    await expect(table.locator('tbody tr')).toHaveCount(3, { timeout: 10_000 });
    await expect(table.getByText('Production Deploy')).toBeHidden();
    await page.screenshot({ path: 'e2e/screenshots/admin-api-tokens-journey/07-revoked.png', fullPage: true });

    await checkA11y(page, 'admin-api-tokens-journey');

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: 'e2e/screenshots/admin-api-tokens-journey/08-mobile.png', fullPage: true });

    const real = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('third-party') && !e.includes('ERR_BLOCKED_BY_CLIENT') && !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/api-tokens`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form').first()).toBeVisible();
  });
});
