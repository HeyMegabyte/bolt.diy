/**
 * Billing — Stripe Embedded Checkout (Link only), inline PaymentIntent (marketplace),
 * Connect onboarding, Customer Portal, subscription + entitlements, refund requests.
 *
 * Every PaymentIntent uses `automatic_payment_methods: { enabled: true,
 * allow_redirects: 'never' }` per ADR-0004 — Stripe Link only, no separate Element.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type Stripe from 'stripe';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { dbQueryOne } from '../services/db.js';
import { writeAudit } from '../services/audit.js';
import {
  computeTakeRateBps,
  createBookingPaymentIntent,
  createConnectOnboardingLink,
  createDirectPaymentIntent,
  makeStripe,
} from '../services/stripe.js';

const app = new Hono<HonoEnv>();

function tenantOrThrow(c: any): string {
  requireAuth(c);
  const tenantId = c.get('tenantId') ?? c.get('orgId');
  if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');
  return tenantId;
}

// ── Embedded Checkout (Link-only) ────────────────────────────────────────────
app.post(
  '/checkout',
  zValidator(
    'json',
    z.object({
      mode: z.enum(['payment', 'subscription']),
      line_items: z
        .array(
          z.object({
            price: z.string().min(1),
            quantity: z.number().int().positive().default(1),
          }),
        )
        .min(1),
      success_url: z.string().url(),
      cancel_url: z.string().url(),
      customer_email: z.string().email().optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const body = c.req.valid('json');
    const stripe = makeStripe(c.env);
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: body.mode,
      line_items: body.line_items,
      payment_method_types: ['card', 'link'],
      return_url: `${body.success_url}?session_id={CHECKOUT_SESSION_ID}`,
      customer_email: body.customer_email,
      metadata: { tenantId, userId },
    });
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'billing.checkout.create',
      target_type: 'stripe_checkout_session',
      target_id: session.id,
      metadata: { mode: body.mode },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ client_secret: session.client_secret });
  },
);

// ── Inline PaymentIntent (marketplace + direct) ─────────────────────────────
app.post(
  '/payment-intent',
  zValidator(
    'json',
    z.object({
      rail: z.enum(['marketplace', 'direct']),
      booking_id: z.string().uuid().optional(),
      invoice_id: z.string().uuid().optional(),
      amount_cents: z.number().int().positive(),
      currency: z.string().length(3).default('usd'),
      customer_email: z.string().email().optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const body = c.req.valid('json');
    const tenant = await dbQueryOne<{
      stripe_account_id: string | null;
      created_at: string;
    }>(
      c.env.DB,
      `SELECT stripe_account_id, created_at FROM tenants WHERE id = ?1`,
      [tenantId],
    );
    if (!tenant?.stripe_account_id) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'tenant has no connected Stripe account');
    }
    const isLive = c.env.STRIPE_SECRET_KEY.startsWith('sk_live_');
    let intent: Stripe.PaymentIntent;
    if (body.rail === 'marketplace') {
      if (!body.booking_id) {
        throw new AppError(ErrorCode.BAD_REQUEST, 'booking_id required for marketplace rail');
      }
      const takeRateBps = computeTakeRateBps(c.env, new Date(tenant.created_at).getTime());
      intent = await createBookingPaymentIntent(c.env, {
        tenantId,
        bookingId: body.booking_id,
        amountCents: body.amount_cents,
        currency: body.currency,
        connectedAccountId: tenant.stripe_account_id,
        takeRateBps,
        isLiveMode: isLive,
      });
    } else {
      if (!body.invoice_id) {
        throw new AppError(ErrorCode.BAD_REQUEST, 'invoice_id required for direct rail');
      }
      intent = await createDirectPaymentIntent(c.env, {
        tenantId,
        invoiceId: body.invoice_id,
        amountCents: body.amount_cents,
        currency: body.currency,
        connectedAccountId: tenant.stripe_account_id,
        isLiveMode: isLive,
      });
    }
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: `billing.payment_intent.${body.rail}`,
      target_type: 'stripe_payment_intent',
      target_id: intent.id,
      metadata: { amount_cents: body.amount_cents, currency: body.currency },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({
      payment_intent: intent.id,
      client_secret: intent.client_secret,
      application_fee_cents: intent.application_fee_amount ?? 0,
    });
  },
);

// ── Customer Portal ─────────────────────────────────────────────────────────
app.post(
  '/portal',
  zValidator('json', z.object({ return_url: z.string().url() })),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const { return_url } = c.req.valid('json');
    const sub = await dbQueryOne<{ stripe_customer_id: string | null }>(
      c.env.DB,
      `SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    if (!sub?.stripe_customer_id) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'no Stripe customer for tenant');
    }
    const stripe = makeStripe(c.env);
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url,
    });
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'billing.portal.session',
      target_type: 'stripe_billing_portal_session',
      target_id: session.id,
      metadata: {},
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ url: session.url });
  },
);

// ── Connect Express onboarding ──────────────────────────────────────────────
app.post(
  '/connect/onboarding-link',
  zValidator(
    'json',
    z.object({ return_url: z.string().url(), refresh_url: z.string().url() }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const { return_url, refresh_url } = c.req.valid('json');
    const existing = await dbQueryOne<{ stripe_account_id: string | null }>(
      c.env.DB,
      `SELECT stripe_account_id FROM tenants WHERE id = ?1`,
      [tenantId],
    );
    const { accountId, url } = await createConnectOnboardingLink(c.env, {
      tenantId,
      accountId: existing?.stripe_account_id ?? undefined,
      returnUrl: return_url,
      refreshUrl: refresh_url,
    });
    if (!existing?.stripe_account_id) {
      await c.env.DB.prepare(
        `UPDATE tenants SET stripe_account_id = ?1, updated_at = ?2 WHERE id = ?3`,
      )
        .bind(accountId, new Date().toISOString(), tenantId)
        .run();
    }
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'billing.connect.onboarding_link',
      target_type: 'stripe_account',
      target_id: accountId,
      metadata: {},
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ account_id: accountId, onboarding_url: url });
  },
);

// ── Subscription + entitlements ─────────────────────────────────────────────
app.get('/subscription', async (c) => {
  const tenantId = tenantOrThrow(c);
  const sub = await dbQueryOne(
    c.env.DB,
    `SELECT id, tier, status, current_period_end, cancel_at_period_end, stripe_subscription_id
     FROM subscriptions WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT 1`,
    [tenantId],
  );
  return c.json({ subscription: sub });
});

app.get('/entitlements', async (c) => {
  const tenantId = tenantOrThrow(c);
  const sub = await dbQueryOne<{ tier: string; status: string }>(
    c.env.DB,
    `SELECT tier, status FROM subscriptions WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT 1`,
    [tenantId],
  );
  const tier = sub?.tier ?? 'free';
  return c.json({
    tier,
    status: sub?.status ?? 'inactive',
    limits: ENTITLEMENTS[tier] ?? ENTITLEMENTS['free'],
  });
});

const ENTITLEMENTS: Record<string, Record<string, number>> = {
  free: { sites: 1, custom_domains: 0, monthly_jobs: 25, team_seats: 1 },
  starter: { sites: 3, custom_domains: 1, monthly_jobs: 250, team_seats: 5 },
  growth: { sites: 10, custom_domains: 5, monthly_jobs: 2500, team_seats: 25 },
  scale: { sites: 50, custom_domains: 25, monthly_jobs: 25_000, team_seats: 100 },
};

// ── Usage stream (DO fan-out) ───────────────────────────────────────────────
app.get('/usage/stream', async (c) => {
  const tenantId = tenantOrThrow(c);
  const upgrade = c.req.header('upgrade');
  if (upgrade?.toLowerCase() !== 'websocket') {
    throw new AppError(ErrorCode.BAD_REQUEST, 'WebSocket upgrade required');
  }
  // We piggy-back on the LOG_HUB DO for usage events under namespace `usage:{tenantId}`.
  const stub = c.env.LOG_HUB.get(c.env.LOG_HUB.idFromName(`usage:${tenantId}`));
  return stub.fetch(`https://do/stream`);
});

// ── Refund request ──────────────────────────────────────────────────────────
app.post(
  '/refund-request',
  zValidator(
    'json',
    z.object({
      payment_intent: z.string().min(1),
      amount_cents: z.number().int().positive().optional(),
      reason: z.string().max(500).optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const body = c.req.valid('json');
    const stripe = makeStripe(c.env);
    const refund = await stripe.refunds.create({
      payment_intent: body.payment_intent,
      amount: body.amount_cents,
      reason: 'requested_by_customer',
      metadata: { tenantId, requested_by_user_id: userId, reason: body.reason ?? '' },
    });
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'billing.refund.request',
      target_type: 'stripe_refund',
      target_id: refund.id,
      metadata: { payment_intent: body.payment_intent, amount_cents: body.amount_cents },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({ refund_id: refund.id, status: refund.status });
  },
);

export default app;
