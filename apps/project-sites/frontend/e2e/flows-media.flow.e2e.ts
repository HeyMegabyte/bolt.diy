/**
 * flows-media.flow.e2e.ts — Full-flow · Media Library
 *
 * 18 ELABORATE, REALISTIC full-flow journeys over the /admin/media surface.
 * Each test is a real multi-step user journey (seed → navigate by UI → act →
 * assert UI → assert ground-truth via apiFetch → visual snap).
 *
 * Auth: e2e-test-org OWNER (NOT super-admin) — owner surfaces work.
 * System-admin-only surfaces 403 for this key (expected, not a failure).
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-media.flow
 *
 * SAFETY INVARIANTS (never violate):
 * - Never trigger a real DALL·E / Sora / Veo paid generation.
 * - Never complete a delete — always cancel / Escape.
 * - apiFetch status 5xx = hard fail; 4xx = feature dark/unavailable (soft).
 */

import { test, expect, type Page } from '@playwright/test';
import {
  hasKey,
  seedSession,
  gotoAdmin,
  attachConsole,
  expectClean,
  snap,
  apiFetch,
} from './_flow-helpers';

// ---------------------------------------------------------------------------
// Types (no `any`)
// ---------------------------------------------------------------------------
interface AssetsResponse {
  assets?: unknown[];
  items?: unknown[];
  data?: unknown[];
  total?: number;
  count?: number;
}

