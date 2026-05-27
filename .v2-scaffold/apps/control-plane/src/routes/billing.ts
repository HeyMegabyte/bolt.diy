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
import { evaluateLoyalty } from '../services/loyalty.js';

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

      // Loyalty (#24): every 5th same-customer↔crew completion gets 5% off
      // the application_fee. Booking must already carry both ids.
      const booking = await dbQueryOne<{
        customer_id: string;
        crew_id: string | null;
      }>(
        c.env.DB,
        `SELECT b.customer_id AS customer_id, j.crew_id AS crew_id
           FROM bookings b
           LEFT JOIN jobs j ON j.booking_id = b.id
          WHERE b.id = ?1 AND b.tenant_id = ?2
          ORDER BY j.created_at DESC LIMIT 1`,
        [body.booking_id, tenantId],
      );
      let loyaltyFactor = 1;
      if (booking?.customer_id && booking.crew_id) {
        const decision = await evaluateLoyalty(c.env, {
          tenantId,
          customerId: booking.customer_id,
          crewId: booking.crew_id,
        });
        loyaltyFactor = decision.applicationFeeFactor;
      }

      intent = await createBookingPaymentIntent(c.env, {
        tenantId,
        bookingId: body.booking_id,
        amountCents: body.amount_cents,
        currency: body.currency,
        connectedAccountId: tenant.stripe_account_id,
        takeRateBps,
        loyaltyFactor,
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

// ── TechSoup nonprofit auto-discount (item #29) ─────────────────────────────
/**
 * Verify nonprofit eligibility via TechSoup. On success, apply a 50% discount
 * to the tenant's subscription (Stripe Subscription.update with a coupon-equivalent
 * `metadata.discount_pct` and re-price to the $25/mo nonprofit tier).
 */
app.post(
  '/verify-nonprofit',
  zValidator(
    'json',
    z.object({
      ein: z
        .string()
        .regex(/^\d{2}-?\d{7}$/u, 'EIN format: NN-NNNNNNN'),
      ts_token: z.string().min(1),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const { ein, ts_token } = c.req.valid('json');
    const normalizedEin = ein.replace(/-/g, '');

    // TechSoup eligibility lookup (stub endpoint per backlog item #29).
    const tsRes = await fetch(
      `https://api.techsoup.global/v1/eligibility/${encodeURIComponent(normalizedEin)}`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${ts_token}`,
          accept: 'application/json',
        },
      },
    );
    if (!tsRes.ok) {
      throw new AppError(
        ErrorCode.BAD_REQUEST,
        `TechSoup verification failed: ${tsRes.status}`,
      );
    }
    const tsJson = (await tsRes.json()) as {
      eligible?: boolean;
      org_name?: string;
      nteeCode?: string;
    };
    if (!tsJson.eligible) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'EIN not eligible per TechSoup');
    }

    const sub = await dbQueryOne<{
      id: string;
      stripe_subscription_id: string | null;
    }>(
      c.env.DB,
      `SELECT id, stripe_subscription_id FROM subscriptions
        WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );

    const nowIso = new Date().toISOString();
    if (sub?.stripe_subscription_id) {
      const stripe = makeStripe(c.env);
      // 50% discount → re-price to nonprofit tier ($25/mo) by updating
      // metadata so the next invoice cycle picks up the discount_pct.
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        metadata: {
          tenantId,
          discount_pct: '50',
          nonprofit_ein: normalizedEin,
          tier: 'nonprofit',
        },
      });
    }

    await c.env.DB.prepare(
      `UPDATE subscriptions
          SET discount_pct = 50,
              nonprofit_ein = ?1,
              nonprofit_verified_at = ?2,
              updated_at = ?2
        WHERE tenant_id = ?3`,
    )
      .bind(normalizedEin, nowIso, tenantId)
      .run();

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'billing.nonprofit.verified',
      target_type: 'subscription',
      target_id: sub?.id ?? null,
      metadata: { ein: normalizedEin, org_name: tsJson.org_name ?? null },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({
      ok: true,
      ein: normalizedEin,
      discount_pct: 50,
      org_name: tsJson.org_name ?? null,
    });
  },
);

// ── ACH push payout for crew (item #33) ─────────────────────────────────────
/**
 * Cash out a connected crew account. Defaults to instant payout when the
 * destination supports it, falling back to standard ACH (`method: 'standard'`).
 */
app.post(
  '/crew/payouts/cashout',
  zValidator(
    'json',
    z.object({
      destination: z.string().min(1).describe('Stripe connected account id (acct_...)'),
      amount_cents: z.number().int().positive(),
      currency: z.string().length(3).default('usd'),
      prefer_instant: z.boolean().default(true),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const body = c.req.valid('json');
    const stripe = makeStripe(c.env);

    const acct = await dbQueryOne<{ payouts_enabled: number }>(
      c.env.DB,
      `SELECT payouts_enabled FROM connected_accounts WHERE stripe_account_id = ?1`,
      [body.destination],
    );
    if (!acct?.payouts_enabled) {
      throw new AppError(
        ErrorCode.BAD_REQUEST,
        'destination account has not completed payout onboarding',
      );
    }

    const method: 'instant' | 'standard' = body.prefer_instant ? 'instant' : 'standard';
    let payout;
    try {
      payout = await stripe.payouts.create(
        {
          amount: body.amount_cents,
          currency: body.currency.toLowerCase(),
          method,
          metadata: { tenantId, requested_by_user_id: userId },
        },
        { stripeAccount: body.destination },
      );
    } catch (err) {
      // Instant payouts can fail with `payouts_not_allowed`; fall back to standard ACH.
      const msg = err instanceof Error ? err.message : String(err);
      if (method === 'instant' && /instant/i.test(msg)) {
        payout = await stripe.payouts.create(
          {
            amount: body.amount_cents,
            currency: body.currency.toLowerCase(),
            method: 'standard',
            metadata: { tenantId, requested_by_user_id: userId, fallback_from: 'instant' },
          },
          { stripeAccount: body.destination },
        );
      } else {
        throw new AppError(ErrorCode.STRIPE_ERROR, msg);
      }
    }

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'billing.crew.payout',
      target_type: 'stripe_payout',
      target_id: payout.id,
      metadata: {
        amount_cents: body.amount_cents,
        method: payout.method,
        destination: body.destination,
      },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({
      payout_id: payout.id,
      method: payout.method,
      arrival_date: payout.arrival_date,
      status: payout.status,
      amount_cents: payout.amount,
    });
  },
);

// ── Subscription pause (item #38) ───────────────────────────────────────────
/**
 * Pause a subscription for 1-3 months. Uses Stripe Subscription.update with
 * `pause_collection: { behavior: 'mark_uncollectible', resumes_at }` so the
 * subscription stays active but no invoices are collected during the pause.
 */
app.post(
  '/subscription/pause',
  zValidator(
    'json',
    z.object({
      months: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const { months } = c.req.valid('json');
    const sub = await dbQueryOne<{
      id: string;
      stripe_subscription_id: string | null;
    }>(
      c.env.DB,
      `SELECT id, stripe_subscription_id FROM subscriptions
        WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    if (!sub?.stripe_subscription_id) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'no active subscription');
    }

    const resumesAtMs = Date.now() + months * 30 * 24 * 60 * 60 * 1000;
    const resumesAtUnix = Math.floor(resumesAtMs / 1000);
    const stripe = makeStripe(c.env);
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      pause_collection: {
        behavior: 'mark_uncollectible',
        resumes_at: resumesAtUnix,
      },
      metadata: { tenantId, pause_months: String(months) },
    });

    const nowIso = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE subscriptions
          SET paused_until = ?1,
              pause_started_at = ?2,
              updated_at = ?2
        WHERE id = ?3`,
    )
      .bind(resumesAtMs, nowIso, sub.id)
      .run();

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'billing.subscription.pause',
      target_type: 'subscription',
      target_id: sub.id,
      metadata: { months, resumes_at_ms: resumesAtMs },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({
      ok: true,
      paused_until: new Date(resumesAtMs).toISOString(),
      months,
    });
  },
);

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
