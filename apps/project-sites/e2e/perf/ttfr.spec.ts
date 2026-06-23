/**
 * TTFR — Core Web Vitals budget gate (the REAL metric measurement for idea #14
 * "sub-100ms everything"). Distinct from allstar/c-cwv.spec.ts, which tests the
 * CWV *features* (publish gate, speculation rules, image pipeline). This measures
 * actual LCP/CLS/FCP on the LIVE marketing homepage under a throttled 3G + 6×-CPU
 * (mid-range-Android) profile per ttfr-north-star, and asserts the cinematic budget
 * so a CWV regression fails CI instead of silently shipping.
 *
 * Run: `npx playwright test e2e/perf/ttfr.spec.ts --config playwright.prod.config.ts`
 * (wired into playwright.prod.config.ts testMatch — runs against PROD_URL).
 */
import { test, expect } from '@playwright/test';

const PROD = process.env.PROD_URL ?? 'https://projectsites.dev';

interface Vitals {
  lcp: number;
  cls: number;
  fcp: number;
}

async function measure(url: string, browser: import('@playwright/test').Browser): Promise<Vitals> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  // Throttle to 3G + mid-range-Android CPU (ttfr-north-star measurement profile).
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: (1.5 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 100,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });

  await page.goto(url, { waitUntil: 'load' });
  // Let LCP finalize + layout settle past load on the throttled profile.
  await page.waitForTimeout(2500);

  const vitals = await page.evaluate(
    () =>
      new Promise<Vitals>((resolve) => {
        let lcp = 0;
        let cls = 0;
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          lcp = entries[entries.length - 1].startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as PerformanceEntry[]) {
            const ls = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
            if (!ls.hadRecentInput) cls += ls.value ?? 0;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
        const fcp = fcpEntry ? fcpEntry.startTime : 0;
        setTimeout(() => resolve({ lcp, cls, fcp }), 300);
      }),
  );

  await context.close();
  return vitals;
}

test.describe('TTFR — Core Web Vitals budget (throttled 3G, prod)', () => {
  test('marketing homepage hits LCP≤2.0s / CLS≤0.05 / FCP≤1.2s', async ({ browser }) => {
    const v = await measure(PROD, browser);
    // eslint-disable-next-line no-console
    console.log(
      `[ttfr] homepage 3G/6×CPU → LCP=${Math.round(v.lcp)}ms CLS=${v.cls.toFixed(3)} FCP=${Math.round(v.fcp)}ms`,
    );
    expect(v.lcp, `LCP ${Math.round(v.lcp)}ms > 2000ms`).toBeLessThanOrEqual(2000);
    expect(v.cls, `CLS ${v.cls.toFixed(3)} > 0.05`).toBeLessThanOrEqual(0.05);
    expect(v.fcp, `FCP ${Math.round(v.fcp)}ms > 1200ms`).toBeLessThanOrEqual(1200);
  });
});
