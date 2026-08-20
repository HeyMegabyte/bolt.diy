/**
 * CHAOS 18 — "The Builder's Journey": real template build → live site →
 * analytics reconcile → editor change through the deploy bridge.
 *
 * THE mandatory acceptance journey (Brian 2026-08-19). Prior loop fires never
 * reconciled a REAL build end-to-end — that gap let the site-generation
 * pipeline stay dead for ~5 weeks (SITE_BUILDER binding commented out by a
 * catalog sweep) and let the editor deploy silently 401 (bolt never sent
 * PS_DEPLOY_REQUEST). This spec is the regression lock for that class:
 *
 *   1. POST /api/sites/e2e-site-3/reset → real template-first container build
 *   2. Poll GET /api/sites/e2e-site-3/workflow?instance_id=<from reset> until
 *      terminal (the reset response's workflow_instance_id — the suffixed one)
 *   3. The live site 200s with an <h1> + real content
 *   4. Analytics reconcile: GET /api/analytics/e2e-site-3 shows a visit made
 *      during the test (pageViews ≥ 1 for today, source first_party_edge)
 *   5. Editor: seedAuth → /admin/editor → bolt iframe → type a change →
 *      the deploy flows through the PS_DEPLOY_REQUEST admin bridge → the live
 *      site reflects the change
 *
 * Slow by design (build ~15 min). Run with the prod config:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test \
 *     --config=playwright.prod.config.ts chaos-18-template-build-journey \
 *     --project=chromium --workers=1
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';
const SITE_ID = 'e2e-site-3';
const SITE_URL = 'https://urban-fitness.projectsites.dev';

const BOLT_PROMPT_PLACEHOLDER = 'What are we shipping?';
const BOOT_TIMEOUT = 120_000;
const ANSWER_TIMEOUT = 90_000;

// The editor change marker — the bridge deploy must make it appear live.
const CHANGE_TOKEN = 'FRESH-FROM-THE-OVEN';

test.describe('CHAOS 18 — template build journey (keystone)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');

  test('build → publish → visit → analytics → editor change applies', async ({ page, request }) => {
    test.setTimeout(40 * 60_000); // the build is the long pole

    // ── Leg 1: trigger the real template-first build ──
    const reset = await request.post(
      `https://project-sites.manhattan.workers.dev/api/sites/${SITE_ID}/reset`,
      {
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        data: {
          business_name: 'Cedar Ridge Bakeshop',
          business_address: '12 Willow Lane, Bozeman, MT 59715',
          additional_context: 'Small-batch artisan bakery known for sourdough and seasonal pies. Open Tue-Sat.',
        },
      },
    );
    expect(reset.ok(), 'reset must trigger (BUILD_LIMIT_RETRY means another journey holds it)').toBe(true);
    const resetBody = (await reset.json()) as { data?: { workflow_instance_id?: string } };
    const instanceId = resetBody.data?.workflow_instance_id ?? SITE_ID;

    // ── Leg 2: wait for terminal via the CORRECT instance id ──
    // (the suffixed id — the bare siteId reports the stale errored instance.)
    let published = false;
    const deadline = Date.now() + 25 * 60_000;
    while (Date.now() < deadline && !published) {
      const wf = await request.get(
        `https://project-sites.manhattan.workers.dev/api/sites/${SITE_ID}/workflow?instance_id=${instanceId}`,
        { headers: { Authorization: `Bearer ${KEY}` } },
      );
      const wfBody = (await wf.json()) as { data?: { workflow_status?: string; workflow_error?: string | null; site_status?: string } };
      const status = wfBody.data?.workflow_status;
      const siteStatus = wfBody.data?.site_status;
      if (status === 'complete' && siteStatus === 'published') {
        published = true;
        break;
      }
      if (status === 'errored' || siteStatus === 'error') {
        throw new Error(`Build failed: ${wfBody.data?.workflow_error ?? 'unknown'}`);
      }
      await new Promise((r) => setTimeout(r, 30_000));
    }
    expect(published, 'build must reach published within 25 min').toBe(true);

    // ── Leg 3: the live site serves real content ──
    const site = await request.get(SITE_URL);
    expect(site.ok()).toBe(true);
    const html = await site.text();
    expect(html).toContain('<h1');

    // ── Leg 4: analytics reconciliation — the visit just made must register ──
    const analytics = await request.get(
      `https://project-sites.manhattan.workers.dev/api/analytics/${SITE_ID}`,
      { headers: { Authorization: `Bearer ${KEY}` } },
    );
    expect(analytics.ok()).toBe(true);
    const analyticsBody = (await analytics.json()) as { data?: { stats?: { pageViews?: number }; source?: string } };
    expect(analyticsBody.data?.source).toBe('first_party_edge');
    expect(analyticsBody.data?.stats?.pageViews ?? 0, 'the visit must appear in the analytics surface').toBeGreaterThan(0);

    // ── Leg 5: editor change through the PS_DEPLOY_REQUEST bridge ──
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/editor', { waitUntil: 'domcontentloaded' });
    // PIN the site — selectedSite is in-memory and floats across the org's
    // sites; without the pin the editor iframe loads a DIFFERENT site
    // (lakeside-dental with a stale export) while the bridge publishes
    // e2e-site-3 (journey 2026-08-20 — the materialization guard failed on
    // the wrong site's files, not on the import).
    const siteSel = page.locator('[aria-label="Select site"]');
    await expect(siteSel).toBeVisible({ timeout: 15_000 });
    const currentSel = (await siteSel.textContent())?.trim() ?? '';
    if (!currentSel.includes('Cedar Ridge')) {
      await siteSel.click();
      const opt = page
        .locator('[role="option"]')
        .filter({ hasText: 'Cedar Ridge Bakeshop' })
        .first();
      await expect(opt).toBeVisible();
      await opt.click();
      await page.keyboard.press('Escape');
    }
    const frame = page.frameLocator('iframe[src*="editor.projectsites.dev"]').first();
    const chatBox = frame.locator(`textarea[placeholder="${BOLT_PROMPT_PLACEHOLDER}"]`);
    await expect(chatBox, `bolt chat input never appeared (WebContainer boot ${BOOT_TIMEOUT / 1000}s)`).toBeVisible({
      timeout: BOOT_TIMEOUT,
    });

    // Materialization guard (iter 214): the imported build files must land in
    // the workbench — the Files tree renders the site's index.html. Before
    // the sessionStorage stash + setVirtualFile restore, the tree was empty
    // and Save & Deploy published zero files.
    await expect
      .poll(
        async () => {
          const text = await frame.locator('body').innerText();
          return text.includes('index.html') || text.includes('assets/');
        },
        { timeout: 120_000, message: 'imported site files never materialized in the editor workbench' },
      )
      .toBe(true);

    await chatBox.fill(`Change the hero headline to include the exact phrase ${CHANGE_TOKEN}. Deploy it.`);
    await chatBox.press('Enter');
    // The answer streams (~40-70s). The deploy does NOT fire from the chat
    // alone — the real user path is Actions → Save & Deploy, which emits
    // PS_REQUEST_FILES → the editor replies PS_FILES_READY → the admin POSTs
    // publish-bolt (the bridge). Click it AFTER the answer lands.
    await expect(frame.locator('text=Response Generated').first()).toBeVisible({
      timeout: 120_000,
    });
    await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, span')];
      const t = els.find((x) => x.textContent?.trim() === 'Actions' && x.tagName === 'SPAN');
      (t?.closest('button') || t?.parentElement)?.click();
    });
    await page.waitForTimeout(800);
    const deployClicked = await page.evaluate(() => {
      const els = [...document.querySelectorAll('[role="menuitem"], button, div, span')];
      // The menu item flips to "Publishing…" (disabled) the instant the
      // bridge fires — locate by EITHER label; a found-but-publishing state
      // means the click already landed and the publish is in flight.
      const t = els.find(
        (x) =>
          ['Save & Deploy', 'Publishing…'].includes(x.textContent?.trim() ?? ''),
      );
      if (!t) return 'missing';
      const btn = t.closest('button') || t.closest('[role="menuitem"]') || t;
      const label = t.textContent?.trim() ?? '';
      if (label === 'Save & Deploy') {
        (btn as HTMLElement).click();
        return 'clicked';
      }
      return 'already-publishing';
    });
    expect(['clicked', 'already-publishing'], 'Save & Deploy fired').toContain(deployClicked);
    // The publish flows through the admin bridge (PS_REQUEST_FILES →
    // PS_FILES_READY → POST publish-bolt). Poll the LIVE site for the marker.
    await expect
      .poll(
        async () => {
          // Cache-buster: the site serves with edge cache headers — a plain
          // GET re-reads a STALE cached response for the whole poll window
          // even after the publish lands (journey 2026-08-20: the marker was
          // live in seconds via curl?cb=N while the poll timed out).
          const res = await request.get(`${SITE_URL}?cb=${Date.now()}`);
          return (await res.text()).includes(CHANGE_TOKEN);
        },
        { timeout: 15 * 60_000, message: 'editor change never reached the live site via the bridge' },
      )
      .toBe(true);

    await assertAlive(page);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
  });
});
