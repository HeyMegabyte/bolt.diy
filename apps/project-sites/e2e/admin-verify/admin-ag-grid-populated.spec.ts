/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — POPULATED-RENDER + XSS for the two data-grid sections
 * (audit `/admin/audit`, ai-logs `/admin/ai-logs`→`/admin/logs?tab=traces`). Unlike the `@for`-list
 * sections, these render rows via a data grid (audit migrated ag-grid→TanStack native `<table>`
 * 2026-08-20), so the assertion is `getByRole('row')` count ≥ 2 (a header row + ≥1 data row) —
 * role-based so it resolves ag-grid's explicit role="row" AND a native `<tr>`'s implicit role.
 * Stubs a POPULATED response with a hostile value in a text column and asserts the grid renders
 * data rows AND the payload is inert (no columnDef uses a raw-HTML `cellRenderer` — the values go
 * through ag-grid's text path, so they render escaped). Completes these two sections' data-state
 * matrix (their empty/error/loading states are covered elsewhere).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./admin-populated-render-xss.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const XSS = '<img src=x onerror="window.__xssHit=1">日本語 🎉';

interface GridCase {
  readonly name: string;
  readonly route: string;
  readonly glob: string;
  readonly body: string;
  readonly gridTestid: string;
}

const CASES: readonly GridCase[] = [
  {
    name: 'audit',
    route: '/admin/audit',
    glob: '**/api/audit-logs**',
    gridTestid: 'audit-grid',
    body: JSON.stringify({
      data: [
        {
          id: 'a1',
          action: 'site.created',
          message: 'Provisioned example.com',
          target_type: 'site',
          target_id: 's1',
          actor_id: 'u1',
          metadata: null,
          request_id: 'r1',
          created_at: '2026-08-07T12:00:00Z',
          site: 'example.com',
        },
        {
          id: 'a2',
          action: 'site.deploy',
          message: XSS,
          target_type: 'site',
          target_id: 's1',
          actor_id: 'u1',
          metadata: null,
          request_id: 'r2',
          created_at: '2026-08-07T12:05:00Z',
          site: 'example.com',
        },
      ],
    }),
  },
  {
    name: 'ai-logs',
    route: '/admin/ai-logs',
    glob: '**/api/sites/*/ai-logs**',
    gridTestid: 'traces-grid',
    body: JSON.stringify({
      data: [
        {
          id: 'l1',
          submission_id: null,
          trace_kind: 'tool_call',
          endpoint_slug: 'chat',
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          status: 'ok',
          latency_ms: 245,
          tokens_input: 156,
          tokens_output: 87,
          credits_debited: 0.042,
          tool_name: 'web_search',
          tool_status: 'success',
          output_preview: 'Found 3 results',
          error_message: null,
          created_at: '2026-08-07T12:00:00Z',
          actor_email: 'user@example.com',
          user_id: 'u1',
        },
        {
          id: 'l2',
          submission_id: null,
          trace_kind: 'tool_call',
          endpoint_slug: 'chat',
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          status: 'ok',
          latency_ms: 300,
          tokens_input: 100,
          tokens_output: 50,
          credits_debited: 0.03,
          tool_name: 'read',
          tool_status: 'success',
          output_preview: XSS,
          error_message: null,
          created_at: '2026-08-07T12:05:00Z',
          actor_email: 'user@example.com',
          user_id: 'u1',
        },
      ],
    }),
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

test.describe('Admin · ag-grid populated-render + XSS (P0-ADMIN)', () => {
  for (const c of CASES) {
    test(`${c.name}: a populated grid renders data rows + a hostile cell is inert`, async ({ page }) => {
      test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
      const errors = attachConsole(page);
      let hadDialog = false;
      page.on('dialog', (d) => {
        hadDialog = true;
        d.dismiss().catch(() => {});
      });

      await setupRealDataPage(page, { passthrough: /\/api\// });
      await page.route(c.glob, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: c.body }),
      );
      await page.goto(c.route, { waitUntil: 'domcontentloaded' });

      // Rows carry the ARIA "row" role: the old ag-grid set role="row" explicitly, the
      // native <table> from the 2026-08-20 ag-grid→TanStack migration gets it IMPLICITLY on
      // <tr>. getByRole('row') resolves BOTH (a header row + one per data row) — a literal
      // [role="row"] attribute selector matched ag-grid only + read 0 rows on the native
      // table, a chronic prod-e2e RED (fixed AL-152 2026-09-07). Stale-proof across the impl.
      const grid = page.locator(`[data-testid="${c.gridTestid}"]`);
      await expect(grid, `${c.name}: the grid mounts`).toBeVisible({ timeout: 15000 });
      await expect
        .poll(async () => grid.getByRole('row').count(), {
          timeout: 10000,
          message: `${c.name}: the grid renders a header row + ≥1 data row`,
        })
        .toBeGreaterThanOrEqual(2);

      expect(
        await page.evaluate(() => (window as unknown as { __xssHit?: number }).__xssHit ?? 0),
        `${c.name}: the hostile cell value did not execute`,
      ).toBe(0);
      expect(hadDialog, `${c.name}: no alert dialog from the hostile cell`).toBe(false);
      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      expect(bodyText.includes('ran into a problem'), `${c.name}: a populated grid must not crash`).toBe(false);

      await page.screenshot({ path: `e2e/screenshots/admin-verify/ag-grid-populated-${c.name}.png` });
      expect(errors, `${c.name}: no console errors — saw ${errors.join(' | ')}`).toEqual([]);
    });
  }
});
