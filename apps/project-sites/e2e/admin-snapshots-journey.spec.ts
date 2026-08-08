/**
 * Admin — Snapshots Section authenticated journey spec.
 *
 * Real journeys (TDD contract — signInAsTestUser first, stubs after, every
 * mutation intercepted, hard asserts, screenshots per step):
 *
 *  1. LIST      — stubbed list of 2 snapshots (AI-generated names +
 *                 created_at) renders timeline rows with names visible.
 *  2. CREATE    — open dialog → type name → submit → POST
 *                 /api/sites/:id/snapshots intercepted (body asserted) →
 *                 component refreshes the list → new row renders.
 *  3. RESTORE   — more-menu → Revert → ConfirmService dialog appears
 *                 (RED-danger by default: accept button carries text-red-400)
 *                 → accept → POST /snapshots/:id/restore intercepted.
 *  4. DIFF      — more-menu → "Compare with previous" → SPA-routes to
 *                 /admin/snapshots/diff?from&to → stubbed DiffResponse →
 *                 diff panel renders summary + pickers + added file.
 *
 * Menu-law (from snapshots.component.ts template): "Compare with previous"
 * renders only on `!last` rows (needs an older sibling); "Revert" renders only
 * on `!first` rows (latest is already live). With 2 newest-first rows:
 * snap-1 → compare, snap-2 → revert.
 *
 * Snapshot testids (grepped): snapshot-create-button · snapshot-name-input ·
 * snapshot-create-submit · snapshot-title-{id} · snapshot-more-{id} ·
 * snapshot-compare-{id} · snapshot-revert-{id} · snapshot-delete-{id} ·
 * snapshots-load-error · snapshots-retry · snap-timeline · snap-row-{id}
 * (last two added by this journey). Confirm dialog: confirm-message ·
 * confirm-cancel · confirm-accept. Diff: snapshots-diff-section ·
 * diff-pickers · diff-pick-from · diff-pick-to · snapshots-diff-loading.
 *
 * API endpoints stubbed (siteId `e2e-site-001` from the auth helper's ONE
 * stubbed site; response shapes grepped from snapshots.component.ts +
 * snapshots-diff.component.ts + api.service.ts):
 *  - GET  /api/sites/:id/snapshots                → { data: Snapshot[] }
 *  - GET  /api/sites/:id/snapshots/metrics        → { data: {} }
 *  - GET  /api/sites/:id/snapshots/:snapId/metrics→ { data: null }
 *  - GET  /api/sites/:id/snapshots/diff?from&to   → DiffResponse (RAW, unwrapped)
 *  - GET  /api/sites/:id/github/status            → { data: { connected: false } }
 *  - POST /api/sites/:id/snapshots                → created row (+ list refresh)
 *  - POST /api/sites/:id/snapshots/:id/restore    → { data: { version, slug, snapshot_id } }
 *  - ALL other POST/PATCH/PUT/DELETE              → 200 (never reach prod)
 */
