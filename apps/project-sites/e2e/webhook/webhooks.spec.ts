/**
 * @module e2e/webhook/webhooks
 * @description Outbound Webhooks evidence for the `outbound_webhooks` flag
 * (DARK: experimental, default off) — LIVE prod.
 *
 * MODERNIZED 2026-07-31 (Pass-14 stale-era queue). The original spec covered
 * inbound Twilio voice/SMS + `/internal/voice/media-stream` routes that no
 * longer exist (grep: `src/routes/webhooks.ts` now ships `/webhooks/stripe`
 * only) and never touched the flag this file is FLAG_DOCS evidence for.
 * Uniquely-valuable Stripe signature-guard probes were PORTED (WEBHOOK-03/04);
 * everything else was replaced with the outbound_webhooks contract.
 *
 * Discovered wiring (grep evidence):
 *  - API family: `src/routes/webhooks_admin.ts` — GET/POST
 *    `/api/sites/:siteId/webhooks`, GET `…/webhooks/deliveries`, DELETE
 *    `…/webhooks/:id`. Shared `gate()` order: auth (401 UNAUTHORIZED when
 *    unauthenticated) → `isFlagOn('outbound_webhooks')` (404 when dark, NEVER
 *    403 per the feature-flags rule) → `assertSiteOwned` (404 on foreign).
 *    curl-verified live 2026-07-31: unauthed GET → 401; authed
 *    (E2E_API_KEY bearer) GET → 404 (flag dark).
 *  - Admin UI: `frontend/…/admin/sections/webhooks.component.ts`
 *    (`AdminWebhooksComponent`) — RELOCATED into the Settings section as the
 *    `webhooks` tab (`settings.component.ts` TABS + `settings-webhooks-panel`
 *    tabpanel). There is NO `/admin/webhooks` route in app.routes.ts anymore
 *    (only a not-found "did you mean" hint) — the surface is reached at
 *    `/admin/settings#webhooks` (settings reads the URL fragment to open the
 *    tab). Flag state is derived from the API (load 404 →
 *    `webhooks-flag-gate` calm notice + dimmed/disabled form — the
 *    flag-disabled-form-ux gold standard), NOT from a client useFeatureFlag,
 *    so the UI states are driven by stubbing the endpoint (house pattern:
 *    test-body stubs registered AFTER the authedPage helper win by
 *    reverse-registration; every glob ships its `?**` query twin).
 *  - Client URL boundary: `isValidHttpsUrl` (https + public host; loopback/
 *    private/link-local rejected). Server boundary: Zod `EndpointBody`
 *    (`url: z.string().url().max(2048)`, 1-20 eventTypes).
 *
 * Contract notes: NO networkidle, bounded timeouts, resilientGet/resilientPost
 * for ALL request-context calls (per-IP tarpit), zero-console-error house
 * filter, screenshots to e2e/screenshots/webhooks/. The unauthenticated 404
 * gate is NOT observable pre-auth (auth precedes the flag check → 401), so the
 * dark-launch 404-never-403 evidence runs authed and is conditional on
 * E2E_API_KEY; DELETE shares the same `gate()` middleware chain already
 * evidenced by GET/POST (unit-locked in src/__tests__/webhooks_admin_routes).
 *
 * WAF layer caveat (curl-verified 2026-07-31): non-browser POSTs to `/api/*`
 * can be intercepted by the Cloudflare managed challenge BEFORE origin —
 * HTTP 403 + `cf-mitigated: challenge` + "Just a moment…" HTML. That is the
 * EDGE, not the app: the flag rule ("404 never 403") binds the WORKER's
 * responses. POST probes therefore accept the challenge-403 ONLY when the
 * `cf-mitigated: challenge` header proves it came from the WAF — a worker-
 * emitted 403 still fails. GETs pass the WAF and stay strict. (`/webhooks/*`
 * has a WAF skip, so the Stripe probes always reach origin.)
 */

import { test, expect } from '../fixtures.js';
import type { Page, Route } from '@playwright/test';
import * as crypto from 'node:crypto';
import { resilientGet, resilientPost, expectStatus } from '../helpers/api-request.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev';

/** Matches the one-site stub in helpers/auth.ts (`selectedSite` = sites[0]). */
const SITE_ID = 'e2e-site-001';

/** A site id that exists for no org — authed probes must 404 (dark flag OR unowned). */
const PROBE_SITE_ID = 'e2e-nonexistent-site';