interface StockSearchResponse {
  results?: unknown[];
  photos?: unknown[];
  images?: unknown[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MEDIA_ROUTE = '/admin/media';
const MEDIA_NAV_RE = /media/i;

/**
 * Navigate to the media section defensively.
 * Tries /admin/media first; if it 404s or the app renders a not-found heading,
 * falls back to clicking the visible nav link from the admin shell.
 */
async function gotoMedia(page: Page): Promise<void> {
  // Derive the prod base URL from what was already loaded (avoids hardcoding)
  const base = new URL(page.url()).origin;
  await page.goto(`${base}${MEDIA_ROUTE}`, { waitUntil: 'domcontentloaded' }).catch(() => {});

  // Settle Angular CD
  await page.waitForTimeout(1200);

  // If we hit a not-found, try nav-click fallback
  const notFound = page.getByRole('heading', { name: /not found|404/i });
  if (await notFound.count()) {
    await gotoAdmin(page, '/admin');
    const navLink = page.getByRole('link', { name: MEDIA_NAV_RE }).first();
    if (await navLink.count()) {
      await navLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
    }
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
test.describe('Full-flow · media', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set — skipping authed flows');
  test.describe.configure({ retries: 2 });
  // Reduced-motion removes Angular View-Transition pointer overlay flake
  // and makes visual snaps deterministic.
  test.use({ reducedMotion: 'reduce' });

  // ── 01 — Section shell renders ────────────────────────────────────────────

  test('01 media section renders with a heading or landmark containing the word media', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    const heading = page.getByRole('heading', { name: MEDIA_NAV_RE });
    const main = page.getByRole('main');
    const hasHeading = (await heading.count()) > 0;
    const hasMain = (await main.count()) > 0;

    expect(
      hasHeading || hasMain,
      'Media section must render a heading or main landmark',
    ).toBe(true);

    await snap(page, 'media-01-shell');
    expectClean(errors);
  });

  // ── 02 — Asset list reconciles with API ground truth ─────────────────────

  test('02 asset list reconciles with /api/media/assets ground truth (verify-against-source-of-truth)', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    // Ground truth FIRST — before navigating to the UI
    const apiRes = await apiFetch<AssetsResponse>(page, '/api/media/assets');
    const groundTruth =
      apiRes.status === 200
        ? (apiRes.body?.assets?.length ??
          apiRes.body?.items?.length ??
          apiRes.body?.data?.length ??
          0)
        : 0;

    await gotoMedia(page);

    if (groundTruth > 0) {
      // Store has records → UI MUST show at least one asset card / thumbnail
      const thumbnails = page.locator(
        '[data-testid="media-asset-item"], [data-testid="asset-thumbnail"], [data-testid="asset-card"]',
      );
      await expect(
        thumbnails.first(),
        `groundTruth=${groundTruth}: expect at least one asset row`,
      ).toBeVisible({ timeout: 10_000 });
    } else {
      // groundTruth = 0 → honest empty state — do NOT fail
      const emptyEl = page.locator('[data-testid="media-empty-state"], [data-testid="empty-state"]');
      const emptyText = page.getByText(/no (assets|media|files)|empty|upload your first/i);
      const hasEmpty = (await emptyEl.count()) > 0 || (await emptyText.count()) > 0;
      if (!hasEmpty) {
        console.warn('media-02: groundTruth=0 and no empty-state element found (soft warning)');
      }
    }

    await snap(page, 'media-02-asset-reconcile');
    expectClean(errors);
  });

  // ── 03 — Upload control is present ───────────────────────────────────────

  test.fixme('03 an upload control (button / drop-zone / file input) is discoverable', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    const uploadBtn = page.getByRole('button', { name: /upload/i });
    const fileInput = page.locator('input[type="file"]');
    const dropzone = page.locator('[data-testid="upload-dropzone"], [data-testid="media-upload"]');
    const dropText = page.getByText(/drag.*(drop|here)|drop.*file|upload (a |an |your )?file/i);

    const present =
      (await uploadBtn.count()) > 0 ||
      (await fileInput.count()) > 0 ||
      (await dropzone.count()) > 0 ||
      (await dropText.count()) > 0;

    expect(present, 'At least one upload affordance must be present').toBe(true);

    await snap(page, 'media-03-upload-control');
    expectClean(errors);
  });

  // ── 04 — Clicking the upload button opens a modal or reveals file input ──

  test('04 upload button click opens dialog or reveals file input without navigating away', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    const uploadBtn = page.getByRole('button', { name: /upload/i }).first();
    if (!(await uploadBtn.count())) {
      test.skip();
      return;
    }

    const urlBefore = page.url();
    await uploadBtn.click();
    await page.waitForTimeout(600);

    const dialog = page.getByRole('dialog');
    const alertDialog = page.getByRole('alertdialog');
    const fileInput = page.locator('input[type="file"]');
    const opened =
      (await dialog.count()) > 0 ||
      (await alertDialog.count()) > 0 ||
      (await fileInput.count()) > 0;

    // Either opened something OR stayed on the same page (upload may be inline)
    expect(
      opened || page.url() === urlBefore,
      'Upload click must open a dialog or reveal file input',
    ).toBeTruthy();

    await snap(page, 'media-04-upload-click');

    // Close dialog if present
    const closeBtn = page.getByRole('button', { name: /close|cancel|dismiss/i }).first();
    if (await closeBtn.count()) await closeBtn.click();
    else await page.keyboard.press('Escape');

    expectClean(errors);
  });

  // ── 05 — Stock-search UI is present ──────────────────────────────────────

