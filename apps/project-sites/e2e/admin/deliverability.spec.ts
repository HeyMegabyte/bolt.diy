/**
 * PROMOTION EVIDENCE — flag `email_deliverability_wizard` (DARK: enabled=0,
 * experimental).
 *
 * REAL GATING MECHANISM (grepped 2026-07-31):
 * - SERVER-SIDE gate in `src/routes/email_deliverability.ts`
 *   (`GET /api/sites/:siteId/deliverability[?domain=]`, mounted
 *   `src/index.ts:1098` before `api`): 401 anon → `isFlagOn(env,
 *   'email_deliverability_wizard', {siteId, orgId})` off → 404 NOT_FOUND
 *   (never 403 — existence never leaks) → `assertSiteOwned` miss → 404 →
 *   `?domain=` override (normalizeDomain) else the site's primary custom_cname
 *   hostname else 400 BAD_REQUEST. Read-only DNS-over-HTTPS; persists nothing.
 * - The ADMIN surface (`sections/deliverability.component.ts`,
 *   `app-admin-deliverability`) is EMBEDDED in Settings' Email tab —
 *   `/admin/settings#email` (settings.component.ts imports it and reads the
 *   URL fragment for the initial tab). `/admin/deliverability` itself is NOT
 *   a route: app.routes.ts has no such child, so it falls to the admin `**`
 *   wildcard → AdminNotFoundComponent (no wizard, no heading — the not-found
 *   hint list merely SUGGESTS it). The component reads NO flag client-side
 *   and never auto-fires: the check runs only on the explicit button. A 404
 *   from the check → `flagDisabled` → calm cyan
 *   `data-testid="deliverability-flag-gate"` (FlagGateNotice) + button
 *   disabled; any other failure → red `data-testid="deliverability-error"`
 *   card with Retry.
 * - The optional sending-domain override is validated CLIENT-side by a
 *   bare-hostname regex (`isValidDomain`): junk → `deliverability-domain-hint`
 *   + `aria-invalid="true"` + Check disabled, BEFORE any network round-trip.
 *   (Format-only: an overlong-but-dotted label passes client-side; length junk
 *   surfaces server-side as a DNS-lookup failure → transient error card.)
 *
 * FLAG_DOCS checklist coverage (`src/modules/feature_flags/docs.ts`):
 * - SPF+DKIM+DMARC check, 0-100 score, concrete fixes → test 3 (stub-on).
 * - Flag-off never-leak 404 → tests 1 + 2.
 * - Read-only contract → all mutations intercepted; the check is a GET.
 *
 * TDD contract: authedPage fixture; section stubs registered in the test body
 * (AFTER the helper → matched FIRST, reverse-registration order); ALL mutations
 * intercepted; glob-law '/**' twins; hard asserts; zero-console-error with
 * favicon/'failed to load resource' filters; screenshots; NO networkidle;
 * bounded action timeouts; value-domains on the domain input.
 */

import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev';
const SITE_ID = 'e2e-site-001'; // the single site seeded by helpers/auth.ts _stubAdminApis
const PROBE_SITE = 'e2e-flag-evidence-probe'; // synthetic — never owned, never real

const MUTATIONS = ['POST', 'PATCH', 'PUT', 'DELETE'];

const NOT_FOUND_BODY = JSON.stringify({
  error: { code: 'NOT_FOUND', message: 'Not found', request_id: 'e2e-stub' },
});

/** Realistic wizard report: strong SPF/DKIM, missing DMARC → score 72 + one fix. */
const REPORT_BODY = JSON.stringify({
  ok: true,
  report: {
    domain: 'mail.example.com',
    spf: { present: true, record: 'v=spf1 include:_spf.example.com ~all' },
    dmarc: { present: false, record: null, policy: null },
    dkim: {
      present: true,
      selectorsChecked: ['default', 'google', 'resend'],
      foundSelectors: ['google'],
    },
    score: 72,
    recommendations: [
      'Add a DMARC record: _dmarc.mail.example.com TXT "v=DMARC1; p=none; rua=mailto:dmarc@example.com"',
    ],
  },
});

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function realErrors(errors: string[]): string[] {
  return errors.filter((e) => {
    const low = e.toLowerCase();
    return (
      !low.includes('favicon') &&
      !low.includes('failed to load resource') &&
      !low.includes('posthog') &&
      !low.includes('sentry') &&
      !low.includes('google') &&
      !low.includes('net::err_blocked_by_client') &&
      !low.includes('third-party')
    );
  });
}

