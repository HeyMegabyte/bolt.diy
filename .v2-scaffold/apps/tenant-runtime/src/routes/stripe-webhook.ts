/**
 * Stripe webhook handler — Connect Express events.
 *
 * @remarks
 *  Flow:
 *   1. Verify the `Stripe-Signature` header against STRIPE_WEBHOOK_SECRET.
 *   2. Dedupe by event id via D1 `webhook_events` UNIQUE constraint.
 *   3. Persist the tenant-relevant state change (order status).
 *   4. Fan out to control-plane via service binding so the platform can
 *      reconcile billing meters + application-fee tracking.
 *
 *  Returns 2xx unconditionally once verified+deduped, to stop Stripe retries.
 *
 * @throws HTTP 400 when signature verification fails.
 */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../env';
import { makeStripeClient, verifyWebhookSignature } from '../services/stripe-tenant';
import { recordWebhookEventIfNew, updateOrderStatus } from '../services/tenant-db';

const app = new Hono<AppContext>();

app.post('/', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_WEBHOOK_SECRET) {
    throw new HTTPException(503, { message: 'Stripe webhook not configured' });
  }
  const sig = c.req.header('stripe-signature');
  if (!sig) throw new HTTPException(400, { message: 'Missing Stripe-Signature' });
  const payload = await c.req.text();
  const stripe = makeStripeClient(c.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = await verifyWebhookSignature(stripe, payload, sig, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw new HTTPException(400, {
      message: `Signature verify failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const isNew = await recordWebhookEventIfNew(c.env.SITE_DB, 'stripe', event.id);
  if (!isNew) {
    return c.json({ received: true, deduped: true });
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as { id: string };
      await updateOrderStatus(c.env.SITE_DB, pi.id, 'succeeded');
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as { id: string };
      await updateOrderStatus(c.env.SITE_DB, pi.id, 'failed');
      break;
    }
    case 'charge.refunded': {
      const ch = event.data.object as { payment_intent: string | null };
      if (ch.payment_intent) {
        await updateOrderStatus(c.env.SITE_DB, ch.payment_intent, 'refunded');
      }
      break;
    }
    default:
      // Other event types: nothing tenant-side; control-plane handles.
      break;
  }

  // Fan out to control-plane for platform-level reconciliation.
  if (c.env.CONTROL_PLANE) {
    c.executionCtx.waitUntil(
      reportToControlPlane(c.env.CONTROL_PLANE, {
        tenant_id: c.env.TENANT_ID,
        tenant_slug: c.env.TENANT_SLUG,
        event_id: event.id,
        event_type: event.type,
      }).catch((err) => {
        console.warn('control-plane fan-out failed', {
          requestId: c.var.requestId,
          tenant: c.env.TENANT_SLUG,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
    );
  }

  return c.json({ received: true });
});

async function reportToControlPlane(
  fetcher: NonNullable<AppContext['Bindings']['CONTROL_PLANE']>,
  body: { tenant_id: string; tenant_slug: string; event_id: string; event_type: string },
): Promise<void> {
  await fetcher.fetch('https://control-plane.internal/internal/tenant-stripe-event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export default app;
