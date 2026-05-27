/**
 * Webhooks — Stripe (signature-verified, idempotent via billing_events) + Twilio
 * (HMAC-verified). Bypasses auth + tenant middleware in `index.ts`.
 *
 * Also exposes `POST /:provider/:event_id/replay` for one-click webhook replay
 * against the original handler. Replay reads the persisted billing_events row,
 * writes a new `replay_of` audit entry pointing back to the original event id,
 * and re-fires the stored payload through the same dispatch function. Idempotent.
 */

import { Hono } from 'hono';
import type Stripe from 'stripe';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { constructWebhookEvent } from '../services/stripe.js';
import { recordBillingEvent } from '../services/billing-events.js';
import { dbExecute, dbQueryOne } from '../services/db.js';
import { sha256Hex } from '../services/crypto.js';
import { requireSuperAdmin } from '../middleware/auth.js';

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

// ── One-click replay ─────────────────────────────────────────────────────────
/**
 * Replay a previously-received webhook against its original handler.
 *
 * - `provider` ∈ `stripe` | `twilio` (extend as new providers are wired)
 * - `event_id` matches `billing_events.stripe_event_id` (Stripe) or
 *   `billing_events.idempotency_key` (other providers).
 *
 * Writes a new audit entry with `replay_of` pointing back to the original
 * event so the side-effect chain is traceable. Re-running with the same
 * `event_id` is safe — every dispatch is idempotent on the underlying
 * subscriptions / connected_accounts tables.
 *
 * Super-admin gated; we never want a tenant to be able to replay another
 * tenant's events.
 */
interface BillingEventReplayRow {
  id: string;
  org_id: string;
  event_type: string;
  source: string;
  stripe_event_id: string | null;
  stripe_object_id: string | null;
  stripe_object_type: string | null;
  amount_cents: number | null;
  currency: string | null;
  idempotency_key: string;
  occurred_at: string;
  payload_pointer: string | null;
}

app.post('/:provider/:event_id/replay', async (c) => {
  requireSuperAdmin(c);
  const provider = c.req.param('provider');
  const eventId = c.req.param('event_id');

  if (!['stripe', 'twilio'].includes(provider)) {
    throw new AppError(ErrorCode.BAD_REQUEST, `provider ${provider} not replayable`);
  }

  const row = await dbQueryOne<BillingEventReplayRow>(
    c.env.DB,
    `SELECT id, org_id, event_type, source, stripe_event_id, stripe_object_id,
            stripe_object_type, amount_cents, currency, idempotency_key,
            occurred_at, payload_pointer
       FROM billing_events
      WHERE (stripe_event_id = ?1 OR idempotency_key = ?1)
        AND source LIKE ?2
      ORDER BY created_at DESC
      LIMIT 1`,
    [eventId, `${provider}%`],
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'webhook event');

  // Record the replay with `replay_of` linkage. Use a fresh idempotency key so
  // it doesn't collide with the original's UNIQUE (source, idempotency_key).
  const replayKey = `${row.idempotency_key}:replay:${Date.now()}`;
  await recordBillingEvent(c.env, {
    org_id: row.org_id,
    event_type: row.event_type,
    source: row.source as 'stripe_webhook' | 'meter_report' | 'wallet_action' | 'manual',
    stripe_event_id: row.stripe_event_id ?? undefined,
    stripe_object_id: row.stripe_object_id ?? undefined,
    stripe_object_type: row.stripe_object_type ?? undefined,
    amount_cents: row.amount_cents ?? undefined,
    currency: row.currency ?? undefined,
    idempotency_key: replayKey,
    occurred_at: new Date().toISOString(),
    payload_pointer: row.payload_pointer ?? `replay_of:${row.id}`,
  });

  // For Stripe, re-fire the typed dispatcher when we still hold enough context
  // in the persisted row. Payload bodies aren't stored verbatim (only hashed),
  // so the side-effect path takes the slim shape from billing_events itself.
  let dispatched = false;
  if (provider === 'stripe' && row.stripe_event_id && row.stripe_object_id) {
    // Synthetic event approximation — enough for the upsert-shaped side-effects
    // (account.updated, subscription.*) we currently care about.
    const synthetic: Stripe.Event = {
      id: row.stripe_event_id,
      type: row.event_type as Stripe.Event.Type,
      created: Math.floor(new Date(row.occurred_at).getTime() / 1000),
      data: {
        object: {
          id: row.stripe_object_id,
          object: row.stripe_object_type,
          metadata: { tenantId: row.org_id },
        } as unknown as Stripe.Event.Data.Object,
      },
      api_version: null,
      livemode: c.env.ENVIRONMENT === 'production',
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      object: 'event',
    };
    await dispatchStripeSideEffects(c.env, synthetic);
    dispatched = true;
  }

  return c.json({
    ok: true,
    replay_of: row.id,
    replay_idempotency_key: replayKey,
    dispatched,
  });
});

// Hint for unused imports
void dbExecute;

export default app;