/** Flag-OFF mode: the deliverability route (all methods) → 404 envelope. */
async function stubDeliverabilityFlagOff(page: Page): Promise<void> {
  const flagOff = async (route: Route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: NOT_FOUND_BODY });
  };
  // Query-suffix pattern + glob-law '/**' twin (mid-token ** cannot cross '/').
  await page.route(`**/api/sites/${SITE_ID}/deliverability**`, flagOff);
  await page.route(`**/api/sites/${SITE_ID}/deliverability/**`, flagOff);
}

/** Stub-ON mode: GET → report; ALL mutations intercepted. Records requested URLs. */
async function stubDeliverabilityOn(page: Page, requested: string[]): Promise<void> {
  const serve = async (route: Route) => {
    if (MUTATIONS.includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    requested.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: REPORT_BODY });
  };
  await page.route(`**/api/sites/${SITE_ID}/deliverability**`, serve);
  await page.route(`**/api/sites/${SITE_ID}/deliverability/**`, serve);
}

async function gotoDeliverability(page: Page): Promise<void> {
  // The wizard renders inside Settings' Email tab (fragment picks the initial
  // tab — same mechanism the green webhooks evidence spec uses for #webhooks).
  // `/admin/deliverability` is unrouted → admin-not-found, NOT the wizard.
  await page.goto(`${BASE}/admin/settings#email`, {
    waitUntil: 'domcontentloaded',
    timeout: 25_000,
  });
  expect(page.url()).not.toContain('/signin');
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
  await expect(page.locator('[data-testid="settings-email-panel"]')).toBeVisible({
    timeout: 20_000,
  });
  // Stable testid on the wizard's own heading — the settings page carries
  // several headings of its own, so text-matching an h2 is ambiguous there.
  await expect(page.locator('[data-testid="deliv-heading"]')).toBeVisible({ timeout: 15_000 });
  // The helper seeds ONE site → selectedSite is truthy → the check surface
  // (not the deliverability-empty prompt) must render.
  await expect(page.locator('[data-testid="deliverability-domain"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="deliverability-check-btn"]')).toBeVisible({
    timeout: 10_000,
  });
}

