/**
 * flows-webhooks-crud.flow.e2e.ts — Surface: outbound-webhooks CRUD lifecycle on
 * Settings › Webhooks (webhooks.component). The existing flows-webhooks covers the
 * form/validation UI, but its create→persist→list→delete JOURNEY could NEVER pass
 * before this fire: `webhook_endpoints` + `webhook_deliveries` were MISSING in prod
 * (migrations 0534/0535 authored but never applied), so create lied-success and the
 * list lied-empty. Fire-27 applied both tables — this flow proves the feature now
 * actually persists.
 *
 * Elaborate mutation journey against prod for e2e-site-3 (flag outbound_webhooks is
 * globally on): create a uniquely-URL'd endpoint → assert the reveal-once signing
 * secret + the list row + ground-truth (GET /webhooks now has it) → REMOVE it (the
 * confirm dialog) → assert it's gone from the list AND the store. Self-cleaning.
 *
 * Real testids: webhooks-url, webhooks-event-<ev>, webhooks-create-btn,
 * webhooks-secret, webhooks-secret-copy, webhooks-row, webhooks-delete,
 * webhooks-empty, webhooks-url-hint, webhooks-delivery-row. Delete confirm =
 * confirm-accept ("Remove").
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-webhooks-crud.flow --workers=1
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const URL_INPUT = '[data-testid="webhooks-url"]';
const SITE = 'e2e-site-3';
const MARK = 'e2e-webhook'; // URL marker for self-cleanup

interface WebhooksResp { ok: boolean; endpoints: { id: string; url: string; eventTypes?: string[] }[] }

async function openWebhooks(page: import('@playwright/test').Page) {
  await gotoAdmin(page, '/admin/settings#webhooks');
  await page.locator(URL_INPUT).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
}

test.describe('Full-flow · outbound webhooks CRUD', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ mode: 'serial', retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the Webhooks panel renders on Settings with the create form + event types', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openWebhooks(page);
    await expect(page.locator(URL_INPUT), 'the URL input renders').toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="webhooks-create-btn"]')).toBeVisible();
    // The event-type allowlist is offered.
    await expect(page.locator('[data-testid="webhooks-event-site.published"]')).toBeVisible();
    await snap(page, 'webhooks-crud-01-panel');
    expectClean(errors);
  });

  test('02 ground-truth: the endpoints API is live (table now exists — no longer lying-empty)', async ({ page }) => {
    await seedSession(page);
    await openWebhooks(page);
    const api = await apiFetch<WebhooksResp>(page, `/api/sites/${SITE}/webhooks`);
    expect(api.status, 'the webhooks list endpoint is 200 (table applied this fire)').toBe(200);
    expect(api.body.ok).toBe(true);
    expect(Array.isArray(api.body.endpoints), 'endpoints is a real array').toBe(true);
    // Self-heal: revoke any e2e leftovers from a crashed prior run.
    for (const e of (api.body.endpoints ?? []).filter((x) => x.url?.includes(MARK))) {
      await apiFetch(page, `/api/sites/${SITE}/webhooks/${e.id}`, { method: 'DELETE' });
    }
  });

  test('03 lifecycle: create endpoint → reveal-once secret → list row → ground-truth → REMOVE → gone', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = attachConsole(page);
    await seedSession(page);
    await openWebhooks(page);
    await expect(page.locator(URL_INPUT)).toBeVisible({ timeout: 20_000 });

    const url = `https://example.com/${MARK}-${Date.now()}`;
    await page.locator(URL_INPUT).fill(url);
    // Default event (site.published) is preselected → the create button enables.
    const createBtn = page.locator('[data-testid="webhooks-create-btn"]');
    await expect(createBtn).toBeEnabled({ timeout: 5_000 });
    await createBtn.click();

    // The signing secret is revealed exactly once.
    await expect(page.locator('[data-testid="webhooks-secret"]'), 'the reveal-once secret banner shows').toBeVisible({ timeout: 15_000 });
    // The new endpoint appears in the list.
    await expect(page.locator('[data-testid="webhooks-row"]').filter({ hasText: url }), 'the endpoint row renders').toBeVisible({ timeout: 10_000 });
    await snap(page, 'webhooks-crud-03-created');

    // Ground-truth: the store persisted it (poll for D1 read-replica lag).
    await expect(async () => {
      const after = await apiFetch<WebhooksResp>(page, `/api/sites/${SITE}/webhooks`);
      expect((after.body.endpoints ?? []).some((e) => e.url === url)).toBe(true);
    }).toPass({ timeout: 15_000 });

    // REMOVE it (self-cleanup) — the row's delete button opens the confirm dialog.
    const row = page.locator('[data-testid="webhooks-row"]').filter({ hasText: url });
    await row.locator('[data-testid="webhooks-delete"]').click();
    await page.locator('[data-testid="confirm-accept"]').click({ timeout: 8_000 }).catch(() => {});

    // Ground-truth: it's gone from the store.
    await expect(async () => {
      const gone = await apiFetch<WebhooksResp>(page, `/api/sites/${SITE}/webhooks`);
      expect((gone.body.endpoints ?? []).some((e) => e.url === url)).toBe(false);
    }).toPass({ timeout: 15_000 });
    expectClean(errors);
  });

  test('04 validation: a non-https / invalid URL is rejected (create stays disabled or hints)', async ({ page }) => {
    await seedSession(page);
    await openWebhooks(page);
    await page.locator(URL_INPUT).fill('not-a-url');
    await page.locator(URL_INPUT).blur();
    const hint = page.locator('[data-testid="webhooks-url-hint"]');
    const createBtn = page.locator('[data-testid="webhooks-create-btn"]');
    // Either the inline hint shows OR the button is disabled — invalid never submits.
    const hinted = await hint.isVisible().catch(() => false);
    const disabled = await createBtn.isDisabled().catch(() => false);
    expect(hinted || disabled, 'an invalid URL is blocked from submission').toBe(true);
  });

  test('05 event-type selection: toggling a second event keeps the form submittable', async ({ page }) => {
    await seedSession(page);
    await openWebhooks(page);
    const evt = page.locator('[data-testid="webhooks-event-form.submitted"]');
    await expect(evt).toBeVisible();
    await evt.click();
    await page.locator(URL_INPUT).fill(`https://example.com/${MARK}-toggle-check`);
    // With a valid URL + ≥1 event selected, create is enabled (we never click it here).
    await expect(page.locator('[data-testid="webhooks-create-btn"]')).toBeEnabled({ timeout: 5_000 });
  });

  test('06 the webhooks surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openWebhooks(page);
    await expect(page.locator(URL_INPUT)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('07 deep-link + reload preserves the Webhooks surface (session intact)', async ({ page }) => {
    await seedSession(page);
    await openWebhooks(page);
    await expect(page.locator(URL_INPUT)).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openWebhooks(page);
    await expect(page.locator(URL_INPUT), 'still there after reload').toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('08 cleanup: no e2e webhook endpoints remain on the shared org', async ({ page }) => {
    await seedSession(page);
    await openWebhooks(page);
    const api = await apiFetch<WebhooksResp>(page, `/api/sites/${SITE}/webhooks`);
    for (const e of (api.body.endpoints ?? []).filter((x) => x.url?.includes(MARK))) {
      await apiFetch(page, `/api/sites/${SITE}/webhooks/${e.id}`, { method: 'DELETE' });
    }
    const after = await apiFetch<WebhooksResp>(page, `/api/sites/${SITE}/webhooks`);
    expect((after.body.endpoints ?? []).filter((e) => e.url?.includes(MARK)).length, 'no e2e endpoints remain').toBe(0);
  });
});
