/**
 * Webhooks — Stripe (signature-verified, idempotent via billing_events) + Twilio
 * (HMAC-verified). Bypasses auth + tenant middleware in `index.ts`.
 */

import { Hono } from 'hono';
import type Stripe from 'stripe';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { constructWebhookEvent } from '../services/stripe.js';
import { recordBillingEvent } from '../services/billing-events.js';
import { dbExecute, dbQueryOne } from '../services/db.js';
import { sha256Hex } from '../services/crypto.js';

const app = new Hono<HonoEnv>();

// ── Stripe ───────────────────────────────────────────────────────────────────
app.post('/stripe', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID, 'missing signature');
  const raw = await c.req.text();
  const event = await constructWebhookEvent(c.env, raw, signature);

  // Idempotency: KV-backed dedupe across replays + a billing_events insert per persist.
  const cacheKey = `webhook:stripe:${event.id}`;
  const already = await c.env.CACHE.get(cacheKey);
  if (already) return c.json({ ok: true, deduped: true });
  await c.env.CACHE.put(cacheKey, '1', { expirationTtl: 60 * 60 * 24 * 7 });

  const orgId = (event.data.object as { metadata?: { tenantId?: string } })?.metadata?.tenantId ?? 'platform';
  const stripeObj = event.data.object as { id?: string; object?: string; amount?: number; currency?: string };
  const { duplicate } = await recordBillingEvent(c.env, {
    org_id: orgId,
    event_type: event.type,
    source: 'stripe_webhook',
    stripe_event_id: event.id,
    stripe_object_id: stripeObj.id,
    stripe_object_type: stripeObj.object,
    amount_cents: stripeObj.amount ?? undefined,
    currency: stripeObj.currency,
    idempotency_key: event.id,
    occurred_at: new Date(event.created * 1000).toISOString(),
    payload_hash: await sha256Hex(raw),
  });

  // Side-effects we care about.
  if (!duplicate) {
    await dispatchStripeSideEffects(c.env, event);
  }
  return c.json({ ok: true, deduped: duplicate });
});

async function dispatchStripeSideEffects(env: HonoEnv['Bindings'], event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'account.updated': {
      const acct = event.data.object as Stripe.Account;
      const tenantId = (acct.metadata as { tenantId?: string } | null)?.tenantId;
      if (!tenantId) return;
      await env.DB.prepare(
        `INSERT INTO connected_accounts (id, tenant_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, default_currency, country)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(tenant_id) DO UPDATE SET
           charges_enabled = excluded.charges_enabled,
           payouts_enabled = excluded.payouts_enabled,
           details_submitted = excluded.details_submitted,
           default_currency = excluded.default_currency,
           country = excluded.country,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
        .bind(
          crypto.randomUUID(),
          tenantId,
          acct.id,
          acct.charges_enabled ? 1 : 0,
          acct.payouts_enabled ? 1 : 0,
          acct.details_submitted ? 1 : 0,
          acct.default_currency ?? null,
          acct.country ?? null,
        )
        .run();
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const tenantId = (sub.metadata as { tenantId?: string } | null)?.tenantId;
      if (!tenantId) return;
      const tier = (sub.metadata as { tier?: string } | null)?.tier ?? 'starter';
      await env.DB.prepare(
        `INSERT INTO subscriptions (id, tenant_id, stripe_subscription_id, stripe_customer_id, tier, status, current_period_end, cancel_at_period_end)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(stripe_subscription_id) DO UPDATE SET
           tier = excluded.tier,
           status = excluded.status,
           current_period_end = excluded.current_period_end,
           cancel_at_period_end = excluded.cancel_at_period_end,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
        .bind(
          crypto.randomUUID(),
          tenantId,
          sub.id,
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
          tier,
          sub.status,
          (sub as unknown as { current_period_end?: number }).current_period_end ?? null,
          sub.cancel_at_period_end ? 1 : 0,
        )
        .run();
      return;
    }
    default:
      return;
  }
}

// ── Twilio ──────────────────────────────────────────────────────────────────
app.post('/twilio/voice', async (c) => {
  const signature = c.req.header('x-twilio-signature');
  if (!signature || !c.env.TWILIO_AUTH_TOKEN) {
    throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID, 'missing twilio signature');
  }
  const url = new URL(c.req.url).toString();
  const form = await c.req.parseBody();
  const sortedKeys = Object.keys(form).sort();
  const concat = url + sortedKeys.map((k) => k + String(form[k] ?? '')).join('');
  const expected = await hmacSha1Base64(c.env.TWILIO_AUTH_TOKEN, concat);
  if (expected !== signature) {
    throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID, 'twilio signature mismatch');
  }
  const callSid = String(form['CallSid'] ?? '');
  const status = String(form['CallStatus'] ?? '');
  if (callSid) {
    const id = c.env.VOICE_ORCHESTRATOR.idFromName(callSid);
    const stub = c.env.VOICE_ORCHESTRATOR.get(id);
    await stub.fetch('https://do/event', {
      method: 'POST',
      body: JSON.stringify({ call_sid: callSid, status, meta: { form } }),
    });
  }
  return c.text('<Response/>', 200, { 'content-type': 'text/xml' });
});

async function hmacSha1Base64(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  let s = '';
  for (let i = 0; i < sig.length; i++) s += String.fromCharCode(sig[i]!);
  return btoa(s);
}

// Hint for unused imports
void dbExecute;
void dbQueryOne;

export default app;