import { test, expect, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

interface StubSnapshot {
  id: string;
  snapshot_name: string;
  build_version: string;
  description: string | null;
  created_at: string;
  quality_score?: number;
}

/** Newest-first (component trusts server order). AI-generated-style names. */
function freshRows(): StubSnapshot[] {
  return [
    {
      id: 'snap-1',
      snapshot_name: 'aurora-hero-refresh',
      build_version: 'v14',
      description: 'AI checkpoint after the aurora gradient hero rebuild',
      created_at: '2026-07-20T14:30:00.000Z',
      quality_score: 94,
    },
    {
      id: 'snap-2',
      snapshot_name: 'emerald-seo-baseline',
      build_version: 'v9',
      description: 'Structured-data + meta baseline before the hero rework',
      created_at: '2026-06-01T09:15:00.000Z',
      quality_score: 88,
    },
  ];
}

/** Raw DiffResponse — snapshots-diff.component types the body UNWRAPPED. */
const STUB_DIFF = {
  from: { id: 'snap-2', name: 'emerald-seo-baseline', build_version: 'v9' },
  to: { id: 'snap-1', name: 'aurora-hero-refresh', build_version: 'v14' },
  added: [
    {
      path: 'src/components/HeroAurora.tsx',
      contents: 'export const HeroAurora = () => null;',
      binary: false,
      truncated: false,
    },
  ],
  removed: [],
  modified: [
    {
      path: 'index.html',
      before: '<title>Old</title>',
      after: '<title>New</title>',
      hunks: [
        { added: false, removed: true, value: '<title>Old</title>' },
        { added: true, removed: false, value: '<title>New</title>' },
      ],
      truncated: false,
    },
  ],
  summary:
    'Hero section rebuilt with the aurora gradient treatment; page title refreshed for SEO.',
};

interface Captured {
  mutations: { method: string; url: string; body: unknown }[];
  rows: StubSnapshot[];
}

/**
 * Registers snapshot GET stubs + the mutation guard. Call AFTER
 * signInAsTestUser (Playwright checks routes newest-first, so these win over
 * the auth helper's benign catch-all; the mutation guard registered LAST is
 * checked FIRST and falls back on GET/HEAD).
 */
async function stubSnapshotApis(page: Page): Promise<Captured> {
  const rows = freshRows();
  const mutations: Captured['mutations'] = [];

  // List — leaf endpoint, no subpath (mid-token '*' cannot cross '/').
  await page.route('**/api/sites/*/snapshots', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: rows }),
    });
  });

  // glob-law '/**' twin — every /snapshots SUBPATH (diff?from&to, metrics
  // batch, per-snapshot metrics, download, screenshot.png) routes here.
  await page.route('**/api/sites/*/snapshots/**', async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') return route.fallback(); // mutations → guard
    const url = req.url();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/snapshots/diff')) return json(STUB_DIFF);
    if (/\/snapshots\/[^/?]+\/metrics/.test(url)) return json({ data: null });
    if (url.includes('/snapshots/metrics')) return json({ data: {} });
    if (url.includes('/download')) return json({ data: { files: [] } });
    return json({ data: {} });
  });

  // GitHub status — leaf + glob-law twin for /github subpaths.
  // glob-ok: query-suffix only — /github/status is a leaf endpoint
  await page.route('**/api/sites/*/github/status**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { connected: false } }),
    });
  });
  await page.route('**/api/sites/*/github/**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { connected: false } }),
    });
  });

  // Mutation guard — registered LAST so it is checked FIRST. Captures every
  // write, answers snapshot mutations with realistic payloads, and guarantees
  // nothing mutates prod. glob-ok: '**' suffix — guard covers every subpath.
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'GET' || method === 'HEAD') return route.fallback();
    const url = req.url();
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData();
    }
    mutations.push({ method, url, body });

    const json = (payload: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });

    // CREATE — POST /api/sites/:id/snapshots (list-level, no subpath).
    if (method === 'POST' && /\/api\/sites\/[^/]+\/snapshots(\?.*)?$/.test(url)) {
      const name =
        typeof body === 'object' && body !== null && 'name' in body
          ? String((body as { name: unknown }).name)
          : 'unnamed';
      // Prepend so the component's refresh (loadSnapshots) renders it newest-first.
      rows.unshift({
        id: 'snap-new',
        snapshot_name: name,
        build_version: 'v15',
        description: 'Manual snapshot · created by E2E journey',
        created_at: new Date().toISOString(),
        quality_score: 90,
      });
      return json({
        data: {
          id: 'snap-new',
          snapshot_name: name,
          build_version: 'v15',
          url: `https://e2e-test-site-${name}.projectsites.dev`,
        },
      });
    }

    // RESTORE — POST /api/sites/:id/snapshots/:snapId/restore.
    const restore = url.match(/\/snapshots\/([^/?]+)\/restore/);
    if (method === 'POST' && restore) {
      return json({
        data: { version: 'v9', slug: 'e2e-test-site', snapshot_id: restore[1] },
      });
    }

    return json({ ok: true });
  });

  return { mutations, rows };
}

