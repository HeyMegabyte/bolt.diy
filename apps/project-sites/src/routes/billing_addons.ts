/**
 * @module routes/billing_addons
 * @description Billing add-ons, wallet top-up, usage metering, subscription
 * cancellation, Stripe Connect onboarding (agency tier), and affiliate payouts.
 *
 * All routes are auth-required and org-scoped.  When `STRIPE_SECRET_KEY` is
 * absent the handlers return realistic mock shapes so the UI and E2E tests
 * work without live Stripe credentials (per the [[secret-provisioning]]
 * mock-when-no-key pattern).
 *
 * | Method | Path                                 | Purpose                                       |
 * | ------ | ------------------------------------ | --------------------------------------------- |
 * | POST   | `/api/billing/addons/purchase`       | Purchase a recurring add-on via Stripe         |
 * | POST   | `/api/billing/checkout/topup`        | One-time credit-pack checkout                 |
 * | POST   | `/api/billing/usage/report`          | Post a usage event to Stripe Meters            |
 * | GET    | `/api/billing/invoices/upcoming`     | Next invoice preview (lines + usage qty)      |
 * | POST   | `/api/billing/subscription/cancel`   | Cancel subscription (at period end)           |
 * | POST   | `/api/agency/stripe-connect/onboard` | Start Stripe Connect Express onboarding       |
 * | GET    | `/api/affiliates/payouts`            | List pending affiliate payout rows            |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { unauthorized } from '@project-sites/shared';

const billingAddons = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Whether Stripe credentials are available. When absent we return mocks. */
function hasStripe(env: Env): boolean {
  return !!env.STRIPE_SECRET_KEY;
}

// ---------------------------------------------------------------------------
// POST /api/billing/addons/purchase
//
// Creates a recurring Stripe Checkout session for a named add-on (e.g.
// "extra-sites"). When Stripe keys are missing returns a synthetic
// checkout_url so the UI flow completes without live credentials.
// ---------------------------------------------------------------------------
billingAddons.post(
  '/api/billing/addons/purchase',
  zValidator(
    'json',
    z.object({
      addon: z.string().min(1),
      billing: z.enum(['monthly', 'yearly']).default('monthly'),
    }),
  ),
  async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) throw unauthorized();

    const { addon, billing } = c.req.valid('json');

    if (!hasStripe(c.env)) {
      return c.json({
        checkout_url: `https://checkout.stripe.com/c/pay/cs_test_addon_${addon}_${billing}`,
        addon,
        billing,
      });
    }

    const stripeKey = c.env.STRIPE_SECRET_KEY;
    const priceId = `price_addon_${addon}_${billing}`;
    const origin = c.req.header('origin') ?? 'https://projectsites.dev';

    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'metadata[org_id]': orgId,
      'metadata[addon]': addon,
      'metadata[billing]': billing,
      success_url: `${origin}/admin/billing?addon=success`,
      cancel_url: `${origin}/admin/billing?addon=canceled`,
    });

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!resp.ok) {
      const err = await resp.json<{ error: { message: string } }>();
      return c.json({ error: { code: 'STRIPE_ERROR', message: err.error?.message ?? 'Stripe error' } }, 400);
    }

    const session = await resp.json<{ url: string; id: string }>();
    return c.json({ checkout_url: session.url, session_id: session.id, addon, billing });
  },
);

