/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — POPULATED-RENDER + XSS-SAFETY + Contract-#10 value
 * domains. For each list section, stub its endpoint with POPULATED rows carrying HOSTILE field
 * values — unicode, a 600-char overlong string, and an injection payload
 * (`<img onerror>` + `<script>` + `{{7*7}}`) — then assert THREE things:
 *   1. the rows RENDER (the per-row selector appears) → proves the FE reads the CORRECT response
 *      key (a wrong key would render the empty state instead — the `response-key-mismatch-lying-
 *      empty` regression class), AND that no row crashes on full-shaped hostile data;
 *   2. NO XSS executes — an `onerror`/`<script>` canary sets `window.__xssHit`; Angular's `{{ }}`
 *      interpolation auto-escapes (every one of these sections is `innerHTML`-free), so the payload
 *      must render as inert TEXT and `__xssHit` must stay 0 (this test is the regression guard the
 *      day someone swaps a cell to an unsanitized `[innerHTML]`);
 *   3. no layout blow-out — the overlong value must wrap/truncate, not stretch the page absurdly.
 *
 * Data-driven: one case per section; a new section is a one-line addition. `audit` is deferred
 * (ag-grid virtualized rows resist a clean per-row assertion).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./forms-empty-state.spec.ts} — the empty counterpart (0 rows → empty state).
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const UNICODE = '日本語 émoji 🎉 Ω≈ç الْعَرَبِيَّة';
const XSS = '<img src=x onerror="window.__xssHit=1"><script>window.__xssHit=1</script>{{7*7}}';
const OVERLONG = 'A'.repeat(600);

/** Build valid + unicode + xss + overlong rows by mutating one rendered text field. */
function hostileRows(base: Record<string, unknown>, field: string): Array<Record<string, unknown>> {
  return [
    { ...base, id: 'row-valid', leadId: 'row-valid' },
    { ...base, id: 'row-unicode', leadId: 'row-unicode', [field]: UNICODE },
    { ...base, id: 'row-xss', leadId: 'row-xss', [field]: XSS },
    { ...base, id: 'row-overlong', leadId: 'row-overlong', [field]: OVERLONG },
  ];
}

interface RenderCase {
  readonly name: string;
  readonly route: string;
  readonly glob: string;
  readonly base: Record<string, unknown>;
  readonly field: string; // the rendered text field that carries the hostile value
  readonly wrap: (rows: Array<Record<string, unknown>>) => unknown; // response envelope
  readonly rowSelector: string;
}

const CASES: readonly RenderCase[] = [
  {
    name: 'forms',
    route: '/admin/forms',
    glob: '**/api/sites/*/form-submissions**',
    base: {
      form_name: 'contact',
      email: 'visitor@example.com',
      fields: { message: 'hello' },
      status: 'received',
      origin_url: 'https://example.com/contact',
      ip_address: '203.0.113.7',
      created_at: '2026-07-30T12:00:00Z',
    },
    field: 'form_name',
    wrap: (rows) => ({ data: rows }),
    rowSelector: '[data-testid^="forms-row-select-"]',
  },
  {
    name: 'domains',
    route: '/admin/domains',
    glob: '**/api/sites/*/hostnames**',
    base: { hostname: 'example.com', type: 'custom_cname', status: 'active', ssl_status: 'verified', is_primary: 0 },
    field: 'hostname',
    wrap: (rows) => ({ data: rows }),
    rowSelector: '[data-testid="hostnames-table"] tbody tr',
  },
  {
    name: 'webhooks',
    route: '/admin/webhooks',
    glob: '**/api/sites/*/webhooks**',
    base: { url: 'https://example.com/hook', eventTypes: ['site.published'], enabled: true },
    field: 'url',
    wrap: (rows) => ({ ok: true, endpoints: rows }),
    rowSelector: '[data-testid="webhooks-row"]',
  },
  {
    name: 'leads',
    route: '/admin/leads',
    glob: '**/api/admin/leads**',
    base: {
      businessName: 'Test Business',
      hasWebsite: false,
      leadScore: 85,
      priority: true,
      email: 'contact@test.com',
      emailStatus: 'valid',
      source: 'google-places',
      createdAt: '2026-07-30T12:00:00Z',
    },
    field: 'businessName',
    wrap: (rows) => ({ leads: rows, count: rows.length }),
    rowSelector: '[data-testid^="leads-copy-link-"]',
  },
  {
    name: 'snapshots',
    route: '/admin/snapshots',
    glob: '**/api/sites/*/snapshots**',
    base: {
      snapshot_name: 'v2-redesign',
      build_version: '2026.07.30-build-1234',
      description: 'initial snapshot',
      created_at: '2026-07-30T10:30:00Z',
    },
    field: 'snapshot_name',
    wrap: (rows) => ({ data: rows }),
    rowSelector: '[data-testid^="snap-row-"]',
  },
];

function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

test.describe('Admin · populated-render + XSS-safety + value domains (P0-ADMIN)', () => {
  for (const c of CASES) {
    test(`${c.name}: hostile rows render safely — correct key, no XSS, no blow-out`, async ({ page }) => {
      test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
      const errors = attachConsole(page);
      let hadDialog = false;
      page.on('dialog', (d) => {
        hadDialog = true;
        d.dismiss().catch(() => {});
      });

      await setupRealDataPage(page, { passthrough: /\/api\// });
      const body = JSON.stringify(c.wrap(hostileRows(c.base, c.field)));
      await page.route(c.glob, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body }),
      );
      await page.goto(c.route, { waitUntil: 'domcontentloaded' });

      // 1. Rows render → the FE read the correct response key (else the empty state would show).
      const rows = page.locator(c.rowSelector);
      await expect(rows.first(), `${c.name}: stubbed rows render (correct response key, no lying-empty)`).toBeVisible({
        timeout: 15000,
      });
      expect(await rows.count(), `${c.name}: all four hostile rows render without a per-row crash`).toBeGreaterThanOrEqual(
        4,
      );

      // 2. No XSS executed — the injection payload must be inert (Angular interpolation escaped it).
      const xssHit = await page.evaluate(() => (window as unknown as { __xssHit?: number }).__xssHit ?? 0);
      expect(xssHit, `${c.name}: injected onerror/script did NOT execute (rendered as inert text)`).toBe(0);
      expect(hadDialog, `${c.name}: no alert dialog from injected markup`).toBe(false);

      // 3. No layout blow-out from the 600-char overlong value.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth / Math.max(1, document.documentElement.clientWidth),
      );
      expect(overflow, `${c.name}: overlong text wraps/truncates — no absurd horizontal blow-out`).toBeLessThan(3);

      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      expect(bodyText.includes('ran into a problem'), `${c.name}: hostile rows must not crash the boundary`).toBe(false);

      await page.screenshot({ path: `e2e/screenshots/admin-verify/populated-${c.name}.png` });
      expect(errors, `${c.name}: no console errors rendering hostile rows — saw ${errors.join(' | ')}`).toEqual([]);
    });
  }
});
