/**
 * @file create-edit-publish-flow.spec.ts
 * @description THE canonical, REAL end-to-end product flow (Brian directive, iter 56).
 *
 * Unlike golden-path.spec.ts (which STUBS `/api/sites/create-from-search` + a fake
 * published site) and admin-editor-journey.spec.ts (fake `e2e-site-001`, editor
 * cross-origin traffic NOT asserted), this spec hits the REAL backend end-to-end and
 * proves the PRODUCT works — not just that the UI renders. See
 * [[feedback_loop_verifies_real_flows_not_programs]].
 *
 * The 6 steps (Brian's canonical flow):
 *   1. /create a site (real POST /api/sites/create-from-search)
 *   2. it BUILDS for real (poll /waiting → published; the container build is ~40 min)
 *   3. view the live site at {slug}.projectsites.dev — it is a real, good website
 *   4. /admin/editor → enter a requirement (change the title to "TESTTESTTEST")
 *   5. verify the live site updates to "TESTTESTTEST"
 *   6. publish (POST /api/sites/:id/publish-bolt) and re-verify
 *
 * ⚠️ COST GATE: a real build costs ~$15 + ~40 min (per CLAUDE.md API-credit-discipline).
 * This spec is SKIPPED unless `E2E_REAL_BUILD=1` — it must be run DELIBERATELY, never
 * on every CI push. Run it with:
 *   E2E_REAL_BUILD=1 PROD_URL=https://projectsites.dev \
 *     npx playwright test create-edit-publish-flow --config=playwright.prod.config.ts
 *
 * Auth: real mock-USER rows (not mocked APIs) via e2e/helpers/auth.ts.
 */
import { test, expect } from '@playwright/test';
import { signInAsTestUser, gotoAdmin } from './helpers/auth.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';
const REAL = process.env.E2E_REAL_BUILD === '1';

// A unique business per run so we never collide with an existing site.
const RUN_TAG = process.env.E2E_RUN_TAG ?? 'flowtest';
const BIZ_NAME = `Flow Test Salon ${RUN_TAG}`;
const BIZ_ADDRESS = '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034';
const NEW_TITLE = 'TESTTESTTEST';

// Real container builds are ~40 min; give generous headroom.
const BUILD_TIMEOUT_MS = 50 * 60_000;

test.describe('Canonical REAL flow: create → build → view → edit → publish', () => {
  test.skip(
    !REAL,
    'Set E2E_REAL_BUILD=1 to run the real (paid, ~40 min) build flow — deliberate only.',
  );
  test.setTimeout(BUILD_TIMEOUT_MS + 10 * 60_000);

  test('a real site builds, renders, edits to TESTTESTTEST, and publishes', async ({ page }) => {
    // ── Step 0: real auth (mock USER row, real session) ──────────────────
    await signInAsTestUser(page);

    // ── Step 1: /create → real create-from-search POST ───────────────────
    await page.goto(`${PROD_URL}/create`, { waitUntil: 'domcontentloaded' });
    await page.locator('#create-name').fill(BIZ_NAME);
    await page.locator('#create-address').fill(BIZ_ADDRESS);
    await page
      .locator('#create-context')
      .fill('Modern mens salon: haircuts, hot-towel shaves, beard grooming. Warm, premium feel.');

    const createResp = page.waitForResponse(
      (r) => r.url().includes('/api/sites/create-from-search') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Create site|Create with/ }).click();
    const created = await (await createResp).json();
    const siteId: string = created?.data?.id ?? created?.id;
    const slug: string = created?.data?.slug ?? created?.slug;
    expect(siteId, 'create-from-search returned a real site id').toBeTruthy();
    expect(slug, 'create-from-search returned a real slug').toBeTruthy();

    // ── Step 2: it BUILDS for real (poll status → published) ─────────────
    await expect(page).toHaveURL(/\/waiting\?.*id=/, { timeout: 15_000 });
    await expect
      .poll(
        async () => {
          const s = await page.request.get(`${PROD_URL}/api/sites/${siteId}`);
          if (!s.ok()) return 'fetch_error';
          const body = await s.json();
          return body?.data?.status ?? body?.status ?? 'unknown';
        },
        { timeout: BUILD_TIMEOUT_MS, intervals: [15_000] },
      )
      .toBe('published');

    // ── Step 3: view the live site — it is a real, good website ──────────
    const siteUrl = `https://${slug}.projectsites.dev/`;
    await page.goto(siteUrl, { waitUntil: 'domcontentloaded' });
    // real content present: an H1 with text, a non-empty <body>, no 5xx shell.
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
    expect((await page.locator('body').innerText()).trim().length).toBeGreaterThan(200);

    // ── Step 4: /admin/editor → enter a requirement (title → TESTTESTTEST) ─
    // The bolt.diy editor is a cross-origin iframe (.bolt-frame → editor.projectsites.dev).
    // We drive it via its prompt input and wait for the edit to be applied + published.
    await gotoAdmin(page, `/admin/sites/${siteId}`);
    await page.goto(`${PROD_URL}/admin/editor`, { waitUntil: 'domcontentloaded' });
    const bolt = page.locator('.bolt-frame');
    await expect(bolt).toBeAttached({ timeout: 30_000 });
    await expect(bolt).toHaveClass(/bolt-frame--visible/, { timeout: 60_000 });
    const editor = page.frameLocator('.bolt-frame');
    const prompt = editor
      .getByPlaceholder(/message|prompt|describe|change|ask/i)
      .or(editor.getByRole('textbox'))
      .first();
    await prompt.waitFor({ state: 'visible', timeout: 60_000 });
    await prompt.fill(`Change the homepage <title> and the H1 to exactly "${NEW_TITLE}".`);
    await prompt.press('Enter');

    // ── Step 5: verify the LIVE site updates to TESTTESTTEST ─────────────
    // Editor applies + republishes; poll the served HTML for the new title.
    await expect
      .poll(
        async () => {
          const r = await page.request.get(siteUrl, { headers: { 'cache-control': 'no-cache' } });
          if (!r.ok()) return '';
          const html = await r.text();
          const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
          return (m?.[1] ?? '').trim();
        },
        { timeout: 10 * 60_000, intervals: [10_000] },
      )
      .toContain(NEW_TITLE);

    // ── Step 6: publish (explicit) + re-verify ───────────────────────────
    const pub = await page.request.post(`${PROD_URL}/api/sites/${siteId}/publish-bolt`, {
      data: {},
    });
    expect([200, 201, 202]).toContain(pub.status());
    await page.goto(siteUrl, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(new RegExp(NEW_TITLE));
  });
});