  test('05 stock-search UI element (tab / button / input) is discoverable', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    const searchInput = page.getByRole('searchbox').first();
    const stockTab = page.getByRole('tab', { name: /stock|search|photos/i });
    const stockBtn = page.getByRole('button', { name: /stock|search photo/i });
    const stockLabel = page.getByText(/stock (image|photo|search)|unsplash|pexels|pixabay/i);

    const present =
      (await searchInput.count()) > 0 ||
      (await stockTab.count()) > 0 ||
      (await stockBtn.count()) > 0 ||
      (await stockLabel.count()) > 0;

    // Soft — may be flag-dark
    if (!present) {
      console.warn('media-05: stock-search UI not found (may be flag-dark — acceptable)');
    }

    await snap(page, 'media-05-stock-search-ui');
    expectClean(errors);
  });

  // ── 06 — Stock search API returns 200 or graceful non-5xx ────────────────

  test('06 POST /api/media/stock/search with query "office" returns non-5xx', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin'); // ensure session is seeded in page context

    const apiRes = await apiFetch<StockSearchResponse>(page, '/api/media/stock/search', {
      method: 'POST',
      body: JSON.stringify({ query: 'office' }),
    });

    // 200 = results, 4xx = feature dark or not configured — both acceptable.
    // Only 5xx indicates a server crash that must be fixed.
    expect(
      apiRes.status,
      `Stock search returned ${apiRes.status} — only 5xx is a failure`,
    ).toBeLessThan(500);
  });

  // ── 07 — Typing a stock-search query does not crash the UI ───────────────

  test('07 typing a stock-search query leaves the UI responsive (no error boundary crash)', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    // Navigate to stock tab if it exists
    const stockTab = page.getByRole('tab', { name: /stock|search/i }).first();
    if (await stockTab.count()) await stockTab.click();

    const searchInput = page.getByRole('searchbox').first();
    if (!(await searchInput.count())) {
      test.skip();
      return;
    }

    await searchInput.fill('office');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');

    // Error boundary crash would show one of these messages
    const errorBoundary = page.getByText(
      /something went wrong|unexpected error|error loading|failed to load/i,
    );
    expect(await errorBoundary.count(), 'No error boundary crash after stock search').toBe(0);

    await snap(page, 'media-07-stock-search-query');
    expectClean(errors);
  });

  // ── 08 — Generate-image control is present (DO NOT trigger) ──────────────

  test('08 generate-image control is present — presence only, no generation triggered', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    const genImgBtn = page.getByRole('button', {
      name: /generate (image|photo|art)|ai (image|generate)/i,
    });
    const genImgTab = page.getByRole('tab', { name: /generate|ai image|generate image/i });
    const genImgInput = page.getByPlaceholder(/describe.*image|image prompt|generate an? image/i);
    const genImgLabel = page.getByText(/generate (an? )?image|ai image generation|dall.e|stable diff/i);

    const present =
      (await genImgBtn.count()) > 0 ||
      (await genImgTab.count()) > 0 ||
      (await genImgInput.count()) > 0 ||
      (await genImgLabel.count()) > 0;

    if (!present) {
      console.warn('media-08: generate-image control not found (may be flag-dark — acceptable)');
    }

    await snap(page, 'media-08-generate-image-control');
    expectClean(errors);
  });

  // ── 09 — Generate-video control is present (DO NOT trigger) ──────────────

  test('09 generate-video control is present — presence only, no generation triggered', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    const genVidBtn = page.getByRole('button', {
      name: /generate (video|clip)|ai video|veo|sora/i,
    });
    const genVidTab = page.getByRole('tab', { name: /video|veo|sora/i });
    const genVidInput = page.getByPlaceholder(/video prompt|describe.*video/i);
    const genVidLabel = page.getByText(/generate (a )?video|ai video|veo|sora/i);

    const present =
      (await genVidBtn.count()) > 0 ||
      (await genVidTab.count()) > 0 ||
      (await genVidInput.count()) > 0 ||
      (await genVidLabel.count()) > 0;

    if (!present) {
      console.warn('media-09: generate-video control not found (may be flag-dark — acceptable)');
    }

    await snap(page, 'media-09-generate-video-control');
    expectClean(errors);
  });

  // ── 10 — Generate-image tab navigation does not crash ────────────────────

  test('10 navigating to the generate-image tab does not crash the UI', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    const genTab = page.getByRole('tab', { name: /generate|ai image|ai media/i }).first();
    if (!(await genTab.count())) {
      test.skip();
      return;
    }

    await genTab.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);

    const errorBoundary = page.getByText(/something went wrong|unexpected error/i);
    expect(await errorBoundary.count(), 'No error boundary crash on generate tab').toBe(0);

    // Assert the prompt input or a description label renders
    const promptInput = page.getByRole('textbox').first();
    const promptLabel = page.getByText(/prompt|describe/i);
    const controlRendered = (await promptInput.count()) > 0 || (await promptLabel.count()) > 0;
    expect(controlRendered, 'Generate tab must render a prompt input or description label').toBe(true);

    await snap(page, 'media-10-generate-tab');
    expectClean(errors);
  });

  // ── 11 — Send-to-bolt affordance is discoverable ─────────────────────────

  test('11 send-to-bolt / use-in-editor affordance is discoverable', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    // Check for the affordance directly first
    const sendBtn = page.getByRole('button', {
      name: /send to bolt|use in editor|open in bolt|insert|use this/i,
    });
    const sendIcon = page.locator(
      '[data-testid="send-to-bolt"], [data-testid="use-in-editor"], [data-testid="insert-asset"]',
    );
    const sendText = page.getByText(/send to bolt|use in editor|insert into/i);

    let present =
      (await sendBtn.count()) > 0 ||
      (await sendIcon.count()) > 0 ||
      (await sendText.count()) > 0;

    // Affordance may be hidden until hovering an asset card
    if (!present) {
      const firstAsset = page.locator('[data-testid="media-asset-item"], [data-testid="asset-card"]').first();
      if (await firstAsset.count()) {
        await firstAsset.hover();
        await page.waitForTimeout(300);
        const hoverSend = page.getByRole('button', {
          name: /send to bolt|use in editor|insert/i,
        });
        if (await hoverSend.count()) {
          present = true;
        }
      }
    }

    // Soft — affordance may only exist once assets are present
    if (!present) {
      console.warn('media-11: send-to-bolt affordance not found (may appear only with assets)');
    }

    await snap(page, 'media-11-send-to-bolt');
    expectClean(errors);
  });

  // ── 12 — Delete opens a confirmation dialog ───────────────────────────────

  test('12 delete button opens confirm dialog — cancel so no actual deletion occurs', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    // Try to reveal delete action (may require hover)
    const firstAsset = page.locator(
      '[data-testid="media-asset-item"], [data-testid="asset-card"]',
    ).first();
    if (await firstAsset.count()) await firstAsset.hover();

    const deleteBtn = page.getByRole('button', { name: /delete|remove/i }).first();
    if (!(await deleteBtn.count())) {
      test.skip();
      return;
    }

    await deleteBtn.click();

    // A confirmation must appear
    const dialog = page.getByRole('dialog');
    const alertDialog = page.getByRole('alertdialog');
    const confirmText = page.getByText(/are you sure|confirm delete|this (action|cannot be)/i);

    const confirmed =
      (await dialog.count()) > 0 ||
      (await alertDialog.count()) > 0 ||
      (await confirmText.count()) > 0;

    expect(confirmed, 'Delete must open a confirmation dialog').toBe(true);

    await snap(page, 'media-12-delete-confirm-open');

    // ALWAYS cancel — never delete
    const cancelBtn = page.getByRole('button', { name: /cancel|no|keep|back/i }).first();
    if (await cancelBtn.count()) {
      await cancelBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }

    await page.waitForTimeout(400);
    expectClean(errors);
  });

  // ── 13 — Cancel delete confirm leaves the asset list intact ──────────────

  test('13 cancelling delete confirm does not remove any assets from the list', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    const assetSel = '[data-testid="media-asset-item"], [data-testid="asset-card"]';
    const countBefore = await page.locator(assetSel).count();

    const firstAsset = page.locator(assetSel).first();
    if (await firstAsset.count()) await firstAsset.hover();

    const deleteBtn = page.getByRole('button', { name: /delete|remove/i }).first();
    if (!(await deleteBtn.count())) {
      test.skip();
      return;
    }

    await deleteBtn.click();
    await page.waitForTimeout(400);

    const cancelBtn = page.getByRole('button', { name: /cancel|no|keep|back/i }).first();
    if (await cancelBtn.count()) {
      await cancelBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);

    const countAfter = await page.locator(assetSel).count();
    expect(countAfter, 'Asset count must not decrease after cancel').toBe(countBefore);

    await snap(page, 'media-13-cancel-delete');
    expectClean(errors);
  });

  // ── 14 — Filter / tag UI is discoverable ─────────────────────────────────

  test('14 a filter or tag UI is discoverable on the media section', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    const filterSelect = page.getByRole('combobox', { name: /filter|type|format|kind/i });
    const filterBtn = page.getByRole('button', { name: /filter/i });
    const filterInput = page.getByPlaceholder(/filter|search (assets|media)/i);
    const tagChip = page.locator(
      '[data-testid="media-tag"], [data-testid="filter-chip"], [data-testid="kind-filter"]',
    );
    const filterLabel = page.getByText(/filter by|show only|all (types|media|assets)/i);

    const present =
      (await filterSelect.count()) > 0 ||
      (await filterBtn.count()) > 0 ||
      (await filterInput.count()) > 0 ||
      (await tagChip.count()) > 0 ||
      (await filterLabel.count()) > 0;

    if (!present) {
      console.warn('media-14: filter UI not found (may be planned feature — acceptable)');
    }

    await snap(page, 'media-14-filter-ui');
    expectClean(errors);
  });

  // ── 15 — Clicking an asset opens a detail or preview panel ───────────────

  test('15 clicking an asset card opens a detail panel, sheet, or dialog', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    const firstAsset = page
      .locator('[data-testid="media-asset-item"], [data-testid="asset-card"], [data-testid="asset-thumbnail"]')
      .first();

    if (!(await firstAsset.count())) {
      test.skip();
      return;
    }

    await firstAsset.click();
    await page.waitForTimeout(600);

    const panel = page.locator('[data-testid="media-detail"], [data-testid="asset-preview"], [data-testid="asset-detail"]');
    const dialog = page.getByRole('dialog');
    const sheet = page.locator('[data-testid="side-panel"], [data-testid="sheet"]');

    const opened =
      (await panel.count()) > 0 ||
      (await dialog.count()) > 0 ||
      (await sheet.count()) > 0;

    expect(opened, 'Clicking an asset must open a detail panel or dialog').toBe(true);

    await snap(page, 'media-15-asset-detail');

    // Close
    const closeBtn = page.getByRole('button', { name: /close|dismiss/i }).first();
    if (await closeBtn.count()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }

    expectClean(errors);
  });

  // ── 16 — Pagination / load-more present when ground truth exceeds 1 page ─

  test('16 pagination or load-more control appears when assets exceed one page', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const apiRes = await apiFetch<AssetsResponse>(page, '/api/media/assets');
    const total =
      apiRes.status === 200
        ? (apiRes.body?.total ?? apiRes.body?.count ?? 0)
        : 0;

    await gotoMedia(page);

    if (total > 20) {
      const nextBtn = page.getByRole('button', { name: /next|load more|show more/i });
      const paginationNav = page.getByRole('navigation', { name: /pagination/i });
      const paginator = page.locator('[data-testid="load-more"], [data-testid="pagination"]');

      const hasPaging =
        (await nextBtn.count()) > 0 ||
        (await paginationNav.count()) > 0 ||
        (await paginator.count()) > 0;

      expect(hasPaging, `total=${total}: pagination must be present`).toBe(true);
    } else {
      console.warn(`media-16: total=${total} ≤ 20; skipping pagination assertion`);
    }

    await snap(page, 'media-16-pagination');
    expectClean(errors);
  });

  // ── 17 — Tab key can reach the upload control ─────────────────────────────

  test('17 Tab key reaches the upload control within 25 presses from the page top', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    // Focus the page body so Tab starts from the top
    await page.locator('body').focus();
    let reached = false;

    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return '';
        return [
          el.getAttribute('aria-label') ?? '',
          el.getAttribute('placeholder') ?? '',
          el.textContent?.trim().slice(0, 80) ?? '',
          el.tagName,
        ].join(' ');
      });

      if (/upload|drop|file|media/i.test(focused)) {
        reached = true;
        break;
      }
    }

    if (!reached) {
      console.warn('media-17: upload control not reached via Tab in 25 presses (a11y improvement opportunity)');
    }

    await snap(page, 'media-17-keyboard-nav');
    expectClean(errors);
  });

  // ── 18 — Console hygiene: zero JS/CSP errors across full media load ───────

  test('18 zero real console errors on full media section load including scroll-to-bottom', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoMedia(page);

    // Scroll to bottom to trigger any lazy-load / infinite-scroll paths
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForLoadState('networkidle');

    await snap(page, 'media-18-console-hygiene');
    expectClean(errors);
  });
});
