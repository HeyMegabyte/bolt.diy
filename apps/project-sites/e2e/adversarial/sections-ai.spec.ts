/**
 * adversarial/sections-ai.spec.ts
 *
 * ADVERSARIAL — AI-heavy admin sections (modernized 2026-07-31): voice,
 * swarm, sites/:id/dna, sites/:id/copilot.
 *
 * Scenarios:
 *  ADV-AI-12  Voice: navigate to voice and back 3× — no console errors
 *  ADV-AI-13  Swarm: /admin/swarm/:siteId with invalid ID — no white screen
 *  ADV-AI-14  Swarm: navigating away from swarm mid-load — no zombie state
 *  ADV-AI-15  Site DNA: /admin/sites/:id/dna without a valid site — graceful
 *  ADV-AI-18  Site Copilot: /admin/sites/:id/copilot without site — graceful
 *
 * Modernization notes:
 *  - networkidle NEVER settles on this app — domcontentloaded + locator waits.
 *  - window.history.pushState never drives the Angular router — the old
 *    pushState probes asserted vacuously. Replaced with real deep-link
 *    goto() entries (house pattern per e2e/admin/mcp.spec.ts; the authed
 *    context's init script + route stubs persist across navigations).
 *  - ADV-AI-19 RETIRED: /admin/ai-endpoints route no longer exists —
 *    AdminAiEndpointsComponent is now an editor-overlay surface imported by
 *    the admin shell, with no standalone route in app.routes.ts.
 *
 * Rules:
 *  - authedPage fixture: signInAsTestUser + catch-all /api/** stubs run
 *    BEFORE any /admin navigation — authed GETs never reach prod.
 *  - Internal nav via UI clicks; goto only for initial load + deep-links.
 *  - No page.waitForTimeout. Parallel-safe (isolated context per test).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev'; // localhost:8787 fallback sent the whole suite to a stray dev server ("governor" page)

// ─── helpers ────────────────────────────────────────────────────────────────

async function gotoAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
}

function collectErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      const lower = t.toLowerCase();
      if (
        !lower.includes('favicon') &&
        !lower.includes('failed to load resource') &&
        !t.includes('net::ERR_BLOCKED') &&
        !t.includes('ERR_ABORTED') &&
        !t.includes('ERR_FAILED')
      ) {
        errors.push(t);
      }
    }
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  return errors;
}

async function injectSentinel(page: import('@playwright/test').Page): Promise<number> {
  const v = Math.random();
  await page.evaluate((val: number) => {
    (window as unknown as Record<string, unknown>)['__adv_sentinel__'] = val;
  }, v);
  return v;
}

async function assertSentinel(
  page: import('@playwright/test').Page,
  v: number,
): Promise<void> {
  const actual = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__adv_sentinel__'],
  );
  expect(actual).toBe(v);
}

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page
    .screenshot({ path: `e2e/screenshots/adversarial/${name}.png`, fullPage: false })
    .catch(() => undefined);
}

// ─── ADV-AI-12: Voice navigate back-and-forth 3× ────────────────────────────

test.describe('ADV-AI-12 — Voice navigate back-and-forth 3×', () => {
  test('navigating to /admin/voice and away 3× produces no console errors', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    for (let i = 0; i < 3; i++) {
      const voiceLink = page.locator('a[routerLink="/admin/voice"]').first();
      if (await voiceLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await voiceLink.click();
        await page.waitForURL(/\/admin\/voice/, { timeout: 5_000 }).catch(() => undefined);
      }

      const analyticsLink = page.locator('a[routerLink="/admin/analytics"]').first();
      if (await analyticsLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await analyticsLink.click();
        await page.waitForURL(/\/admin\/analytics/, { timeout: 5_000 }).catch(() => undefined);
      }
    }

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    await shot(page, 'ai-12-voice-thrash');
    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-13: Swarm with invalid site ID ──────────────────────────────────

test.describe('ADV-AI-13 — Swarm with invalid site ID', () => {
  test('/admin/swarm/invalid-site-id-999 does not render white screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);

    // Real deep-link navigation (route exists: swarm/:siteId)
    await page.goto(`${BASE}/admin/swarm/invalid-site-id-999`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
    await shot(page, 'ai-13-swarm-invalid-id');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-14: Swarm navigate away mid-load ────────────────────────────────

test.describe('ADV-AI-14 — Swarm navigate away mid-load', () => {
  test('leaving a swarm route before it fully loads leaves no zombie state', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);

    // Deep-link into swarm, then IMMEDIATELY click away via the sidebar
    // while the section is still lazy-loading.
    await page.goto(`${BASE}/admin/swarm/e2e-site-001`, {
      waitUntil: 'commit',
    });
    const sentinel = await injectSentinel(page);

    const analyticsLink = page.locator('a[routerLink="/admin/analytics"]').first();
    if (await analyticsLink.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await analyticsLink.click();
      await page.waitForURL(/\/admin\/analytics/, { timeout: 8_000 }).catch(() => undefined);
    }

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    // Sentinel survival proves the click-away was SPA routing, not a reload
    await assertSentinel(page, sentinel);
    await shot(page, 'ai-14-swarm-bounce');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-15: Site DNA with invalid site ID ───────────────────────────────

test.describe('ADV-AI-15 — Site DNA with invalid site ID graceful', () => {
  test('/admin/sites/invalid-id/dna does not white-screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);

    await page.goto(`${BASE}/admin/sites/invalid-id-adv-test/dna`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
    await shot(page, 'ai-15-dna-invalid-id');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-18: Site Copilot with invalid site ID ───────────────────────────

test.describe('ADV-AI-18 — Site Copilot with invalid site ID graceful', () => {
  test('/admin/sites/invalid-id/copilot does not white-screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);

    await page.goto(`${BASE}/admin/sites/invalid-id-adv-test/copilot`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
    await shot(page, 'ai-18-copilot-invalid-id');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-19 — RETIRED 2026-07-31 ─────────────────────────────────────────
// /admin/ai-endpoints has no route in app.routes.ts anymore — the AI
// Endpoints surface became an editor-overlay component (AdminAiEndpointsComponent
// imported directly by admin.component.ts), so the "hard reload the
// /admin/ai-endpoints route" contract has no surface to exercise.
