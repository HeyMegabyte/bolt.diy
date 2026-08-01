/**
 * API coverage — billing + wallet routes.
 *
 * Checkout / portal / subscription / entitlements / wallet all move money or
 * read tenant billing state. An UNAUTHENTICATED caller MUST hit a leak-free gate
 * — 401 / 403 / 404 — and MUST NEVER get a 2xx (which would mean an anonymous
 * caller started a checkout, opened a portal, topped up, or read another org's
 * subscription/wallet) nor a 5xx.
 *
 * Authenticates nothing; `request` fixture only — never mutates prod.
 *
 * @see {@link ../../src/routes/api.ts}
 */
import { test, expect } from '@playwright/test';

const PROD = process.env.PROD_URL ?? 'https://projectsites.dev';

/** The only leak-free responses for an unauthenticated caller to a billing route. */
const GATE = [401, 403, 404];

test.describe('Billing + wallet routes — unauthenticated safety gate (P10 coverage)', () => {
  test('POST /api/billing/checkout — unauth is gated, never starts checkout', async ({ request }) => {
    const res = await request.post(`${PROD}/api/billing/checkout`, { data: { plan: 'pro' } });
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('POST /api/billing/embedded-checkout — unauth is gated', async ({ request }) => {
    const res = await request.post(`${PROD}/api/billing/embedded-checkout`, { data: { plan: 'pro' } });
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('POST /api/billing/portal — unauth is gated, never opens a portal', async ({ request }) => {
    const res = await request.post(`${PROD}/api/billing/portal`, { data: {} });
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('GET /api/billing/subscription — unauth is gated, never leaks a subscription', async ({
    request,
  }) => {
    const res = await request.get(`${PROD}/api/billing/subscription`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
    if (res.status() < 400) {
      const body = JSON.stringify(await res.json().catch(() => ({})));
      expect(
        /"(customer|subscription_id|current_period|stripe)"/i.test(body),
        'unauth subscription read must not leak billing state',
      ).toBe(false);
    }
  });

  test('GET /api/billing/entitlements — unauth is gated', async ({ request }) => {
    const res = await request.get(`${PROD}/api/billing/entitlements`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('GET /api/wallet — unauth is gated, never leaks a wallet', async ({ request }) => {
    const res = await request.get(`${PROD}/api/wallet`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
    if (res.status() < 400) {
      const body = JSON.stringify(await res.json().catch(() => ({})));
      expect(
        /"(balance|credits|amount_cents|customer)"/i.test(body),
        'unauth wallet read must not leak balance',
      ).toBe(false);
    }
  });

  test('GET /api/wallet/transactions — unauth is gated', async ({ request }) => {
    const res = await request.get(`${PROD}/api/wallet/transactions`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('POST /api/wallet/topup — unauth is gated, never charges', async ({ request }) => {
    const res = await request.post(`${PROD}/api/wallet/topup`, { data: { amount_cents: 500 } });
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });
});