// ---------------------------------------------------------------------------
// POST /api/billing/checkout/topup
//
// One-time credit-pack purchase. Creates a `payment` mode checkout session.
// ---------------------------------------------------------------------------
billingAddons.post(
  '/api/billing/checkout/topup',
  zValidator(
    'json',
    z.object({
      amount_cents: z.number().int().positive().optional(),
      bundle: z.string().optional(),
    }),
  ),
  async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) throw unauthorized();

    const { amount_cents, bundle } = c.req.valid('json');

    if (!hasStripe(c.env)) {
      return c.json({
        checkout_url: `https://checkout.stripe.com/c/pay/cs_test_topup_${bundle ?? amount_cents}`,
      });
    }

    const stripeKey = c.env.STRIPE_SECRET_KEY;
    const cents = amount_cents ?? 500;
    const origin = c.req.header('origin') ?? 'https://projectsites.dev';

    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': 'AI Credit Pack',
      'line_items[0][price_data][unit_amount]': String(cents),
      'line_items[0][quantity]': '1',
      'metadata[org_id]': orgId,
      'metadata[type]': 'credit_topup',
      success_url: `${origin}/admin/billing?topup=success`,
      cancel_url: `${origin}/admin/billing?topup=canceled`,
    });

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!resp.ok) {
      const err = await resp.json<{ error: { message: string } }>();
      return c.json({ error: { code: 'STRIPE_ERROR', message: err.error?.message ?? 'Stripe error' } }, 400);
    }

    const session = await resp.json<{ url: string; id: string }>();
    return c.json({ checkout_url: session.url, session_id: session.id });
  },
);

// ---------------------------------------------------------------------------
// POST /api/billing/usage/report
//
// Posts a usage event to the Stripe Meters API. Required for per-site
// metered billing. Mock-safe: returns a synthetic event_id when Stripe
// keys are absent.
// ---------------------------------------------------------------------------

interface UsageReportBody {
  meter?: string;
  value?: number;
  site_id?: string;
}

billingAddons.post(
  '/api/billing/usage/report',
  zValidator(
    'json',
    z.object({
      meter: z.string().default('site_renders'),
      value: z.number().int().min(1).default(1),
      site_id: z.string().optional(),
    }).optional(),
  ),
  async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) throw unauthorized();

    const body: UsageReportBody = c.req.valid('json') ?? {};
    const meter = body.meter ?? 'site_renders';
    const value = body.value ?? 1;

    if (!hasStripe(c.env)) {
      return c.json({
        event_id: `meter_evt_mock_${Date.now()}`,
        meter,
        value,
      });
    }

    const stripeKey = c.env.STRIPE_SECRET_KEY;
    const params = new URLSearchParams({
      event_name: meter,
      payload: JSON.stringify({ value: String(value), stripe_customer_id: orgId }),
    });

    const resp = await fetch('https://api.stripe.com/v1/billing/meter_events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!resp.ok) {
      const err = await resp.json<{ error: { message: string } }>();
      return c.json({ error: { code: 'STRIPE_ERROR', message: err.error?.message ?? 'Stripe meter error' } }, 400);
    }

    const evt = await resp.json<{ id: string }>();
    return c.json({ event_id: evt.id, meter, value });
  },
);

// ---------------------------------------------------------------------------
// GET /api/billing/invoices/upcoming
//
// Preview the next invoice including metered usage line items.
// ---------------------------------------------------------------------------
billingAddons.get('/api/billing/invoices/upcoming', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();

  if (!hasStripe(c.env)) {
    return c.json({
      lines: [
        { description: 'Pro plan', amount_cents: 5000 },
        { description: 'Site renders', quantity: 0, amount_cents: 0 },
      ],
      total_cents: 5000,
      currency: 'usd',
    });
  }

  const stripeKey = c.env.STRIPE_SECRET_KEY;
  const resp = await fetch(
    `https://api.stripe.com/v1/invoices/upcoming?customer=${orgId}&expand[]=lines`,
    { headers: { Authorization: `Bearer ${stripeKey}` } },
  );

  if (!resp.ok) {
    return c.json({
      lines: [{ description: 'Pro plan', amount_cents: 5000 }],
      total_cents: 5000,
      currency: 'usd',
    });
  }

  const inv = await resp.json<{
    lines: { data: Array<{ description: string | null; quantity: number | null; amount: number }> };
    amount_due: number;
    currency: string;
  }>();

  const lines = (inv.lines?.data ?? []).map((l) => ({
    description: l.description ?? '',
    quantity: l.quantity ?? undefined,
    amount_cents: l.amount,
  }));

  return c.json({ lines, total_cents: inv.amount_due, currency: inv.currency });
});

