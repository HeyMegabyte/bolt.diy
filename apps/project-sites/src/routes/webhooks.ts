/**
 * @module routes/webhooks
 * @description Inbound webhook routes for external service integrations.
 *
 * Currently handles Stripe webhooks with full signature verification,
 * idempotency checking, event storage, and processing pipeline.
 *
 * ## Processing Pipeline
 *
 * ```
 * POST /webhooks/stripe
 *   1. Verify Stripe signature (HMAC-SHA256)
 *   2. Parse JSON event body
 *   3. Check idempotency (prevent duplicate processing)
 *   4. Store webhook event in D1
 *   5. Dispatch to billing service handler
 *   6. Mark event as processed / failed
 *   7. Log audit trail
 * ```
 *
 * ## Handled Stripe Events
 *
 * | Event Type                       | Handler                        | Effect                      |
 * | -------------------------------- | ------------------------------ | --------------------------- |
 * | `checkout.session.completed`     | `handleCheckoutCompleted`      | Upgrade to paid plan        |
 * | `customer.subscription.updated`  | `handleSubscriptionUpdated`    | Sync status & period        |
 * | `customer.subscription.deleted`  | `handleSubscriptionDeleted`    | Downgrade to free           |
 * | `invoice.payment_failed`         | `handlePaymentFailed`          | Mark as past_due            |
 * | `invoice.paid`                   | emits `invoice.paid` event     | Revenue analytics + renewal |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import {
  verifyStripeSignature,
  checkWebhookIdempotency,
  storeWebhookEvent,
  markWebhookProcessed,
} from '../services/webhook.js';
import * as billingService from '../services/billing.js';
import * as auditService from '../services/audit.js';
import * as connectService from '../services/stripe_connect.js';
import { handleWalletStripeEvent } from '../services/wallet_webhook.js';
import { tryEmitEvent } from '../services/emit_event.js';
import { safeWaitUntil } from '../lib/wait-until.js';
import type { EventType } from '../services/event_bus.js';
import { sha256Hex, badRequest } from '@project-sites/shared';
import { createLogger } from '../observability/index.js';

const webhooks = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Map a Stripe `customer.subscription.*` status to the billing-bus event type to
 * emit, or `null` when the status is not a lifecycle transition we put on the bus
 * (cancellation rides the dedicated `customer.subscription.deleted` event, and
 * `incomplete`/`paused` are pre-active states with nothing to orchestrate).
 *
 * Pure + total — same status always yields the same result, no I/O.
 *
 * @param status - The Stripe subscription `status` field.
 * @returns `'subscription.active' | 'subscription.past_due' | null`.
 * @example subscriptionEventType('past_due') // 'subscription.past_due'
 */
export function subscriptionEventType(
  status: string,
): 'subscription.active' | 'subscription.past_due' | null {
  if (status === 'active' || status === 'trialing') return 'subscription.active';
  if (status === 'past_due' || status === 'unpaid') return 'subscription.past_due';
  return null;
}

/**
 * Best-effort emit of a billing-lifecycle event onto the durable outbox (drained
 * every 5 min to Tinybird analytics + Hatchet billing orchestration). Idempotent
 * per Stripe event id — a webhook replay never double-emits. Fire-and-forget via
 * `waitUntil` so it never blocks or fails the webhook ack (`tryEmitEvent` already
 * never throws). Skips silently when no `orgId` is known — the bus requires a
 * `tenantId`, and a billing event with no tenant has nothing to orchestrate.
 */
function emitBillingEvent(
  c: import('hono').Context<{ Bindings: Env; Variables: Variables }>,
  type: EventType,
  orgId: string | undefined,
  stripeEventId: string,
  data: Record<string, unknown>,
): void {
  if (!orgId) return;
  const p = tryEmitEvent(
    c.env,
    {
      type,
      producer: 'stripe',
      tenantId: orgId,
      traceId: c.get('requestId') ?? stripeEventId,
      data,
    },
    { scope: [stripeEventId] },
  );
  safeWaitUntil(c, p);
}

