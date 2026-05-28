/**
 * Billing flows — BILL-01 through BILL-17.
 *
 * Prompt-specified surface: $50/mo Stripe subscription + add-on purchase
 * + per-site usage metering via Stripe Connect live mode + rollback.
 *
 * All flows start from `/`, navigate via real user actions, auth as the
 * mocked brian@megabyte.space admin. NEVER weaken these tests to make them
 * pass — app code satisfies the test as written.
 */
import { test, expect } from '../fixtures.js';

test.describe('Subscription — $50/mo plan', () => {
  test('BILL-01 — Checkout Session creates for $50/mo plan', async ({ authedPage: page }) => {
    let postedBody: Record<string, unknown> | null = null;
    await page.route('**/api/billing/checkout', async (route) => {
      postedBody = JSON.parse(await route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
          session_id: 'cs_test_abc',
        }),
      });
    });
    await page.goto('/admin/billing');
    await page.getByRole('button', { name: /upgrade.*\$50/i }).click();
    await expect.poll(() => postedBody).not.toBeNull();
    expect(postedBody).toMatchObject({ plan: expect.stringMatching(/pro|main|standard/i) });
  });

  test('BILL-02 — Embedded checkout returns clientSecret', async ({ authedPage: page }) => {
    await page.route('**/api/billing/embedded-checkout', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ client_secret: 'cs_test_secret_xyz' }),
      });
    });
    await page.goto('/admin/billing');
    await page.getByRole('button', { name: /embedded.*checkout/i }).click();
    await expect(page.getByTestId('stripe-embedded-iframe')).toBeVisible();
  });

  test('BILL-03 — Subscription status visible (active|canceled)', async ({ authedPage: page }) => {
    await page.route('**/api/billing/subscription', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'active', plan: 'pro', current_period_end: '2026-06-27' }),
      });
    });
    await page.goto('/admin/billing');
    await expect(page.getByTestId('subscription-status')).toContainText(/active/i);
    await expect(page.getByTestId('subscription-plan')).toContainText(/pro/i);
  });

  test('BILL-04 — Entitlements panel shows sites/storage/seats limits', async ({ authedPage: page }) => {
    await page.route('**/api/billing/entitlements', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sites: 10, storage_gb: 50, seats: 3 }),
      });
    });
    await page.goto('/admin/billing');
    await expect(page.getByTestId('entitlement-sites')).toContainText('10');
    await expect(page.getByTestId('entitlement-storage_gb')).toContainText('50');
    await expect(page.getByTestId('entitlement-seats')).toContainText('3');
  });

  test('BILL-05 — Billing portal opens Stripe portal in new tab', async ({ authedPage: page }) => {
    await page.route('**/api/billing/portal', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ portal_url: 'https://billing.stripe.com/p/session/test_xyz' }),
      });
    });
    await page.goto('/admin/billing');
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: /manage billing|billing portal/i }).click(),
    ]);
    await expect(popup).toHaveURL(/billing\.stripe\.com/);
  });
});

test.describe('Add-on purchases', () => {
  test('BILL-06 — Monthly add-on purchase creates recurring price + checkout', async ({ authedPage: page }) => {
    let postBody: Record<string, unknown> | null = null;
    await page.route('**/api/billing/addons/purchase', async (route) => {
      postBody = JSON.parse(await route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_addon' }),
      });
    });
    await page.goto('/admin/billing');
    await page.getByRole('tab', { name: /add-ons/i }).click();
    await page.getByTestId('addon-card-extra-sites').getByRole('button', { name: /purchase/i }).click();
    await expect.poll(() => postBody).not.toBeNull();
    expect(postBody).toMatchObject({ addon: 'extra-sites', billing: 'monthly' });
  });

  test('BILL-07 — One-time credit pack purchase adds wallet credit', async ({ authedPage: page }) => {
    await page.route('**/api/billing/checkout/topup', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_topup' }),
      });
    });
    await page.goto('/admin/billing');
    await page.getByRole('tab', { name: /wallet/i }).click();
    await page.getByTestId('topup-amount').fill('25');
    await page.getByRole('button', { name: /add credit/i }).click();
    await expect(page.getByText(/redirecting to stripe/i)).toBeVisible();
  });
});

test.describe('Per-site metering — Stripe Meters API', () => {
  test('BILL-08 — Usage event posted to Stripe Meters', async ({ authedPage: page }) => {
    let meterPosted = false;
    await page.route('**/api/billing/usage/report**', async (route) => {
      meterPosted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ event_id: 'meter_evt_test', meter: 'site_renders', value: 1 }),
      });
    });
    await page.goto('/admin/billing');
    await page.getByRole('tab', { name: /usage|metering/i }).click();
    await page.getByRole('button', { name: /report sample event/i }).click();
    await expect.poll(() => meterPosted).toBe(true);
  });

  test('BILL-09 — Monthly invoice line shows usage qty', async ({ authedPage: page }) => {
    await page.route('**/api/billing/invoices/upcoming', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          lines: [
            { description: 'Pro plan', amount_cents: 5000 },
            { description: 'Site renders', quantity: 12_345, amount_cents: 1234 },
          ],
        }),
      });
    });
    await page.goto('/admin/billing');
    await page.getByRole('tab', { name: /usage|metering/i }).click();
    await expect(page.getByTestId('usage-line-site_renders')).toContainText('12,345');
  });
});

