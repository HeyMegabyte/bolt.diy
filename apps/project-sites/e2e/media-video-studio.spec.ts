/**
 * @fileoverview E2E — Media ▸ Video Studio tab  (flag `site_video_gen`)
 *
 * ── Surface reality (grepped 2026-07-31) ────────────────────────────────────
 * The Video Studio lives INSIDE `admin/sections/media.component.ts` (the 5-tab
 * media workspace), NOT a standalone route. It is reachable via the bookmarkable
 * deep link `/admin/media?tab=video` (the component reads `?tab=` at
 * construction: media.component.ts:1384). Real markup + the minimal testids
 * added this pass:
 *   · tab strip button        → [data-testid="media-tab-video"]  (id="med-tab-video")
 *   · panel                   → [data-testid="video-studio-panel"]
 *   · Sora / Veo model pills   → [data-testid="video-model-sora|veo"]  (.pill)
 *   · prompt textarea         → [data-testid="video-studio-prompt"]  (id="vid-prompt", maxlength=2000)
 *   · async queue notice      → [data-testid="video-queue-notice"]
 *   · Generate CTA            → [data-testid="video-studio-generate"]  ("Generate video" / "Queuing…")
 *   · queued job row          → [data-testid="video-job-row"][data-status]
 *   · status chip on the row   → [data-testid="video-model-chip"]  (renders j.status)
 *   · empty state             → [data-testid="video-jobs-empty"]
 * The worker route is `POST /api/media/generate/video` (media.component.ts:1780).
 * The jobs list is `videoJobs()` = `assets().filter(kind==='video')` — so the
 * POST stub MUST return an asset with `kind:'video'` for a row to appear.
 *
 * ── Why yesterday's 9 assertions failed (diagnosis) ─────────────────────────
 * The prior spec targeted a DIFFERENT model — it looked for `[data-testid=
 * "media-tab-video"]` / `[data-testid="video-studio-prompt"]` etc. that DID NOT
 * EXIST in the component (the panel used bare ids/classes: `#vid-prompt`, `.pill`,
 * `.job-row`), and it navigated by clicking `[data-testid="sidebar-media"]` which
 * also isn't in the shell. So every locator missed. Pass-9's sweeper had already
 * corrected the STUB PATH to `/api/media/generate/video`; the remaining gap was
 * the missing markup hooks. This pass adds the testids AND rebuilds the spec
 * against them + the real POST contract + the kind:'video' asset requirement.
 *
 * ── TDD contract satisfied ──────────────────────────────────────────────────
 * signInAsTestUser (helper) → stubs AFTER helper → glob-law '/**' twins on the
 * mid-token stubs → generate POST intercepted (queued job) → studio render →
 * generate interaction → value-domain the prompt (valid/empty/overlong-2000/
 * injection) → zero-console-error (filtered) → screenshots → bounded timeouts,
 * no networkidle.
 *
 * Screenshots in e2e/screenshots/media-video-studio/.
 */
import { test, expect } from './fixtures.js';
import { signInAsTestUser } from './helpers/auth.js';
import type { Page, Route } from '@playwright/test';

const BASE = process.env.PROD_URL ?? process.env.BASE_URL ?? 'https://projectsites.dev';

const BREAKPOINTS = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

/** A queued video asset shaped so `videoJobs()` (kind==='video') renders a row. */
function queuedVideoAsset(model: string, prompt: string): Record<string, unknown> {
  return {
    id: `vid-job-${Date.now()}`,
    name: prompt.slice(0, 40) || 'Untitled video',
    kind: 'video',
    source: model === 'veo' ? 'veo' : 'sora',
    status: 'queued',
    url: '',
    created_at: new Date().toISOString(),
  };
}

/**
 * Stub the media APIs the Video Studio touches. MUST be registered AFTER
 * signInAsTestUser so these more-specific routes win over the helper's benign
 * catch-all (Playwright matches in reverse registration order). Returns the
 * captured generate-POST bodies for assertion.
 */
async function stubMediaApis(page: Page, model = 'sora'): Promise<{ calls: string[] }> {
  const calls: string[] = [];

  // Assets list — start empty so the "no video jobs yet" empty state shows first.
  // glob-ok: query-suffix only (/api/media/assets?…); the ':id' subresources fall
  // to the helper catch-all. Mid-token ** cannot cross '/'.
  await page.route('**/api/media/assets**', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  const generateStub = async (route: Route) => {
    const body = (await route.request().postDataJSON().catch(() => ({}))) as {
      prompt?: string;
      model?: string;
    };
    calls.push(JSON.stringify(body));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: queuedVideoAsset(body.model ?? model, body.prompt ?? '') }),
    });
  };
  // The REAL worker route is POST /api/media/generate/video. Register the exact
  // path AND its '/**' twin: the base glob '**/api/media/generate/video' matches
  // the leaf, and the twin covers any trailing segment (mid-token ** can't cross
  // '/', per glob-law).
  await page.route('**/api/media/generate/video', generateStub);
  await page.route('**/api/media/generate/video/**', generateStub);

  return { calls };
}

/** Collect blocking console errors (filtered for third-party noise). */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (
      t.includes('posthog') ||
      t.includes('sentry') ||
      t.includes('favicon') ||
      t.includes('extension') ||
      t.toLowerCase().includes('failed to load resource')
    ) {
      return;
    }
    errors.push(t);
  });
  return errors;
}