const VALID_BODY = { url: 'https://hooks.example.com/projectsites', eventTypes: ['site.published'] };

/**
 * Asserts a 403 came from the Cloudflare managed challenge (edge), never the
 * worker. An app-level 403 would violate the feature-flags rule (404 never
 * 403) and MUST fail the spec.
 */
function expectWafChallengeIf403(res: import('@playwright/test').APIResponse, label: string): void {
  if (res.status() === 403) {
    expect(
      res.headers()['cf-mitigated'],
      `${label}: a 403 is only acceptable as a WAF challenge (cf-mitigated: challenge) — a worker-emitted 403 breaks the 404-never-403 flag rule`,
    ).toBe('challenge');
  }
}

// ---------------------------------------------------------------------------
// Console-error collection (house noise filter — settings-journey idiom)
// ---------------------------------------------------------------------------

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('posthog') &&
      !e.includes('sentry') &&
      !e.includes('net::ERR_BLOCKED_BY_CLIENT') &&
      !e.toLowerCase().includes('failed to load resource') &&
      !e.includes('Http failure') &&
      !e.includes('ChunkLoadError') &&
      !e.includes('Loading chunk'),
  );
}

// ---------------------------------------------------------------------------
// UI stubs — registered in test bodies (after the authedPage helper's stubs)
// so Playwright's reverse-registration matching lets them win. `?**` twins per
// glob-law (bare globs do not match query strings; mid-token ** cannot cross /).
// ---------------------------------------------------------------------------

/** Flag OFF: every method on the family 404s (server guard: 404, never 403). */
async function stubWebhooksFlagOff(page: Page): Promise<void> {
  const notFound = async (route: Route): Promise<void> => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }),
    });
  };
  await page.route(`**/api/sites/${SITE_ID}/webhooks`, notFound);
  await page.route(`**/api/sites/${SITE_ID}/webhooks?**`, notFound);
  await page.route(`**/api/sites/${SITE_ID}/webhooks/deliveries`, notFound);
  await page.route(`**/api/sites/${SITE_ID}/webhooks/deliveries?**`, notFound);
}

const EXISTING_ENDPOINT = {
  id: 'ep-existing-1',
  url: 'https://hooks.example.com/existing',
  eventTypes: ['site.published', 'form.submitted'],
  enabled: true,
};

const EXISTING_DELIVERY = {
  id: 'd-1',
  eventType: 'site.published',
  statusCode: 200,
  ok: true,
  attempt: 1,
  createdAt: '2026-07-01T00:00:00Z',
};

/** Flag ON: GET lists one endpoint, POST creates (one-time secret), deliveries has one row. */
async function stubWebhooksFlagOn(page: Page): Promise<void> {
  const family = async (route: Route): Promise<void> => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: 'ep-e2e-created', secret: 'whsec_e2e_onetime_secret' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, endpoints: [EXISTING_ENDPOINT] }),
    });
  };
  const deliveries = async (route: Route): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, deliveries: [EXISTING_DELIVERY] }),
    });
  };
  await page.route(`**/api/sites/${SITE_ID}/webhooks`, family);
  await page.route(`**/api/sites/${SITE_ID}/webhooks?**`, family);
  await page.route(`**/api/sites/${SITE_ID}/webhooks/deliveries`, deliveries);
  await page.route(`**/api/sites/${SITE_ID}/webhooks/deliveries?**`, deliveries);
}

/**
 * Opens the Webhooks surface: Settings section with the `#webhooks` fragment
 * (settings.component.ts reads `route.snapshot.fragment` to pick the initial
 * tab; `/admin/webhooks` itself is no longer a route — not-found hint only).
 */