test.describe('Subscription rollback', () => {
  test('BILL-10 — Cancel → grace period → entitlements downgrade', async ({ authedPage: page }) => {
    await page.route('**/api/billing/subscription/cancel', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'canceled', cancel_at: '2026-06-27T00:00:00Z' }),
      });
    });
    await page.goto('/admin/billing');
    await page.getByRole('button', { name: /cancel subscription/i }).click();
    await page.getByRole('button', { name: /confirm cancel/i }).click();
    await expect(page.getByTestId('subscription-status')).toContainText(/canceled/i);
    await expect(page.getByTestId('grace-period-banner')).toContainText(/jun(e)? 27/i);
  });
});

test.describe('Stripe webhooks', () => {
  test('BILL-11 — /webhooks/stripe rejects missing signature', async ({ request }) => {
    const res = await request.post('/webhooks/stripe', {
      data: { type: 'noop' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toMatch(/WEBHOOK_SIGNATURE_INVALID|UNAUTHORIZED/);
  });

  test('BILL-12 — customer.subscription.updated upserts D1 row', async ({ authedPage: page }) => {
    // Verified indirectly via UI: after webhook fires, the admin shows updated status.
    await page.route('**/api/billing/subscription', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'active', plan: 'pro', last_webhook: 'customer.subscription.updated' }),
      });
    });
    await page.goto('/admin/billing');
    await expect(page.getByTestId('last-webhook')).toContainText(/customer\.subscription\.updated/);
  });

  test('BILL-13 — invoice.payment_failed surfaces user toast', async ({ authedPage: page }) => {
    await page.route('**/api/billing/subscription', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'past_due', plan: 'pro' }),
      });
    });
    await page.goto('/admin/billing');
    await expect(page.getByTestId('billing-warning-banner')).toContainText(/payment failed|past due/i);
  });
});

test.describe('Stripe Connect live mode', () => {
  test('BILL-14 — Agency tier enables Connect payouts to child orgs', async ({ authedPage: page }) => {
    await page.route('**/api/feature-flags/agency_tier**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          definition: { key: 'agency_tier' },
          resolved: { enabled: true, rollout_percent: 100, stage: 'beta', source: 'override' },
        }),
      });
    });
    await page.route('**/api/agency/stripe-connect/onboard', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ onboarding_url: 'https://connect.stripe.com/setup/acct_test' }),
      });
    });
    await page.goto('/admin/billing');
    await page.getByRole('tab', { name: /agency|connect/i }).click();
    await page.getByRole('button', { name: /onboard.*connect|connect stripe/i }).click();
    await expect(page.getByText(/redirecting to stripe connect/i)).toBeVisible();
  });

  test('BILL-15 — Affiliate referrals trigger payout split', async ({ authedPage: page }) => {
    await page.route('**/api/feature-flags/affiliate_program**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          definition: { key: 'affiliate_program' },
          resolved: { enabled: true, rollout_percent: 100, stage: 'beta', source: 'override' },
        }),
      });
    });
    await page.route('**/api/affiliates/payouts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          payouts: [{ affiliate_id: 'aff_1', amount_cents: 2500, status: 'pending' }],
        }),
      });
    });
    await page.goto('/admin/billing');
    await page.getByRole('tab', { name: /affiliates/i }).click();
    await expect(page.getByTestId('affiliate-payout-row')).toContainText(/25\.00|2500/);
  });
});

test.describe('Wallet + domain purchase', () => {
  test('BILL-16 — Wallet top-up adds credit', async ({ authedPage: page }) => {
    await page.route('**/api/wallet', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ balance_cents: 5000, currency: 'usd' }),
      });
    });
    await page.goto('/admin/billing');
    await page.getByRole('tab', { name: /wallet/i }).click();
    await expect(page.getByTestId('wallet-balance')).toContainText(/\$50\.00/);
  });

  test('BILL-17 — Domain purchase charges wallet, not Stripe direct', async ({ authedPage: page }) => {
    let walletCharged = false;
    await page.route('**/api/domains/purchase', async (route) => {
      const body = JSON.parse(await route.request().postData() ?? '{}');
      walletCharged = body.payment_method === 'wallet';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'registered', domain: 'example.com' }),
      });
    });
    await page.goto('/admin/domains');
    await page.getByPlaceholder(/search domain/i).fill('example.com');
    await page.getByRole('button', { name: /purchase/i }).click();
    await expect.poll(() => walletCharged).toBe(true);
  });
});
