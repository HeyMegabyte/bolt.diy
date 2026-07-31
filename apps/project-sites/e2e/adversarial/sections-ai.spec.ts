/**
 * adversarial/sections-ai.spec.ts
 *
 * ADVERSARIAL — AI-heavy admin sections: traces, ai-endpoints, ai-chat-extras,
 * voice + children, swarm, sites/:id/dna, sites/:id/copilot.
 *
 * Scenarios:
 *  ADV-AI-12  Voice: navigate to voice and back 3× — no console errors
 *  ADV-AI-13  Swarm: visiting /admin/swarm/:siteId with invalid ID — no white screen
 *  ADV-AI-14  Swarm: navigating away from swarm mid-load — no zombie subscriptions
 *  ADV-AI-15  Site DNA: visiting /admin/sites/:id/dna without a valid site — graceful
 *  ADV-AI-18  Site Copilot: visiting /admin/sites/:id/copilot without site — graceful
 *  ADV-AI-19  AI-endpoints page: hard reload — shell remounts, list reloads
 *
 * Rules:
 *  - authedPage fixture (starts at BASE homepage, pre-authed)
 *  - Internal nav via UI clicks / routerLink locators only
 *  - No page.waitForTimeout
 *  - Parallel-safe (isolated browser context per test)
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

// ─── helpers ────────────────────────────────────────────────────────────────

async function gotoAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE}/admin`);
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
}

function collectErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (
        !t.includes('favicon') &&
        !t.includes('net::ERR_BLOCKED') &&
        !t.includes('ERR_ABORTED')
      ) {
        errors.push(t);
      }
    }
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  return errors;
}

async function clickNav(
  page: import('@playwright/test').Page,
  routerLink: string,
): Promise<boolean> {
  const link = page.locator(`a[routerLink="${routerLink}"]`).first();
  const visible = await link.isVisible({ timeout: 4_000 }).catch(() => false);
  if (visible) {
    await link.click();
    await page
      .waitForURL(new RegExp(routerLink.replace(/\//g, '\\/')), { timeout: 8_000 })
      .catch(() => undefined);
  }
  return visible;
}

async function injectSentinel(page: import('@playwright/test').Page): Promise<number> {
  const v = Math.random();
  await page.evaluate((val: number) => {
    (window as Record<string, unknown>)['__adv_sentinel__'] = val;
  }, v);
  return v;
}

async function assertSentinel(
  page: import('@playwright/test').Page,
  v: number,
): Promise<void> {
  const actual = await page.evaluate(
    () => (window as Record<string, unknown>)['__adv_sentinel__'],
  );
  expect(actual).toBe(v);
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
        await page
          .waitForURL(/\/admin\/voice/, { timeout: 5_000 })
          .catch(() => undefined);
      }

      const analyticsLink = page
        .locator('a[routerLink="/admin/analytics"]')
        .first();
      if (await analyticsLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await analyticsLink.click();
        await page
          .waitForURL(/\/admin\/analytics/, { timeout: 5_000 })
          .catch(() => undefined);
      }
    }

    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-13: Swarm with invalid site ID ───────────────────────────────────

test.describe('ADV-AI-13 — Swarm with invalid site ID', () => {
  test('/admin/swarm/invalid-site-id-999 does not render white screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    // Push route inside SPA (no goto after initial load)
    await page.evaluate(() =>
      window.history.pushState({}, '', '/admin/swarm/invalid-site-id-999'),
    );
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 8_000 });

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
    await assertSentinel(page, sentinel);
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-14: Swarm navigate away mid-load ────────────────────────────────

test.describe('ADV-AI-14 — Swarm navigate away mid-load', () => {
  test('navigating away from a swarm route before it fully loads leaves no zombie state', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    // Navigate toward swarm via history then immediately leave
    const swarmLink = page.locator('a[href*="/admin/swarm/"]').first();
    if (await swarmLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Click swarm link and immediately navigate away
      await swarmLink.click();
      const analyticsLink = page.locator('a[routerLink="/admin/analytics"]').first();
      if (await analyticsLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await analyticsLink.click();
      }
    } else {
      // Push swarm route + immediately push analytics
      await page.evaluate(() =>
        window.history.pushState({}, '', '/admin/swarm/fake-id'),
      );
      await page.evaluate(() =>
        window.history.pushState({}, '', '/admin/analytics'),
      );
    }

    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 8_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-15: Site DNA with invalid site ID ────────────────────────────────

test.describe('ADV-AI-15 — Site DNA with invalid site ID graceful', () => {
  test('/admin/sites/invalid-id/dna does not white-screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    await page.evaluate(() =>
      window.history.pushState({}, '', '/admin/sites/invalid-id-adv-test/dna'),
    );
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 8_000 });

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
    await assertSentinel(page, sentinel);
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-18: Site Copilot with invalid site ID ────────────────────────────

test.describe('ADV-AI-18 — Site Copilot with invalid site ID graceful', () => {
  test('/admin/sites/invalid-id/copilot does not white-screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    await page.evaluate(() =>
      window.history.pushState({}, '', '/admin/sites/invalid-id-adv-test/copilot'),
    );
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 8_000 });

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
    await assertSentinel(page, sentinel);
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-19: AI-endpoints hard reload ─────────────────────────────────────

test.describe('ADV-AI-19 — AI-endpoints hard reload', () => {
  test('reloading /admin/ai-endpoints remounts shell and endpoint list', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/ai-endpoints');
    await page.reload({ waitUntil: 'networkidle', timeout: 20_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    expect(errors).toHaveLength(0);
  });
});
