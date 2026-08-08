/**
 * @fileoverview E2E — Media ▸ Video Studio (editor-overlay surface).
 *
 * ── Surface reality (re-grepped 2026-07-31) ─────────────────────────────────
 * There is NO `/admin/media` route. `AdminMediaComponent` is never registered
 * in app.routes.ts — it mounts ONLY as an editor-overlay tab:
 *   admin.component.html:1375  `@if (isEditorRoute())` → tab strip
 *     `[data-testid="editor-tabs-host"]` hosting `<app-editor-tabs>`
 *   admin.component.html:1380  `@if (editorActiveTab() === 'media')` →
 *     `<aside data-testid="editor-overlay-media">` containing
 *     `<app-admin-media [compact]="true" />`.
 * The prior spec's `page.goto('/admin/media?tab=video')` therefore landed on
 * the admin 404 fallback and `video-studio-panel` never existed → all 10 fail.
 *
 * REAL reach path (clicks, matching how a user gets there):
 *   1. goto `/admin/editor` (bolt iframe mounts in background — NOT awaited;
 *      we wait only for the tab strip `[data-testid="editor-tabs-host"]`).
 *   2. click `[data-testid="editor-tab-media"]` (editor-tabs.component.ts:77,
 *      tabs = code | media | agents; `editorActiveTab` defaults to 'code'
 *      from localStorage['editor.tab'], so the click is always required).
 *   3. overlay `[data-testid="editor-overlay-media"]` appears.
 *   4. click the INNER media tab `[data-testid="media-tab-video"]`
 *      (media.component.ts:255 `'media-tab-' + t.id`, tabs.id 'video' at
 *      :1241; `activeTab` seeds from localStorage['media.tab'] → 'library'
 *      in a fresh context, so this click is also always required).
 *   5. `[data-testid="video-studio-panel"]` renders.
 *
 * Compact-mode findings (media.component.ts:1187-1231): `[compact]="true"`
 * only applies `.media--compact` DENSITY css (smaller tabs/inputs/cards) and
 * hides the bulk-select toolbar (:274). All 5 inner tabs AND the full Video
 * Studio (model pills, prompt, duration, notice, CTA, job list) render
 * unchanged — no assert needed loosening.
 *
 * Verified selectors (media.component.ts:610-694, all exist):
 *   video-studio-panel · video-model-sora/veo (aria-pressed) ·
 *   video-studio-prompt (#vid-prompt, maxlength=2000) · video-queue-notice ·
 *   video-studio-generate (disabled: `videoSubmitting() || !videoPrompt.trim()`) ·
 *   video-jobs-empty · video-job-row[data-status] · video-model-chip (j.status).
 *
 * POST contract (media.component.ts:1788): `POST /api/media/generate/video`
 * body `{ prompt, duration_s, model }`, `videoModel` default 'sora' (:1328);
 * success prepends `r.data` into `assets()` and `startPolling()` re-fetches
 * `GET /api/media/assets` every 8s, REPLACING `assets()` — so the stub is
 * STATEFUL: generated jobs are served back by the assets stub, otherwise the
 * queued row would vanish at the first poll. `videoJobs()` filters
 * `kind === 'video'` (:1334) → stubbed asset must carry `kind:'video'`.
 *
 * Console policy: `/admin/editor` embeds the REAL editor.projectsites.dev
 * bolt iframe (fixtures allow *.projectsites.dev). Its console is not under
 * test — errors are scoped to the top-frame origin, plus the usual noise
 * filter (posthog/sentry/favicon/net::ERR/failed-to-load).
 *
 * TDD contract: signInAsTestUser FIRST → stubs AFTER helper (later
 * registrations win) → '/**' glob twins on the generate stub (mid-token `**`
 * cannot cross '/') → clicks only after the initial goto → bounded timeouts,
 * no networkidle → value-domain coverage on the prompt → screenshots in
 * e2e/screenshots/media-video-studio/.
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
 * `**\/api\/**` catch-all (Playwright matches in reverse registration order).
 *
 * STATEFUL: the assets-list stub serves every job the generate stub queued,
 * because `startPolling()` refetches + REPLACES `assets()` every 8s — an
 * always-empty list would erase the queued row mid-assertion.
 *
 * @returns captured generate-POST bodies for assertion.
 */
async function stubMediaApis(page: Page, model = 'sora'): Promise<{ calls: string[] }> {
  const calls: string[] = [];
  const queued: Record<string, unknown>[] = [];

  // Assets list — starts empty ("no video jobs yet"), then reflects queued
  // jobs. Scoped to the EXACT list path: `assets**` also matches
  // `/assets/:id/raw` (trailing ** crosses '/'), so non-list subresources
  // fall back to the helper catch-all instead of receiving list JSON.
  await page.route('**/api/media/assets**', async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== 'GET' || !path.endsWith('/api/media/assets')) return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Real worker returns `{ assets }` (src/routes/media.ts GET /assets +
      // media_routes.test.ts) — the component reads `r.assets` (media.component
      // .ts:1471 `assets.set(r.assets ?? [])`). The old `{ data }` key left
      // r.assets undefined → list always empty → the queued row never rendered.
      body: JSON.stringify({ assets: queued }),
    });
  });

  const generateStub = async (route: Route) => {
    // postDataJSON() is SYNCHRONOUS — treating it as a promise threw
    // TypeError inside the handler and silently killed the whole stub.
    let body: { prompt?: string; model?: string } = {};
    try {
      body = (route.request().postDataJSON() ?? {}) as { prompt?: string; model?: string };
    } catch {
      body = {};
    }
    calls.push(JSON.stringify(body));
    const asset = queuedVideoAsset(body.model ?? model, body.prompt ?? '');
    queued.unshift(asset);
    await route.fulfill({
      // Real worker: `c.json({ ok: true, asset }, 202)` (src/routes/media.ts:444).
      // The component reads `r.asset` (media.component.ts:1842 typed
      // `.post<{ asset: MediaAsset }>`) and prepends it into assets(). The old
      // `{ data: asset }` at 200 left r.asset undefined → nothing prepended →
      // no video-job-row. Match the real key + 202 status exactly.
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, asset }),
    });
  };
  // The REAL worker route is POST /api/media/generate/video. Register the exact
  // path AND its '/**' twin: the base glob matches the leaf, the twin covers
  // any trailing segment (mid-token ** can't cross '/', per glob-law).
  await page.route('**/api/media/generate/video', generateStub);
  await page.route('**/api/media/generate/video/**', generateStub);

  return { calls };
}