/**
 * Stripe webhook handler.
 * Verifies signature, checks idempotency, processes event, marks processed.
 */
webhooks.post('/webhooks/stripe', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature') ?? '';
  const requestId = c.get('requestId');

  // 1. Verify signature
  const verification = await verifyStripeSignature(rawBody, signature, c.env.STRIPE_WEBHOOK_SECRET);

  if (!verification.valid) {
    console.error(
      JSON.stringify({
        level: 'warn',
        service: 'webhook',
        provider: 'stripe',
        message: `Signature verification failed: ${verification.reason}`,
        request_id: requestId,
      }),
    );
    return c.json(
      { error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: verification.reason } },
      401,
    );
  }

  // 2. Parse event
  let event: {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw badRequest('Invalid JSON body');
  }

  const db = c.env.DB;

  // 3. Check idempotency
  const idempotencyCheck = await checkWebhookIdempotency(db, 'stripe', event.id);
  if (idempotencyCheck.isDuplicate) {
    return c.json({ received: true, duplicate: true }, 200);
  }

  // 4. Store event
  const payloadHash = await sha256Hex(rawBody);
  const { id: webhookEventId } = await storeWebhookEvent(db, {
    provider: 'stripe',
    event_id: event.id,
    event_type: event.type,
    payload_hash: payloadHash,
    status: 'processing',
  });

  // 5. Process event
  try {
    const obj = event.data.object;

    switch (event.type) {
      case 'checkout.session.completed': {
        const meta = (obj.metadata as Record<string, string> | undefined) ?? {};
        // Wallet-subscription checkouts carry `metadata.kind = 'wallet'`
        // (set by `wallet.startSubscription`). Route those to the wallet
        // handler; everything else stays on the existing billing path.
        if (meta.kind === 'wallet' || meta.wallet_topup === 'auto') {
          await handleWalletStripeEvent(c.env, event.type, obj);
        } else {
          await billingService.handleCheckoutCompleted(db, c.env, {
            customer: obj.customer as string,
            subscription: obj.subscription as string,
            metadata: obj.metadata as { org_id?: string; site_id?: string },
          });
          // Fire-and-forget Novu: notify the org owner their plan is active.
          // Fully isolated — Hono's c.executionCtx getter throws when absent
          // (e.g. tests), so guard it; notification never affects the webhook.
          if (meta.org_id) {
            try {
              const { notifyOwnerEvent } = await import('../services/notify.js');
              const p = notifyOwnerEvent(c.env, db, {
                orgId: meta.org_id,
                event: {
                  event: 'payment.succeeded',
                  tenantId: meta.org_id,
                  // Stripe amounts are minor units (cents); fall back to 0/usd so
                  // the typed event always validates → the bell always fires.
                  amountCents: Number((obj as { amount_total?: number }).amount_total ?? 0),
                  currency: String((obj as { currency?: string }).currency ?? 'usd'),
                },
              });
              safeWaitUntil(c, p);
            } catch {
              /* notify is best-effort */
            }
          }
          // Subscription is now active — put it on the durable bus for the
          // billing-analytics + entitlement-orchestration plane.
          emitBillingEvent(c, 'subscription.active', meta.org_id, event.id, {
            customer: String(obj.customer ?? ''),
            subscription: String(obj.subscription ?? ''),
            amountCents: Number((obj as { amount_total?: number }).amount_total ?? 0),
            currency: String((obj as { currency?: string }).currency ?? 'usd'),
          });
          // Plan flipped free → paid: entitlements materially changed. Emit so the
          // orchestration plane can provision paid capabilities (custom domains, caps).
          emitBillingEvent(c, 'entitlement.updated', meta.org_id, event.id, {
            plan: 'paid',
            paid: true,
            reason: 'checkout.completed',
          });
        }
        break;
      }

      case 'payment_intent.succeeded':
        // One-time wallet top-ups fire payment_intent.succeeded with
        // metadata.kind = 'wallet_topup'. Non-wallet intents fall through
        // as a no-op (we don't otherwise process bare PaymentIntents).
        await handleWalletStripeEvent(c.env, event.type, obj);
        break;

      case 'payment_method.attached':
        await handleWalletStripeEvent(c.env, event.type, obj);
        break;

      case 'customer.subscription.updated': {
        const subStatus = obj.status as string;
        await billingService.handleSubscriptionUpdated(db, {
          id: obj.id as string,
          status: subStatus,
          cancel_at_period_end: obj.cancel_at_period_end as boolean,
          current_period_start: obj.current_period_start as number,
          current_period_end: obj.current_period_end as number,
          metadata: obj.metadata as { org_id?: string },
        });
        // active/trialing → subscription.active; past_due/unpaid → subscription.past_due.
        const updType = subscriptionEventType(subStatus);
        if (updType) {
          emitBillingEvent(
            c,
            updType,
            (obj.metadata as { org_id?: string } | undefined)?.org_id,
            event.id,
            {
              subscription: String(obj.id ?? ''),
              status: subStatus,
              cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
            },
          );
        }
        break;
      }

      case 'customer.subscription.deleted':
        await billingService.handleSubscriptionDeleted(db, {
          id: obj.id as string,
          metadata: obj.metadata as { org_id?: string },
        });
        emitBillingEvent(
          c,
          'subscription.canceled',
          (obj.metadata as { org_id?: string } | undefined)?.org_id,
          event.id,
          {
            subscription: String(obj.id ?? ''),
          },
        );
        // Plan flipped paid → free: entitlements revoked. Emit so the
        // orchestration plane can deprovision paid capabilities.
        emitBillingEvent(
          c,
          'entitlement.updated',
          (obj.metadata as { org_id?: string } | undefined)?.org_id,
          event.id,
          {
            plan: 'free',
            paid: false,
            reason: 'subscription.deleted',
          },
        );
        break;

      case 'invoice.payment_failed': {
        const failMeta = (obj.metadata as { org_id?: string } | undefined) ?? {};
        await billingService.handlePaymentFailed(db, {
          subscription: obj.subscription as string,
          metadata: failMeta,
        });
        // Fire-and-forget Novu: alert the org owner so they can fix billing.
        if (failMeta.org_id) {
          try {
            const { notifyOwnerEvent } = await import('../services/notify.js');
            const p = notifyOwnerEvent(c.env, db, {
              orgId: failMeta.org_id,
              event: {
                event: 'payment.failed',
                tenantId: failMeta.org_id,
                amountCents: Number((obj as { amount_due?: number }).amount_due ?? 0),
                currency: String((obj as { currency?: string }).currency ?? 'usd'),
              },
            });
            safeWaitUntil(c, p);
          } catch {
            /* notify is best-effort */
          }
        }
        // Dunning starts — emit invoice.failed for the billing-recovery plane.
        emitBillingEvent(c, 'invoice.failed', failMeta.org_id, event.id, {
          subscription: String(obj.subscription ?? ''),
          amountCents: Number((obj as { amount_due?: number }).amount_due ?? 0),
          currency: String((obj as { currency?: string }).currency ?? 'usd'),
        });
        break;
      }

      case 'invoice.paid': {
        // Backup for checkout.session.completed + wallet sub renewal credit.
        // Wallet handler is a no-op for non-wallet invoices.
        await handleWalletStripeEvent(c.env, event.type, obj);
        // Successful renewal/payment — emit invoice.paid for revenue analytics.
        emitBillingEvent(
          c,
          'invoice.paid',
          (obj.metadata as { org_id?: string } | undefined)?.org_id,
          event.id,
          {
            invoice: String(obj.id ?? ''),
            subscription: String(obj.subscription ?? ''),
            amountCents: Number((obj as { amount_paid?: number }).amount_paid ?? 0),
            currency: String((obj as { currency?: string }).currency ?? 'usd'),
          },
        );
        break;
      }

      case 'account.updated':
        // Stripe Connect (item #97): the customer's connected account
        // changed — sync charges_enabled / payouts_enabled into D1.
        await connectService.handleAccountUpdated(db, {
          id: obj.id as string,
          charges_enabled: obj.charges_enabled as boolean | undefined,
          payouts_enabled: obj.payouts_enabled as boolean | undefined,
          metadata: obj.metadata as { org_id?: string },
        });
        break;

      default:
        console.warn(
          JSON.stringify({
            level: 'info',
            service: 'webhook',
            message: `Unhandled Stripe event type: ${event.type}`,
            request_id: requestId,
          }),
        );
    }

    // 6. Mark processed
    if (webhookEventId) {
      await markWebhookProcessed(db, webhookEventId, 'processed');
    }

    // Log audit with descriptive messages
    const objMeta = event.data.object.metadata as Record<string, string> | undefined;
    const orgId = objMeta?.org_id;
    if (orgId) {
      const webhookMessages: Record<string, string> = {
        'checkout.session.completed': `Stripe webhook '${event.type}' processed — checkout completed, plan upgraded`,
        'customer.subscription.updated': `Stripe webhook '${event.type}' processed — subscription status updated`,
        'customer.subscription.deleted': `Stripe webhook '${event.type}' processed — subscription canceled, downgraded to free`,
        'invoice.payment_failed': `Stripe webhook '${event.type}' processed — payment failed, subscription at risk`,
        'invoice.paid': `Stripe webhook '${event.type}' processed — invoice payment confirmed`,
        'account.updated': `Stripe webhook '${event.type}' processed — connected account state synced`,
      };
      const webhookMsg = webhookMessages[event.type] || `Stripe webhook '${event.type}' processed`;
      await auditService.writeAuditLog(db, {
        org_id: orgId,
        actor_id: null,
        action: `webhook.stripe.${event.type}`,
        message: webhookMsg,
        target_type: 'webhook',
        target_id: event.id,
        metadata_json: {
          event_type: event.type,
          site_id: objMeta?.site_id ?? null,
        },
        request_id: requestId,
      });
    }
  } catch (err) {
    if (webhookEventId) {
      await markWebhookProcessed(
        db,
        webhookEventId,
        'failed',
        err instanceof Error ? err.message : 'Unknown error',
      );
    }

    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    // #24 — this catch handles the error (marks failed + audits) instead of
    // re-throwing, so the global error-handler's capture is bypassed.
    // A Stripe webhook failure is payment-critical → log explicitly, never silent.
    // `c.executionCtx` is a getter that THROWS when no ExecutionContext exists
    // (unit tests, some runtime paths) — access it defensively.
    let webhookCtx: ExecutionContext | undefined;
    try {
      webhookCtx = c.executionCtx;
    } catch {
      webhookCtx = undefined;
    }
    createLogger(c.env, webhookCtx, {
      service: 'webhooks',
      environment: c.env.ENVIRONMENT ?? 'production',
      request_id: requestId ?? undefined,
    }).error(
      'stripe webhook processing failed',
      {
        provider: 'stripe',
        event_type: event.type,
        webhook_event_id: webhookEventId ?? undefined,
        request_id: requestId ?? undefined,
      },
      err instanceof Error ? err : new Error(String(err)),
    );
    console.error(
      JSON.stringify({
        level: 'error',
        service: 'webhook',
        provider: 'stripe',
        event_type: event.type,
        message: errMsg,
        request_id: requestId,
      }),
    );

    // Audit log for failed webhook processing
    const failedObjMeta = event.data.object.metadata as Record<string, string> | undefined;
    if (failedObjMeta?.org_id) {
      auditService
        .writeAuditLog(db, {
          org_id: failedObjMeta.org_id,
          actor_id: null,
          action: 'webhook.processing_failed',
          message: `Stripe webhook '${event.type}' processing failed: ${errMsg}`,
          target_type: 'webhook',
          target_id: event.id,
          metadata_json: {
            event_type: event.type,
            site_id: failedObjMeta?.site_id ?? null,
            error: errMsg,
          },
          request_id: requestId,
        })
        .catch(() => {});
    }

    // Return 200 to Stripe to prevent retries for processing errors
    return c.json({ received: true, error: 'Processing failed' }, 200);
  }

  return c.json({ received: true }, 200);
});

export { webhooks };