test.describe('FLAG EVIDENCE — email_deliverability_wizard', () => {
  test('flag-off server contract: gated route answers JSON 404/401 — never 403, never 200/HTML', async ({
    authedPage: page,
  }) => {
    // Probe passes THROUGH to real prod (registered after the helper → matched
    // first; continue() is terminal). Browser-context fetch = real Chrome UA +
    // app origin, no WAF/BFM artifacts.
    await page.route(`**/api/sites/${PROBE_SITE}/deliverability**`, (r) => r.continue());
    await page.route(`**/api/sites/${PROBE_SITE}/deliverability/**`, (r) => r.continue());

    const bearer = process.env.E2E_API_KEY ?? 'e2e-stub-session-token';
    const authedReal = Boolean(process.env.E2E_API_KEY);

    const res = await page.evaluate(
      async ({ path, token }: { path: string; token: string }) => {
        const r = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
        return {
          status: r.status,
          contentType: r.headers.get('content-type') ?? '',
          text: await r.text(),
        };
      },
      { path: `/api/sites/${PROBE_SITE}/deliverability?domain=mail.example.com`, token: bearer },
    );

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(200);
    expect([401, 404]).toContain(res.status);
    expect(res.contentType).toContain('application/json');

    const body = JSON.parse(res.text) as { error?: { code?: string; message?: string } };
    expect(['NOT_FOUND', 'UNAUTHORIZED']).toContain(body.error?.code ?? '');

    if (authedReal) {
      // Real E2E_API_KEY session → the flag gate itself: exact 404 NOT_FOUND.
      expect(res.status).toBe(404);
      expect(body.error?.code).toBe('NOT_FOUND');
    }
  });

  test('flag-off UI contract: check → 404 renders the calm flag-gate notice — never the red error card', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    await stubDeliverabilityFlagOff(page);
    await gotoDeliverability(page);

    await page
      .locator('[data-testid="deliverability-check-btn"]')
      .click({ timeout: 10_000 });

    // 404 = flag off → the calm cyan FlagGateNotice, HARD…
    await expect(page.locator('[data-testid="deliverability-flag-gate"]')).toBeVisible({
      timeout: 10_000,
    });
    // …NOT the transient red error card, and no result panel.
    await expect(page.locator('[data-testid="deliverability-error"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="deliverability-result"]')).toHaveCount(0);
    // flagDisabled() also disables further checks — no 404 hammering.
    await expect(page.locator('[data-testid="deliverability-check-btn"]')).toBeDisabled({
      timeout: 5_000,
    });

    await page.screenshot({
      path: 'e2e/screenshots/admin-deliverability-flag/01-flag-off-calm.png',
      fullPage: false,
    });

    expect(realErrors(errors)).toEqual([]);
  });

  test('stub-on wizard: domain override → score meter + SPF/DKIM/DMARC rows + fix list', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    const requested: string[] = [];
    await stubDeliverabilityOn(page, requested);
    await gotoDeliverability(page);

    // One real interaction: type an override domain, run the check.
    await page
      .locator('[data-testid="deliverability-domain"]')
      .fill('mail.example.com', { timeout: 10_000 });
    await page
      .locator('[data-testid="deliverability-check-btn"]')
      .click({ timeout: 10_000 });

    await expect(page.locator('[data-testid="deliverability-result"]')).toBeVisible({
      timeout: 10_000,
    });
    // Score meter carries the 0-100 contract via the progressbar semantics.
    await expect(page.locator('[aria-label="Deliverability score meter"]')).toHaveAttribute(
      'aria-valuenow',
      '72',
      { timeout: 10_000 },
    );
    await expect(page.locator('[data-testid="deliverability-spf"]')).toContainText('Configured');
    await expect(page.locator('[data-testid="deliverability-dmarc"]')).toContainText('Missing');
    await expect(page.locator('[data-testid="deliverability-dkim"]')).toContainText('Configured');
    await expect(page.locator('[data-testid="deliverability-rec-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="deliverability-rec-row"]')).toContainText('DMARC');

    // The typed override must reach the API as ?domain= (server contract input).
    expect(requested.some((u) => u.includes('domain=mail.example.com'))).toBe(true);

    await page.screenshot({
      path: 'e2e/screenshots/admin-deliverability-flag/02-stub-on-report.png',
      fullPage: false,
    });

    expect(realErrors(errors)).toEqual([]);
  });

  test('value domains: domain input rejects junk client-side (hint + aria-invalid + disabled check)', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    // Defense-in-depth: even if a check slipped through, it hits a stub, not prod.
    await stubDeliverabilityOn(page, []);
    await gotoDeliverability(page);

    const input = page.locator('[data-testid="deliverability-domain"]');
    const hint = page.locator('[data-testid="deliverability-domain-hint"]');
    const checkBtn = page.locator('[data-testid="deliverability-check-btn"]');

    const invalidValues = [
      'https://mail.example.com', // protocol prefix
      'mail example.com', // interior whitespace
      '<script>alert(1)</script>', // injection attempt — must also never execute
      'a'.repeat(300), // overlong single label (no dot)
      '-bad.example.com', // leading hyphen
    ];
    for (const value of invalidValues) {
      await input.fill(value, { timeout: 10_000 });
      await expect(hint, `hint must show for ${JSON.stringify(value.slice(0, 40))}`).toBeVisible({
        timeout: 5_000,
      });
      await expect(input).toHaveAttribute('aria-invalid', 'true', { timeout: 5_000 });
      await expect(checkBtn).toBeDisabled({ timeout: 5_000 });
    }

    // Screenshot the rejection contract on the injection case's successor state.
    await page.screenshot({
      path: 'e2e/screenshots/admin-deliverability-flag/03-value-domain-invalid.png',
      fullPage: false,
    });

    const validValues = [
      'mail.example.com', // canonical override
      '', // empty = optional field → falls back to the site's own domain
    ];
    for (const value of validValues) {
      await input.fill(value, { timeout: 10_000 });
      await expect(hint, `no hint for ${JSON.stringify(value)}`).toHaveCount(0);
      await expect(input).not.toHaveAttribute('aria-invalid', 'true');
      await expect(checkBtn).toBeEnabled({ timeout: 5_000 });
    }

    // The injection string must never have executed.
    expect(dialogs).toEqual([]);
    expect(realErrors(errors)).toEqual([]);
  });
});
