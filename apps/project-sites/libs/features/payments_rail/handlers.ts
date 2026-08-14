/**
 * @module libs/features/payments_rail/handlers
 * @description Hono routes for the Payments Rail feature module.
 *
 * | Method | Path                      | Purpose                                  |
 * | ------ | ------------------------- | ---------------------------------------- |
 * | GET    | /api/payments/methods     | List saved payment methods for caller org |
 * | POST   | /api/payments/intent      | Create a payment intent via Stripe/Square |
 * | GET    | /api/payments/history     | Paginated payment event history           |
 *
 * All routes 404 when the `payments_rail` flag is off (never 403 — do not leak
 * feature existence) per [[feature-flags]]. Missing auth also gets a 401 before
 * the flag check is surfaced.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { Env, Variables } from '../../../src/types/env.js';
import { unauthorized, notFound } from '../../../src/lib/feature_guard.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import {
  FLAG_KEY,
  getPaymentMethods,
  recordPaymentIntent,
  getPaymentHistory,
} from './service.js';
import {
  PaymentMethodsResponseSchema,
  PaymentIntentResponseSchema,
  PaymentHistoryResponseSchema,
  PaymentHistoryQuerySchema,
  CreatePaymentIntentBodySchema,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const paymentsRail = new Hono<AppContext>();

const badRequest = (c: import('hono').Context<AppContext>, message: string) =>
  c.json({ error: { code: 'BAD_REQUEST', message } }, 400);

/** Auth + flag gate. Returns a Response to short-circuit, or null to proceed. */
async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

/** List saved payment methods for the authenticated org. */
paymentsRail.get('/api/payments/methods', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return badRequest(c, 'No org context');

  const rows = await getPaymentMethods(c.env, orgId);

  return c.json(
    PaymentMethodsResponseSchema.parse({
      methods: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        brand: r.brand ?? undefined,
        last4: r.last4 ?? undefined,
        expMonth: r.expMonth ?? undefined,
        expYear: r.expYear ?? undefined,
        isDefault: Boolean(r.isDefault),
      })),
      count: rows.length,
    }),
  );
});

/** Create a payment intent via the configured provider. */
paymentsRail.post('/api/payments/intent', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return badRequest(c, 'No org context');

  const rawBody = await c.req.json().catch(() => null);
  const parsed = CreatePaymentIntentBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', issues: parsed.error.issues } }, 422);
  }

  const { amountCents, currency, provider, description } = parsed.data;
  const intentId = `mock_intent_${randomUUID()}`;
  const now = new Date().toISOString();
  const id = randomUUID();

  // NOTE: in production, call the Stripe / Square SDK here to create the real
  // intent, then persist the resulting intentId via recordPaymentIntent.
  await recordPaymentIntent(c.env, {
    id,
    orgId,
    provider,
    intentId,
    amountCents,
    currency,
    description: description ?? null,
    status: 'requires_payment_method',
  });

  return c.json(
    PaymentIntentResponseSchema.parse({
      intentId,
      clientSecret: provider === 'stripe' ? `${intentId}_secret_mock` : undefined,
      provider,
      amountCents,
      currency,
      status: 'requires_payment_method',
      createdAt: now,
    }),
    201,
  );
});

/** Paginated payment event history for the authenticated org. */
paymentsRail.get('/api/payments/history', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return badRequest(c, 'No org context');

  const queryParsed = PaymentHistoryQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!queryParsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', issues: queryParsed.error.issues } }, 422);
  }

  const { events, total } = await getPaymentHistory(c.env, orgId, queryParsed.data);

  return c.json(
    PaymentHistoryResponseSchema.parse({
      events,
      count: total,
      page: queryParsed.data.page,
      pageSize: queryParsed.data.pageSize,
    }),
  );
});
