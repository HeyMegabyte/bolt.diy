/**
 * Stripe Link payment-intent endpoint for tenant-site purchases.
 *
 * @remarks
 *  Creates a PaymentIntent on the tenant's connected account with a
 *  1.5% application fee routed to the platform. Persists a pending Order
 *  row so the subsequent webhook can flip status without depending on
 *  client-reported state.
 *
 * @example
 *   POST /api/pay
 *   { "amount_cents": 5000, "currency": "usd", "customer_email": "j@x.com" }
 *   → { "client_secret": "pi_xxx_secret_yyy", "order_id": "..." }
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppContext } from '../env';
import { turnstile } from '../middleware/turnstile';
import { insertOrder } from '../services/tenant-db';
import {
  computeApplicationFee,
  createConnectedPaymentIntent,
  makeStripeClient,
} from '../services/stripe-tenant';

const paySchema = z.object({
  amount_cents: z.number().int().positive().max(10_000_000),
  currency: z.string().length(3).default('usd'),
  customer_email: z.string().email().optional(),
  kind: z.enum(['donation', 'product', 'service', 'ticket']).default('product'),
  reference: z.string().max(200).optional(),
});

const app = new Hono<AppContext>();

app.post('/', turnstile(), zValidator('json', paySchema), async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    throw new HTTPException(503, { message: 'Payments not configured' });
  }
  if (!c.env.STRIPE_CONNECTED_ACCOUNT_ID) {
    throw new HTTPException(503, { message: 'Tenant has no connected Stripe account' });
  }
  const body = c.req.valid('json');
  const feeBps = Number(c.env.PLATFORM_FEE_BPS);
  const stripe = makeStripeClient(c.env.STRIPE_SECRET_KEY);
  const idempotencyKey = `${c.env.TENANT_ID}:${c.var.requestId}`;

  const intent = await createConnectedPaymentIntent(stripe, {
    amountCents: body.amount_cents,
    currency: body.currency.toLowerCase(),
    connectedAccountId: c.env.STRIPE_CONNECTED_ACCOUNT_ID,
    feeBps,
    customerEmail: body.customer_email,
    metadata: {
      tenant_slug: c.env.TENANT_SLUG,
      tenant_id: c.env.TENANT_ID,
      kind: body.kind,
      reference: body.reference ?? '',
      idempotency_key: idempotencyKey,
    },
  });

  const orderId = crypto.randomUUID();
  await insertOrder(c.env.SITE_DB, {
    id: orderId,
    amount_cents: body.amount_cents,
    currency: body.currency.toLowerCase(),
    status: 'pending',
    customer_email: body.customer_email ?? '',
    stripe_payment_intent: intent.id,
    application_fee_cents: computeApplicationFee(body.amount_cents, feeBps),
    metadata_json: JSON.stringify({ kind: body.kind, reference: body.reference }),
  });

  return c.json({
    client_secret: intent.client_secret,
    payment_intent: intent.id,
    order_id: orderId,
    application_fee_cents: computeApplicationFee(body.amount_cents, feeBps),
  });
});

export default app;