/**
 * Navigate to the Video Studio via the bookmarkable deep link `/admin/media?tab=video`.
 * The session was injected by signInAsTestUser before the SPA booted, so the auth
 * guard allows the route; the component reads `?tab=video` at construction.
 */
async function gotoVideoStudio(page: Page): Promise<void> {
  await page.goto(`${BASE}/admin/media?tab=video`, {
    waitUntil: 'domcontentloaded',
    timeout: 25_000,
  });

  const url = page.url();
  if (url.includes('/signin') || url.includes('/login')) {
    throw new Error(`Auth guard redirected to ${url} — session injection failed.`);
  }

  await page.waitForSelector('[data-testid="video-studio-panel"]', {
    state: 'visible',
    timeout: 20_000,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Media ▸ Video Studio', () => {
  test('VID-01 panel mounts with Sora/Veo model toggle + async queue notice', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    await stubMediaApis(page);

    await gotoVideoStudio(page);
    await page.screenshot({ path: 'e2e/screenshots/media-video-studio/01-panel.png' });

    await expect(page.locator('[data-testid="video-model-sora"]')).toBeVisible();
    await expect(page.locator('[data-testid="video-model-veo"]')).toBeVisible();
    await expect(page.locator('[data-testid="video-queue-notice"]')).toBeVisible();
    await expect(page.locator('[data-testid="video-jobs-empty"]')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('VID-02 valid prompt → Generate queues a job row with a status chip', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    const { calls } = await stubMediaApis(page, 'sora');

    await gotoVideoStudio(page);

    const prompt = page.locator('[data-testid="video-studio-prompt"]');
    await prompt.click();
    await prompt.fill('aerial view of a misty mountain sunrise timelapse, cinematic');
    await page.screenshot({ path: 'e2e/screenshots/media-video-studio/02-prompt.png' });

    const generate = page.locator('[data-testid="video-studio-generate"]');
    await expect(generate).toBeEnabled();
    await generate.click();

    // The queued asset (kind:'video') the stub returned is prepended to assets()
    // → videoJobs() renders one row with its status chip.
    const row = page.locator('[data-testid="video-job-row"]').first();
    await expect(row).toBeVisible({ timeout: 12_000 });
    await expect(row).toHaveAttribute('data-status', 'queued');
    await expect(page.locator('[data-testid="video-model-chip"]').first()).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/media-video-studio/03-queued.png' });

    // The POST fired with the prompt + model in its body.
    expect(calls.length, 'generate POST fired').toBeGreaterThan(0);
    const posted = JSON.parse(calls[0]) as { prompt?: string; model?: string };
    expect(posted.prompt).toContain('misty mountain sunrise');
    expect(posted.model).toBe('sora');

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('VID-03 selecting Veo before Generate posts model=veo', async ({ page }) => {
    await signInAsTestUser(page);
    const { calls } = await stubMediaApis(page, 'veo');

    await gotoVideoStudio(page);

    await page.locator('[data-testid="video-model-veo"]').click();
    await expect(page.locator('[data-testid="video-model-veo"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.locator('[data-testid="video-studio-prompt"]').fill(
      'slow-motion ocean waves crashing at sunset',
    );
    await page.locator('[data-testid="video-studio-generate"]').click();

    await expect(page.locator('[data-testid="video-job-row"]').first()).toBeVisible({
      timeout: 12_000,
    });
    const posted = JSON.parse(calls[0]) as { model?: string };
    expect(posted.model).toBe('veo');
  });

  // ─── Value-domain coverage on the prompt input ──────────────────────────────

  test('VID-VD valid / empty / overlong-2000 / injection prompt classes', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    await stubMediaApis(page);

    await gotoVideoStudio(page);

    const prompt = page.locator('[data-testid="video-studio-prompt"]');
    const generate = page.locator('[data-testid="video-studio-generate"]');

    // (1) EMPTY → Generate disabled (guarded by `!videoPrompt.trim()`).
    await prompt.fill('');
    await expect(generate, 'empty prompt disables Generate').toBeDisabled();

    // (2) WHITESPACE-ONLY → still disabled (trim guard).
    await prompt.fill('    ');
    await expect(generate, 'whitespace prompt disables Generate').toBeDisabled();

    // (3) VALID → enabled.
    await prompt.fill('a serene forest clearing at golden hour');
    await expect(generate, 'valid prompt enables Generate').toBeEnabled();

    // (4) OVERLONG-2000 → maxlength=2000 clamps the DOM value; input never crashes.
    const overlong = 'x'.repeat(2500);
    await prompt.fill(overlong);
    const clamped = await prompt.inputValue();
    expect(clamped.length, 'maxlength=2000 clamps the value').toBeLessThanOrEqual(2000);
    await expect(generate, 'clamped-but-nonempty prompt stays enabled').toBeEnabled();

    // (5) INJECTION-SHAPED → inert text, no dialog, no XSS execution.
    await prompt.fill('<script>window.__VID_XSS__=1</script>');
    const ran = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__VID_XSS__ === 1,
    );
    expect(ran, 'injection text must not execute').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/media-video-studio/04-value-domains.png' });
    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });

  // ─── Breakpoint smoke ───────────────────────────────────────────────────────

  for (const vp of BREAKPOINTS) {
    test(`VID-BP Video Studio renders at ${vp.width}×${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await signInAsTestUser(page);
      await stubMediaApis(page);

      await gotoVideoStudio(page);

      await page.screenshot({ path: `e2e/screenshots/media-video-studio/bp-${vp.width}.png` });

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth, 'no horizontal overflow').toBeLessThanOrEqual(vp.width + 2);
    });
  }
});
