import { test, expect, type Page } from '@playwright/test';

/**
 * `prefers-reduced-motion: reduce` guard (WCAG 2.3.3 — vestibular safety).
 *
 * The cockpit leans on motion (rolling counters, scroll reveals, pulsing
 * "live" dots, the provisioning status-pulse). The cinematic-ui mandate
 * requires every animation to gate on `prefers-reduced-motion` — but nothing
 * ENFORCED it. A new infinite pulse/spin that forgets the guard is a real
 * vestibular-safety regression that the desktop axe pass never catches.
 *
 * Contract: under reduced-motion, NO element runs an INFINITE animation
 * (continuous motion is the vestibular trigger; brief one-shot enters are
 * exempt). Covers the pulse-heavy routes: ai-logs (live-dot), apps
 * (provisioning status-pulse), analytics.
 *
 * Verified clean 2026-06-06; this locks it in.
 */

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

const ROUTES = ['/admin/ai-logs', '/admin/apps', '/admin/analytics', '/admin/feature-flags'];

test.describe('admin — prefers-reduced-motion (WCAG 2.3.3)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  for (const path of ROUTES) {
    test(`no infinite animation runs under reduced-motion — ${path}`, async ({ page }) => {
      test.setTimeout(45000);
      await seed(page);
      // emulateMedia is the proven pattern here (admin-reflow.e2e.ts) — set it
      // BEFORE navigation so the @media (prefers-reduced-motion) rules apply.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path, { waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar, nav').first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1500); // let any (wrongly-)scheduled loops start
      const offenders = await page.evaluate(() => {
        const bad: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
          const cs = getComputedStyle(el);
          const name = cs.animationName;
          if (!name || name === 'none') continue;
          if (cs.animationPlayState === 'paused') continue;
          // The vestibular trigger is CONTINUOUS motion — only infinite loops fail.
          if (cs.animationIterationCount !== 'infinite') continue;
          if ((parseFloat(cs.animationDuration) || 0) <= 0.05) continue;
          bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').slice(0, 3).join('.')} :: ${name}`);
        }
        return [...new Set(bad)].slice(0, 8);
      });
      expect(offenders, `infinite animations still run under reduced-motion (vestibular risk):\n${offenders.join('\n')}`).toEqual([]);
    });
  }
});