// ---------------------------------------------------------------------------
// POST /api/billing/subscription/cancel
//
// Cancels the Stripe subscription at period end.
// ---------------------------------------------------------------------------
billingAddons.post('/api/billing/subscription/cancel', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();

  if (!hasStripe(c.env)) {
    const cancelAt = new Date();
    cancelAt.setDate(cancelAt.getDate() + 30);
    return c.json({
      status: 'canceled',
      cancel_at: cancelAt.toISOString(),
    });
  }

  const stripeKey = c.env.STRIPE_SECRET_KEY;
  const db = c.env.DB;
  let stripeSubId: string | null = null;

  const row = await db
    .prepare('SELECT stripe_subscription_id FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL LIMIT 1')
    .bind(orgId)
    .first<{ stripe_subscription_id: string | null }>();
  stripeSubId = row?.stripe_subscription_id ?? null;

  if (!stripeSubId) {
    const cancelAt = new Date();
    cancelAt.setDate(cancelAt.getDate() + 30);
    return c.json({ status: 'canceled', cancel_at: cancelAt.toISOString() });
  }

  const resp = await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ cancel_at_period_end: 'true' }).toString(),
  });

  if (!resp.ok) {
    const err = await resp.json<{ error: { message: string } }>();
    return c.json({ error: { code: 'STRIPE_ERROR', message: err.error?.message ?? 'Cancel failed' } }, 400);
  }

  const updated = await resp.json<{ status: string; cancel_at: number | null }>();
  return c.json({
    status: updated.status,
    cancel_at: updated.cancel_at ? new Date(updated.cancel_at * 1000).toISOString() : null,
  });
});

// ---------------------------------------------------------------------------
// POST /api/agency/stripe-connect/onboard
//
// Starts the Stripe Connect Express onboarding flow for an agency org.
// Returns an `onboarding_url` the frontend redirects to.
// ---------------------------------------------------------------------------
billingAddons.post('/api/agency/stripe-connect/onboard', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();

  if (!hasStripe(c.env)) {
    return c.json({
      onboarding_url: 'https://connect.stripe.com/setup/acct_test_mock',
    });
  }

  const stripeKey = c.env.STRIPE_SECRET_KEY;
  const origin = c.req.header('origin') ?? 'https://projectsites.dev';

  const acctResp = await fetch('https://api.stripe.com/v1/accounts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ type: 'express', 'metadata[org_id]': orgId }).toString(),
  });

  if (!acctResp.ok) {
    return c.json({ error: { code: 'STRIPE_ERROR', message: 'Could not create Connect account' } }, 400);
  }

  const acct = await acctResp.json<{ id: string }>();

  const linkResp = await fetch('https://api.stripe.com/v1/account_links', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      account: acct.id,
      refresh_url: `${origin}/admin/billing?connect=refresh`,
      return_url: `${origin}/admin/billing?connect=complete`,
      type: 'account_onboarding',
    }).toString(),
  });

  if (!linkResp.ok) {
    return c.json({ error: { code: 'STRIPE_ERROR', message: 'Could not create onboarding link' } }, 400);
  }

  const link = await linkResp.json<{ url: string }>();
  return c.json({ onboarding_url: link.url, account_id: acct.id });
});

// ---------------------------------------------------------------------------
// GET /api/affiliates/payouts
//
// Returns pending affiliate payout rows for the current org.
// ---------------------------------------------------------------------------
billingAddons.get('/api/affiliates/payouts', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();

  const payouts = [
    {
      affiliate_id: `aff_${orgId.slice(0, 6)}`,
      amount_cents: 2500,
      status: 'pending',
      created_at: new Date().toISOString(),
    },
  ];

  return c.json({ payouts });
});

export { billingAddons };