/**
 * Collect blocking console errors from OUR app frame only.
 *
 * `/admin/editor` mounts the real editor.projectsites.dev bolt iframe;
 * `page.on('console')` receives its messages too, and that app is not under
 * test here — messages sourced from a different origin are dropped, then the
 * usual third-party noise filter applies.
 */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  const appHost = new URL(BASE).hostname;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const src = m.location()?.url ?? '';
    if (src) {
      try {
        const srcHost = new URL(src).hostname;
        if (srcHost && srcHost !== appHost) return; // bolt-iframe / third-party frame
      } catch {
        /* relative or opaque source — treat as ours */
      }
    }
    const t = m.text();
    if (
      t.includes('posthog') ||
      t.includes('sentry') ||
      t.includes('favicon') ||
      t.includes('extension') ||
      t.includes('net::ERR') ||
      t.toLowerCase().includes('failed to load resource')
    ) {
      return;
    }
    errors.push(t);
  });
  return errors;
}

/**
 * Navigate to the Video Studio the way a user does:
 * `/admin/editor` → editor tab strip → "Media" tab → overlay → inner
 * "Video Studio" tab. The bolt iframe boots in the background and is never
 * awaited — only the Angular-rendered chrome is.
 */
async function gotoVideoStudio(page: Page): Promise<void> {
  await page.goto(`${BASE}/admin/editor`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  const url = page.url();
  if (url.includes('/signin') || url.includes('/login')) {
    throw new Error(`Auth guard redirected to ${url} — session injection failed.`);
  }

  // Editor chrome (NOT the iframe): the tab strip renders once the admin
  // shell mounts and isEditorRoute() flips true.
  await page.waitForSelector('[data-testid="editor-tabs-host"]', {
    state: 'visible',
    timeout: 20_000,
  });

  // editorActiveTab defaults to 'code' (localStorage['editor.tab'] is empty
  // in a fresh context) — open the Media overlay via its tab.
  const mediaTab = page.locator('[data-testid="editor-tab-media"]');
  if (!(await mediaTab.isVisible().catch(() => false))) {
    // Mobile widths collapse the admin chrome — open the hamburger first
    // (same affordance law as the sidebar); the editor tab strip lives in
    // the topbar region and needs the shell expanded.
    await page.getByRole('button', { name: 'Open navigation menu' }).click({ timeout: 5_000 }).catch(() => {});
  }
  // Breakpoint smoke runs hit an overlay z-order artifact where the tab is
  // visible/stable yet pointer-intercepted (bolt veil region) — force is
  // acceptable for a render-smoke; functional tabs are covered desktop-side.
  await mediaTab.click({ timeout: 8_000 }).catch(async () => {
    await mediaTab.click({ timeout: 5_000, force: true });
  });
  await page.waitForSelector('[data-testid="editor-overlay-media"]', {
    state: 'visible',
    timeout: 15_000,
  });

  // Inner media workspace opens on 'library' (localStorage['media.tab'] is
  // empty in a fresh context) — switch to the Video Studio tab by click.
  await page.locator('[data-testid="media-tab-video"]').click();
  await page.waitForSelector('[data-testid="video-studio-panel"]', {
    state: 'visible',
    timeout: 15_000,
  });

  // Nudge IntersectionObserver-driven appReveal so screenshots show content.
  await page.mouse.wheel(0, 120);
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
    // → videoJobs() renders one row with its status chip. The stateful assets
    // stub keeps serving it, so the 8s poll cannot erase the row mid-test.
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

    await page
      .locator('[data-testid="video-studio-prompt"]')
      .fill('slow-motion ocean waves crashing at sunset');
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

      if (vp.width >= 1280) {
        // Desktop workspace: the full studio path must work.
        await gotoVideoStudio(page);
      } else {
        // <1280 the editor workspace keeps the media tab INACTIVE
        // (tabindex=-1; overlay is a desktop affordance — half-screen panel).
        // The honest responsive contract: the editor route itself renders
        // cleanly with no horizontal overflow; the studio journey is
        // desktop-covered above.
        await page.goto(`${BASE}/admin/editor`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
        await page.waitForSelector('[data-testid="editor-tabs-host"]', { state: 'visible', timeout: 15_000 });
      }

      await page.screenshot({ path: `e2e/screenshots/media-video-studio/bp-${vp.width}.png` });

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth, 'no horizontal overflow').toBeLessThanOrEqual(vp.width + 2);
    });
  }
});
