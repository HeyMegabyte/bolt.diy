/**
 * @module services/wallet_webhook
 *
 * @description
 * Stripe webhook routing for wallet billing events. Owned by sibling
 * agent #100's `services/wallet.ts` once that lands — this file is a
 * thin dispatcher that forwards the four relevant Stripe events to the
 * wallet service's exposed handler, no-ops cleanly when the wallet
 * module isn't yet on disk, and never re-handles non-wallet events.
 *
 * Routed events:
 * - `checkout.session.completed` (mode=subscription, metadata.kind='wallet')
 * - `payment_intent.succeeded`   (metadata.kind='wallet_topup')
 * - `invoice.paid`               (monthly $50 sub renewal)
 * - `payment_method.attached`    (default PM update on wallet_accounts)
 *
 * Intentionally read-only on every other Stripe event — the existing
 * `routes/webhooks.ts` switch keeps full ownership of plan upgrades,
 * subscription updates, deletes, payment failures, and Connect events.
 */

import type { Env } from '../types/env.js';

interface WalletWebhookModule {
  handleStripeEvent(
    env: Env,
    eventType: string,
    obj: Record<string, unknown>,
  ): Promise<void>;
}

let cached: WalletWebhookModule | null | undefined;

async function load(): Promise<WalletWebhookModule | null> {
  if (cached !== undefined) return cached;
  try {
    const mod: unknown = await import(
      /* webpackIgnore: true */ './wallet.js' as string
    ).catch(() => null);
    if (mod && typeof mod === 'object' && 'handleStripeEvent' in (mod as object)) {
      cached = mod as WalletWebhookModule;
      return cached;
    }
  } catch {
    // wallet.ts not yet on disk — sibling #100 still in flight.
  }
  cached = null;
  return null;
}

/**
 * Forward a Stripe event to the wallet service when relevant. No-ops
 * cleanly when the wallet module isn't loaded yet, so the webhook route
 * stays green during the multi-agent handoff window.
 */
export async function handleWalletStripeEvent(
  env: Env,
  eventType: string,
  obj: Record<string, unknown>,
): Promise<void> {
  const mod = await load();
  if (!mod) {
    console.warn(
      JSON.stringify({
        level: 'info',
        service: 'wallet_webhook',
        message: 'wallet module not yet deployed — webhook deferred',
        event_type: eventType,
      }),
    );
    return;
  }
  await mod.handleStripeEvent(env, eventType, obj);
}

/**
 * @internal Reset cached module — test-only helper.
 */
export function __resetWalletWebhookForTests(): void {
  cached = undefined;
}