/** Navigate to /admin/snapshots and wait for the section + first row. */
async function gotoSnapshots(page: Page): Promise<void> {
  await page.goto(`${PROD_URL}/admin/snapshots`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  expect(page.url()).not.toContain('/signin');
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
  await page.mouse.wheel(0, 200);
}

test.use({ serviceWorkers: 'block' });

test.describe('Admin — Snapshots journey', () => {
  // -------------------------------------------------------------------------
  // Test 1: list renders both stubbed rows with their AI-generated names
  // -------------------------------------------------------------------------
  test('snapshot timeline renders stubbed rows with names', async ({ page }) => {
    await signInAsTestUser(page);
    await stubSnapshotApis(page);
    await gotoSnapshots(page);

    // Timeline container + per-row structural hooks (snap-* testids).
    await expect(page.locator('[data-testid="snap-timeline"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="snap-row-snap-1"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="snap-row-snap-2"]')).toBeAttached({ timeout: 10_000 });

    // Names render — the whole point of AI-generated snapshot names.
    await expect(page.locator('[data-testid="snapshot-title-snap-1"]')).toContainText(
      'aurora-hero-refresh',
      { timeout: 10_000 },
    );
    await expect(page.locator('[data-testid="snapshot-title-snap-2"]')).toContainText(
      'emerald-seo-baseline',
      { timeout: 10_000 },
    );

    await page.screenshot({
      path: 'e2e/screenshots/admin-snapshots/list-renders.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: CREATE journey — dialog → name → submit → POST intercepted →
  //         refreshed list renders the new row
  // -------------------------------------------------------------------------
  test('create snapshot: POST intercepted and refreshed row renders', async ({ page }) => {
    await signInAsTestUser(page);
    const { mutations } = await stubSnapshotApis(page);
    await gotoSnapshots(page);

    await expect(page.locator('[data-testid="snapshot-title-snap-1"]')).toBeVisible({
      timeout: 20_000,
    });

    // Open the create dialog.
    await page.locator('[data-testid="snapshot-create-button"]').click();
    const nameInput = page.locator('[data-testid="snapshot-name-input"]');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });

    // Unique name — nameError() rejects duplicates of stubbed rows.
    await nameInput.fill('e2e-manual-checkpoint');
    await page.screenshot({
      path: 'e2e/screenshots/admin-snapshots/create-dialog.png',
      fullPage: false,
    });

    const submit = page.locator('[data-testid="snapshot-create-submit"]');
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await submit.click();

    // HARD: the intercepted POST carried our name and hit the list endpoint.
    await expect
      .poll(
        () =>
          mutations.some(
            (m) =>
              m.method === 'POST' &&
              /\/api\/sites\/[^/]+\/snapshots(\?.*)?$/.test(m.url) &&
              typeof m.body === 'object' &&
              m.body !== null &&
              (m.body as { name?: string }).name === 'e2e-manual-checkpoint',
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    // HARD: component refreshes (loadSnapshots) and the new row renders.
    await expect(page.locator('[data-testid="snapshot-title-snap-new"]')).toContainText(
      'e2e-manual-checkpoint',
      { timeout: 15_000 },
    );

    await page.screenshot({
      path: 'e2e/screenshots/admin-snapshots/create-refreshed.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: RESTORE journey — Revert → RED-danger confirm → POST intercepted
  // -------------------------------------------------------------------------
  test('restore snapshot: danger confirm dialog then POST /restore intercepted', async ({ page }) => {
    await signInAsTestUser(page);
    const { mutations } = await stubSnapshotApis(page);
    await gotoSnapshots(page);

    await expect(page.locator('[data-testid="snapshot-title-snap-2"]')).toBeAttached({
      timeout: 20_000,
    });

    // Revert renders only on !first rows → snap-2 (the older snapshot).
    await page.locator('[data-testid="snapshot-more-snap-2"]').click();
    const revertBtn = page.locator('[data-testid="snapshot-revert-snap-2"]');
    await expect(revertBtn).toBeVisible({ timeout: 10_000 });
    await revertBtn.click();

    // ConfirmService dialog — RED-danger by default (`danger ?? true`; revert
    // passes danger: true explicitly). Accept button carries text-red-400.
    const confirmMsg = page.locator('[data-testid="confirm-message"]');
    await expect(confirmMsg).toBeVisible({ timeout: 10_000 });
    await expect(confirmMsg).toContainText('emerald-seo-baseline');
    const accept = page.locator('[data-testid="confirm-accept"]');
    await expect(accept).toContainText('Revert site');
    await expect(accept).toHaveClass(/text-red-400/);

    await page.screenshot({
      path: 'e2e/screenshots/admin-snapshots/restore-confirm.png',
      fullPage: false,
    });

    await accept.click();

    // HARD: the restore POST fired and was intercepted (never reached prod).
    await expect
      .poll(
        () =>
          mutations.some(
            (m) => m.method === 'POST' && /\/snapshots\/snap-2\/restore/.test(m.url),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    // Dialog resolved + closed after accept.
    await expect(confirmMsg).not.toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-snapshots/restore-done.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: DIFF journey — Compare with previous → diff panel renders
  // -------------------------------------------------------------------------
  test('compare with previous: diff panel renders stubbed DiffResponse', async ({ page }) => {
    await signInAsTestUser(page);
    await stubSnapshotApis(page);
    await gotoSnapshots(page);

    await expect(page.locator('[data-testid="snapshot-title-snap-1"]')).toBeVisible({
      timeout: 20_000,
    });

    // Compare renders only on !last rows → snap-1 (has an older sibling).
    await page.locator('[data-testid="snapshot-more-snap-1"]').click();
    const compareBtn = page.locator('[data-testid="snapshot-compare-snap-1"]');
    await expect(compareBtn).toBeVisible({ timeout: 10_000 });
    await compareBtn.click();

    // SPA route to the diff viewer with from=older, to=newer.
    await expect(page).toHaveURL(/\/admin\/snapshots\/diff\?(?=.*from=snap-2)(?=.*to=snap-1)/, {
      timeout: 15_000,
    });

    // Diff panel renders from the stubbed (RAW) DiffResponse.
    await expect(page.locator('[data-testid="snapshots-diff-section"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="diff-pickers"]')).toBeAttached({ timeout: 10_000 });
    await expect(page.locator('[data-testid="diff-pick-from"]')).toBeAttached();
    await expect(page.locator('[data-testid="diff-pick-to"]')).toBeAttached();
    await expect(
      page.getByText('Hero section rebuilt with the aurora gradient treatment', { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('src/components/HeroAurora.tsx', { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-snapshots/diff-panel.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: zero critical console errors across the section
  // -------------------------------------------------------------------------
  test('no critical console errors on /admin/snapshots', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await signInAsTestUser(page);
    await stubSnapshotApis(page);
    await gotoSnapshots(page);
    await expect(page.locator('[data-testid="snapshot-title-snap-1"]')).toBeVisible({
      timeout: 20_000,
    });

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('net::ERR') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Test 6: a11y advisory pass
  // -------------------------------------------------------------------------
  test('a11y advisory — no critical violations on /admin/snapshots', async ({ page }) => {
    await signInAsTestUser(page);
    await stubSnapshotApis(page);
    await gotoSnapshots(page);

    await checkA11y(page, 'admin-snapshots');
    await page.screenshot({ path: 'e2e/screenshots/admin-snapshots/a11y.png', fullPage: false });
  });

  // -------------------------------------------------------------------------
  // Test 7: mobile 375px render — list or create affordance present
  // -------------------------------------------------------------------------
  test('mobile 375px — snapshots section renders list', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await signInAsTestUser(page);
    await stubSnapshotApis(page);
    await gotoSnapshots(page);

    const createBtn = page.locator('[data-testid="snapshot-create-button"]');
    const firstRow = page.locator('[data-testid="snapshot-title-snap-1"]');
    const eitherVisible = await Promise.any([
      createBtn.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true),
      firstRow.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true),
    ]).catch(() => false);
    expect(eitherVisible).toBe(true);

    await page.screenshot({
      path: 'e2e/screenshots/admin-snapshots/mobile-375.png',
      fullPage: false,
    });
  });
});
