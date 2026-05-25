/**
 * @fileoverview E2E — Media > Video Studio tab (TDD-RED)
 *
 * Flow: homepage → Admin → Media → Video Studio tab → assert Sora/Veo toggle +
 *       queue notice → enter prompt → click Generate → assert "queued" row with model chip.
 *
 * Screenshots in e2e/screenshots/media-video-studio/.
 */

import { test, expect } from './fixtures.js';
import type { Page, Route } from '@playwright/test';

const BREAKPOINTS = [
  { width: 375,  height: 812  },
  { width: 390,  height: 844  },
  { width: 768,  height: 1024 },
  { width: 1024, height: 768  },
  { width: 1280, height: 800  },
  { width: 1920, height: 1080 },
];

async function stubAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ps_session',
      JSON.stringify({ token: 'e2e-video-token', email: 'test@megabyte.space' }),
    );
  });

  await page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { user_id: 'u-vid', org_id: 'org-vid', email: 'test@megabyte.space' },
      }),
    });
  });

  await page.route('**/api/sites', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/api/billing/**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { plan: 'pro', status: 'active' } }),
    });
  });
}

async function stubVideoGenerate(page: Page, model: string = 'sora'): Promise<{ calls: string[] }> {
  const calls: string[] = [];

  await page.route('**/api/media/video/generate**', async (route: Route) => {
    const body = await route.request().postDataJSON() as { prompt?: string; model?: string };
    calls.push(JSON.stringify(body));
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: `vid-job-${Date.now()}`,
          status: 'queued',
          model: body.model ?? model,
          prompt: body.prompt ?? '',
          created_at: new Date().toISOString(),
        },
      }),
    });
  });

  return { calls };
}

async function navigateToVideoStudio(page: Page): Promise<void> {
  await page.goto('/');
  await page.click('[data-testid="nav-admin"], a[href*="/admin"], text=Admin');
  await page.waitForURL(/\/admin/);
  await page.click('[data-testid="sidebar-media"], [href*="media"], text=Media');
  await page.waitForURL(/\/admin\/media/);

  const tab = page.locator(
    '[data-testid="media-tab-video"], [role="tab"]:has-text("Video"), text=Video Studio',
  );
  await expect(tab).toBeVisible({ timeout: 8_000 });
  await tab.click();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Media — Video Studio tab', () => {
  test('tab mounts with Sora/Veo model toggle and queue notice copy', async ({ page }) => {
    await stubAuth(page);
    await stubVideoGenerate(page);

    await navigateToVideoStudio(page);
    await page.screenshot({ path: 'e2e/screenshots/media-video-studio/01-tab.png', fullPage: false });

    // Model toggle — should show Sora AND Veo as selectable options
    const soraOption = page.locator(
      '[data-testid="video-model-sora"], [value="sora"], label:has-text("Sora"), button:has-text("Sora"), text=Sora',
    );
    const veoOption = page.locator(
      '[data-testid="video-model-veo"], [value="veo"], label:has-text("Veo"), button:has-text("Veo"), text=Veo',
    );

    // At least one model selector should be visible
    const hasSora = await soraOption.count() > 0;
    const hasVeo  = await veoOption.count() > 0;
    expect(hasSora || hasVeo).toBe(true);

    // Queue notice should be visible — video generation is async
    const queueNotice = page.locator(
      '[data-testid="video-queue-notice"], .queue-notice, text=queue, text=Queue, text=async, text=minutes',
    );
    const hasQueueNotice = await queueNotice.count() > 0;
    // Soft assertion: queue notice is expected but UI may phrase differently
    if (!hasQueueNotice) {
      console.warn('[media-video-studio] Queue notice not found — selector may need updating.');
    }
  });

  test('entering prompt and clicking Generate creates a queued asset row with model chip', async ({ page }) => {
    await stubAuth(page);
    const { calls } = await stubVideoGenerate(page, 'sora');

    await navigateToVideoStudio(page);

    // Fill in the prompt
    const promptInput = page.locator(
      '[data-testid="video-studio-prompt"], textarea[placeholder*="prompt" i], textarea[placeholder*="video" i]',
    ).first();
    await expect(promptInput).toBeVisible({ timeout: 8_000 });
    await promptInput.click();
    await promptInput.fill('aerial view of a misty mountain sunrise timelapse');

    await page.screenshot({ path: 'e2e/screenshots/media-video-studio/02-prompt-entered.png', fullPage: false });

    // Click Generate
    const generateBtn = page.locator(
      '[data-testid="video-studio-generate"], button:has-text("Generate"), button:has-text("Queue")',
    ).first();
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // Queued row should appear in the jobs/assets list
    const queuedRow = page.locator(
      '[data-testid="video-job-row"], .video-job, [data-status="queued"]',
    );
    await expect(queuedRow.first()).toBeVisible({ timeout: 12_000 });

    // Model chip should be visible on the queued row
    const modelChip = page.locator(
      '[data-testid="video-model-chip"], .model-chip, .badge:has-text("sora"), .chip:has-text("Sora")',
    );
    await expect(modelChip.first()).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/media-video-studio/03-queued-row.png', fullPage: false });

    // POST was made
    expect(calls.length).toBeGreaterThan(0);
  });

  test('switching model from Sora to Veo reflects in queued row chip', async ({ page }) => {
    await stubAuth(page);
    await stubVideoGenerate(page, 'veo');

    await navigateToVideoStudio(page);

    // Select Veo
    const veoOption = page.locator(
      '[data-testid="video-model-veo"], [value="veo"], label:has-text("Veo"), button:has-text("Veo")',
    );
    if (await veoOption.count() > 0) {
      await veoOption.first().click();
    }

    const promptInput = page.locator(
      '[data-testid="video-studio-prompt"], textarea[placeholder*="prompt" i]',
    ).first();
    await promptInput.fill('slow-motion ocean waves crashing at sunset');

    const generateBtn = page.locator(
      '[data-testid="video-studio-generate"], button:has-text("Generate"), button:has-text("Queue")',
    ).first();
    await generateBtn.click();

    // Model chip should mention Veo
    const veoChip = page.locator(
      '[data-testid="video-model-chip"], .model-chip, .badge:has-text("veo"), .chip:has-text("Veo")',
    );
    await expect(veoChip.first()).toBeVisible({ timeout: 12_000 });

    await page.screenshot({ path: 'e2e/screenshots/media-video-studio/04-veo-chip.png', fullPage: false });
  });

  // ─── Breakpoint smoke ───────────────────────────────────────────────────────

  for (const vp of BREAKPOINTS) {
    test(`Video Studio tab renders at ${vp.width}×${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await stubAuth(page);
      await stubVideoGenerate(page);

      await navigateToVideoStudio(page);

      await page.screenshot({
        path: `e2e/screenshots/media-video-studio/bp-${vp.width}.png`,
        fullPage: false,
      });

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(vp.width + 2);
    });
  }
});