async function openWebhooksSection(page: Page): Promise<void> {
  await page.goto(`${BASE}/admin/settings#webhooks`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  expect(page.url()).not.toContain('/signin');
  await expect(
    page.locator('[data-testid="settings-webhooks-panel"]'),
    'Settings opens on the Webhooks tab via the URL fragment',
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator('h2').filter({ hasText: /Outbound Webhooks/i }).first(),
  ).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// WEBHOOK-01 — flag-dark SERVER contract, unauthenticated (live prod)
// ---------------------------------------------------------------------------
test.describe('WEBHOOK-01 — outbound_webhooks server gate, unauthenticated', () => {
  test('API family rejects unauthenticated callers with 401 — never 403, never 5xx', async ({
    request,
  }) => {
    // gate() checks auth BEFORE the flag, so the unauthenticated contract is a
    // clean 401 envelope on every member of the family. The flag's own 404
    // (never 403) sits behind auth — see WEBHOOK-02.
    const list = await resilientGet(request, `${BASE}/api/sites/${PROBE_SITE_ID}/webhooks`);
    expectStatus(list, [401], 'unauthed list gate');
    const listBody = (await list.json()) as { error?: { code?: string } };
    expect(listBody.error?.code).toBe('UNAUTHORIZED');

    const deliveries = await resilientGet(
      request,
      `${BASE}/api/sites/${PROBE_SITE_ID}/webhooks/deliveries`,
    );
    expectStatus(deliveries, [401], 'unauthed deliveries gate');

    // POSTs from a request context may be WAF-challenged before origin (see
    // header caveat) — 401 when the worker answers, 403 ONLY as a proven
    // edge challenge. Never 2xx, never 404-pre-auth, never 5xx.
    const create = await resilientPost(request, `${BASE}/api/sites/${PROBE_SITE_ID}/webhooks`, {
      data: VALID_BODY,
      headers: { 'Content-Type': 'application/json' },
    });
    expectStatus(create, [401, 403], 'unauthed create gate (auth precedes validation)');
    expectWafChallengeIf403(create, 'unauthed create gate');
    if (create.status() === 401) {
      const createBody = (await create.json()) as { error?: { code?: string } };
      expect(createBody.error?.code).toBe('UNAUTHORIZED');
    }
    // DELETE /api/sites/:siteId/webhooks/:id runs the SAME gate() chain —
    // covered by the probes above + the webhooks_admin_routes unit suite.
  });
});

// ---------------------------------------------------------------------------
// WEBHOOK-02 — flag-dark SERVER contract, authenticated (404 never 403)
// ---------------------------------------------------------------------------
test.describe('WEBHOOK-02 — outbound_webhooks dark gate behind auth', () => {
  test('authed probes 404 while the flag is dark — never 403, never a leak', async ({
    request,
  }) => {
    test.skip(
      !process.env.E2E_API_KEY,
      'blocked 2026-08-01: E2E_API_KEY not set — the post-auth 404 gate needs a real bearer (get-secret E2E_API_KEY)',
    );
    const headers = {
      Authorization: `Bearer ${process.env.E2E_API_KEY}`,
      'Content-Type': 'application/json',
    };

    // Flag dark → 404; even flag-on would 404 here via assertSiteOwned (probe
    // site is unowned). Either way the invariant holds: authed callers see
    // 404 — never 403 (no existence leak), never 401 (bearer accepted).
    const list = await resilientGet(request, `${BASE}/api/sites/${PROBE_SITE_ID}/webhooks`, {
      headers,
    });
    expectStatus(list, [404], 'authed dark-flag list gate (404 never 403)');
    const listBody = (await list.json()) as { error?: { code?: string } };
    expect(listBody.error?.code).toBe('NOT_FOUND');

    // The authed POST may be WAF-challenged before the bearer is ever seen —
    // accept 404 (worker: dark flag / unowned) or a PROVEN edge challenge.
    // The clean 404-never-403 evidence is the GET above, which passes the WAF.
    const create = await resilientPost(request, `${BASE}/api/sites/${PROBE_SITE_ID}/webhooks`, {
      data: VALID_BODY,
      headers,
    });
    expectStatus(create, [404, 403], 'authed dark-flag create gate (gate precedes Zod validation)');
    expectWafChallengeIf403(create, 'authed dark-flag create gate');
    if (create.status() === 404) {
      const createBody = (await create.json()) as { error?: { code?: string } };
      expect(createBody.error?.code).toBe('NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// WEBHOOK-03/04 — PORTED: inbound Stripe signature guard (still live routes)
// ---------------------------------------------------------------------------
test.describe('WEBHOOK-03 — /webhooks/stripe signature verification (ported)', () => {
  test('unsigned, malformed, and wrong-secret payloads are all rejected 4xx', async ({
    request,
  }) => {
    // Signature-rejection probes are safe to re-send — exactly the documented
    // resilientPost use case (no state is ever created).
    const unsigned = await resilientPost(request, `${BASE}/webhooks/stripe`, {
      data: JSON.stringify({ id: 'evt_e2e_test', type: 'payment_intent.succeeded' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expectStatus(unsigned, [400, 401], 'stripe webhook without Stripe-Signature');

    const malformed = await resilientPost(request, `${BASE}/webhooks/stripe`, {
      data: JSON.stringify({ id: 'evt_e2e_bad_sig', type: 'payment_intent.succeeded' }),
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 'v1=bad_signature_value,t=1234567890',
      },
    });
    expectStatus(malformed, [400, 401], 'stripe webhook with malformed signature');
    const body = (await malformed.json()) as Record<string, unknown>;
    const err = (body.error ?? body) as Record<string, unknown>;
    expect(err.code ?? err.message, 'rejection carries an error envelope').toBeTruthy();

    // Well-formed header, wrong secret — exercises the real HMAC compare path
    // (not just header parsing).
    const ts = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ id: 'evt_e2e_wrong_secret', type: 'payment_intent.succeeded' });
    const sig = crypto.createHmac('sha256', 'wrong_webhook_secret').update(`${ts}.${payload}`).digest('hex');
    const wrongSecret = await resilientPost(request, `${BASE}/webhooks/stripe`, {
      data: payload,
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${ts},v1=${sig}` },
    });
    expectStatus(wrongSecret, [400, 401], 'stripe webhook signed with the wrong secret');
  });
});

test.describe('WEBHOOK-04 — /webhooks/stripe rejection is idempotent (ported)', () => {
  test('two identical invalid deliveries return the same 4xx — never a 5xx dupe crash', async ({
    request,
  }) => {
    const payload = JSON.stringify({ id: 'evt_e2e_dupe', type: 'payment_intent.succeeded' });
    const headers = { 'Content-Type': 'application/json', 'Stripe-Signature': 'v1=fake,t=1234' };

    const first = await resilientPost(request, `${BASE}/webhooks/stripe`, { data: payload, headers });
    const second = await resilientPost(request, `${BASE}/webhooks/stripe`, { data: payload, headers });

    expectStatus(first, [400, 401], 'first invalid delivery');
    expectStatus(second, [400, 401], 'second identical delivery (dedupe guard must not throw)');
    expect(second.status(), 'rejection path is deterministic').toBe(first.status());
  });
});

// ---------------------------------------------------------------------------
// WEBHOOK-05 — /admin/webhooks flag-OFF UI state (calm gate, disabled form)
// ---------------------------------------------------------------------------
test.describe('WEBHOOK-05 — admin surface, flag off', () => {
  test('404 from the API renders the calm flag gate — dimmed form, no red error', async ({
    authedPage: page,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    await stubWebhooksFlagOff(page);
    await openWebhooksSection(page);

    // Calm cyan FlagGateNotice (role=status) — NOT the red error card.
    const gate = page.locator('[data-testid="webhooks-flag-gate"]');
    await expect(gate, 'flag-off renders the calm gate notice').toBeVisible({ timeout: 20_000 });
    await expect(gate).toHaveAttribute('role', 'status');
    await expect(page.locator('[data-testid="webhooks-error"]')).toHaveCount(0);

    // flag-disabled-form-ux: notice above + form dimmed + every control disabled.
    await expect(page.locator('[data-testid="webhooks-url"]')).toBeDisabled();
    await expect(page.locator('[data-testid="webhooks-create-btn"]')).toBeDisabled();
    await expect(page.locator('[data-testid="webhooks-event-site.published"]')).toBeDisabled();

    await page.screenshot({ path: 'e2e/screenshots/webhooks/01-flag-off-calm-gate.png' });
    expect(realErrors(consoleErrors), 'zero real console errors in the flag-off state').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WEBHOOK-06 — /admin/webhooks flag-ON UI (stub): list + create + one-time secret
// ---------------------------------------------------------------------------
test.describe('WEBHOOK-06 — admin surface, flag on (stub override)', () => {
  test('endpoint list + deliveries render; creating an endpoint reveals the one-time secret', async ({
    authedPage: page,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    await stubWebhooksFlagOn(page);
    await openWebhooksSection(page);

    // Existing endpoint + its delivery history render from the GETs.
    const row = page.locator('[data-testid="webhooks-row"]');
    await expect(row, 'stubbed endpoint listed').toHaveCount(1, { timeout: 20_000 });
    await expect(row).toContainText('https://hooks.example.com/existing');
    const delivery = page.locator('[data-testid="webhooks-delivery-row"]');
    await expect(delivery).toHaveCount(1);
    await expect(page.locator('[data-testid="webhooks-delivery-status"]')).toContainText('200 OK');
    await expect(page.locator('[data-testid="webhooks-flag-gate"]')).toHaveCount(0);
    await page.screenshot({ path: 'e2e/screenshots/webhooks/02-flag-on-list.png' });

    // Interaction: subscribe a new endpoint (extra event toggled on) → the
    // signing secret is revealed ONCE with a copy affordance.
    await page.fill('[data-testid="webhooks-url"]', 'https://hooks.example.com/projectsites');
    await page.locator('[data-testid="webhooks-event-form.submitted"]').check();
    const createBtn = page.locator('[data-testid="webhooks-create-btn"]');
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    const secret = page.locator('[data-testid="webhooks-secret"]');
    await expect(secret, 'one-time signing secret panel').toBeVisible({ timeout: 15_000 });
    await expect(secret).toContainText('whsec_e2e_onetime_secret');
    await expect(page.locator('[data-testid="webhooks-secret-copy"]')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/webhooks/03-created-secret.png' });

    expect(realErrors(consoleErrors), 'zero real console errors in the flag-on flow').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WEBHOOK-07 — endpoint-URL value domains (client boundary of EndpointBody.url)
// ---------------------------------------------------------------------------
test.describe('WEBHOOK-07 — endpoint URL value domains', () => {
  test('https+public accepted; http/javascript/loopback/empty rejected; overlong deferred to server', async ({
    authedPage: page,
  }) => {
    await stubWebhooksFlagOn(page);
    await openWebhooksSection(page);

    const url = page.locator('[data-testid="webhooks-url"]');
    const hint = page.locator('[data-testid="webhooks-url-hint"]');
    const createBtn = page.locator('[data-testid="webhooks-create-btn"]');
    await expect(url).toBeEnabled({ timeout: 20_000 });

    // VALID — https with a public hostname (default event pre-selected).
    await url.fill('https://hooks.example.com/projectsites');
    await expect(hint).toHaveCount(0);
    await expect(createBtn).toBeEnabled();

    // INVALID SCHEME — http:// is rejected with the inline hint + aria-invalid.
    await url.fill('http://insecure.example.com/hook');
    await expect(hint, 'http:// rejected inline').toBeVisible();
    await expect(url).toHaveAttribute('aria-invalid', 'true');
    await expect(createBtn).toBeDisabled();

    // DANGEROUS SCHEME — javascript: never validates.
    await url.fill('javascript:alert(1)');
    await expect(hint, 'javascript: rejected').toBeVisible();
    await expect(createBtn).toBeDisabled();

    // NON-PUBLIC HOSTS — loopback IP and localhost are rejected (SSRF-adjacent
    // client guard; the worker's own guard is the real boundary).
    await url.fill('https://127.0.0.1/hook');
    await expect(hint, 'loopback IP rejected').toBeVisible();
    await expect(createBtn).toBeDisabled();
    await url.fill('https://localhost/hook');
    await expect(hint, 'localhost rejected').toBeVisible();
    await expect(createBtn).toBeDisabled();

    // JUNK — not a URL at all.
    await url.fill('not a url');
    await expect(hint, 'junk rejected').toBeVisible();
    await expect(createBtn).toBeDisabled();
    await page.screenshot({ path: 'e2e/screenshots/webhooks/04-url-invalid-hint.png' });

    // WHITESPACE-ONLY → treated as empty: no scary hint, but not submittable.
    await url.fill('   ');
    await expect(hint).toHaveCount(0);
    await expect(createBtn).toBeDisabled();

    // EMPTY → same calm not-submittable state.
    await url.fill('');
    await expect(hint).toHaveCount(0);
    await expect(createBtn).toBeDisabled();

    // OVERLONG — a well-formed 2.1k-char https URL passes the CLIENT check
    // (no client max); the SERVER is the boundary: EndpointBody.url Zod
    // `.max(2048)` → 400 BAD_REQUEST (unit-locked in webhooks_admin_routes).
    await url.fill(`https://hooks.example.com/${'a'.repeat(2_100)}`);
    await expect(hint).toHaveCount(0);
    await expect(createBtn, 'overlong is deferred to the server Zod boundary').toBeEnabled();
  });
});
