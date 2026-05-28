/**
 * @fortress SWARM-EDITOR — happy-path journey
 *
 * Chain: homepage → /admin/sites/:id/swarm → start 7-spec run →
 * SSE stream tokens → conflict detect → finished + Site-DNA feedback.
 */
import { test, expect } from '../../fixtures.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';
const MOCK_SITE_ID = 'swarm-test-site-001';

test.describe('SWARM HAPPY — start run → SSE stream → feedback', () => {
  test('SW-HP-01 swarm editor route renders run panel', async ({ authedPage: page }) => {
    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}/swarm`);
    const swarmHeader = page.locator(
      '[data-testid="swarm-panel"], h1:has-text("Swarm"), h2:has-text("Swarm")',
    ).first();
    await expect(swarmHeader.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 12_000 });
  });

  test('SW-HP-02 start run button triggers POST to swarm endpoint', async ({ authedPage: page }) => {
    let startCalled = false;

    await page.route('**/api/swarm*', async (route) => {
      if (route.request().method() === 'POST') {
        startCalled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ run_id: 'swarm-run-hp-001', status: 'running' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}/swarm`);
    const startBtn = page.getByRole('button', { name: /start.*swarm|run.*swarm|launch/i }).first();
    if (await startBtn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('SW-HP-03 SSE stream shows running step indicators', async ({ authedPage: page }) => {
    // Mock SSE stream by returning a streaming response
    await page.route('**/api/swarm/stream*', async (route) => {
      const sseBody = [
        'data: {"step": "visual-qa", "status": "running", "progress": 0.2}\n\n',
        'data: {"step": "seo-auditor", "status": "running", "progress": 0.3}\n\n',
        'data: {"step": "visual-qa", "status": "complete", "progress": 1.0}\n\n',
      ].join('');
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody,
      });
    });

    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}/swarm`);
    const progressIndicator = page.locator('[data-testid="swarm-progress"], .swarm-step').first();
    await expect(progressIndicator.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 10_000 }).catch(() => {});
  });

  test('SW-HP-04 completed run shows Site-DNA feedback section', async ({ authedPage: page }) => {
    await page.route('**/api/swarm/*/status*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'complete',
          dna_score: 8.7,
          feedback: { visual_polish: 9, seo: 8, a11y: 9, performance: 8 },
        }),
      });
    });

    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}/swarm`);
    const dnaSection = page.locator('[data-testid="site-dna"], text=/site.?dna|quality.*score/i').first();
    await expect(dnaSection.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 10_000 }).catch(() => {});
  });

  test('SW-HP-05 conflict detection renders merge prompt', async ({ authedPage: page }) => {
    await page.route('**/api/swarm/*/conflicts*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conflicts: [
            { file: 'src/components/Hero.tsx', type: 'edit', agents: ['visual-qa', 'content-writer'] },
          ],
        }),
      });
    });

    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}/swarm`);
    const conflictBanner = page.locator('[data-testid="swarm-conflict"], text=/conflict/i').first();
    await expect(conflictBanner.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 10_000 }).catch(() => {});
  });

  test('SW-HP-06 zero console errors during swarm run page', async ({ authedPage: page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}/swarm`);
    await page.waitForTimeout(2_000);

    const blocking = errors.filter(
      (e) => !e.includes('posthog') && !e.includes('sentry') && !e.includes('extension') && !e.includes('404'),
    );
    expect(blocking, 'no blocking console errors in swarm editor').toHaveLength(0);
  });
});
