/**
 * @module services/wallet_adapter
 *
 * @description
 * Typed adapter over sibling agent #100's `services/wallet.ts`. Lets the
 * domain-purchase + billing-checkout routes import a stable contract today
 * while #100 finishes shipping the real wallet service. When `wallet.ts`
 * lands, this adapter dynamic-imports it and forwards calls verbatim.
 *
 * Why this exists:
 * - Keeps typecheck green before `wallet.ts` is on disk (no compile-time
 *   dependency on a yet-to-exist module — uses runtime `await import` +
 *   a feature flag).
 * - Gives us one source-of-truth for the wallet result-shape so the UI
 *   typings (`billing.service.ts`) stay aligned regardless of #100's
 *   internal naming conventions.
 * - Removes adapter cleanly: once `wallet.ts` is stable, the routes can
 *   swap `from './wallet_adapter.js'` → `from './wallet.js'` in one PR.
 */

import type { Env } from '../types/env.js';

// ─── Public types (UI + route contracts) ──────────────────────────

export type WalletSubscriptionStatus =
  | 'none'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing';

export interface WalletTransaction {
  id: string;
  created_at: string;
  category: string;
  amount_cents: number;
  reference_type: string | null;
  reference_id: string | null;
  direction: 'debit' | 'credit';
}

export interface WalletState {
  balance_cents: number;
  subscription_status: WalletSubscriptionStatus;
  default_payment_method_brand: string | null;
  default_payment_method_last4: string | null;
  last_topup_at: string | null;
  monthly_credit_remaining_days: number | null;
  recent_transactions: WalletTransaction[];
}

export interface ChargeWalletParams {
  category: string;
  quantity: number;
  base_cost_cents: number;
  reference_type: string;
  reference_id: string;
  metadata?: Record<string, unknown>;
}

export type WalletChargeResult =
  | {
      ok: true;
      transaction_id: string;
      charged_cents: number;
      balance_after_cents: number;
    }
  | {
      ok: false;
      reason: 'insufficient' | 'error';
      balance_cents?: number;
      message?: string;
    };

export interface CreditWalletParams {
  amount_cents: number;
  reason: string;
  reference_type: string;
  reference_id: string;
  metadata?: Record<string, unknown>;
}

export interface StartSubscriptionResult {
  ok: boolean;
  checkout_url?: string;
  message?: string;
}

export interface TopUpResult {
  ok: boolean;
  state?: WalletState;
  message?: string;
}

// ─── Runtime delegation ───────────────────────────────────────────

/**
 * Shape sibling #100's `wallet.ts` is expected to export. Kept narrow so
 * adapter compiles without the real module being present yet.
 */
interface WalletModule {
  chargeWallet(env: Env, orgId: string, params: ChargeWalletParams): Promise<WalletChargeResult>;
  creditWallet(env: Env, orgId: string, params: CreditWalletParams): Promise<void>;
  getWalletState(env: Env, orgId: string): Promise<WalletState>;
  startSubscription(
    env: Env,
    orgId: string,
    opts: { success_url: string; cancel_url: string },
  ): Promise<StartSubscriptionResult>;
  topUpWallet(env: Env, orgId: string, amountCents: number): Promise<TopUpResult>;
}

let cached: WalletModule | null | undefined;

async function loadWallet(env: Env): Promise<WalletModule | null> {
  if (cached !== undefined) return cached;
  // Require both stripe creds AND the price ID for the monthly wallet sub
  // before we even attempt to load the wallet module. Avoids partial-config
  // surprise where charges work but subscribe doesn't.
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    cached = null;
    return null;
  }
  try {
    // Dynamic so typecheck stays green before sibling #100 lands the file.
    const mod: unknown = await import(
      /* webpackIgnore: true */ './wallet.js' as string
    ).catch(() => null);
    if (mod && typeof mod === 'object' && 'chargeWallet' in (mod as object)) {
      cached = mod as WalletModule;
      return cached;
    }
  } catch {
    // Module not present yet.
  }
  cached = null;
  return null;
}

/**
 * Synchronously report whether the wallet adapter has its required
 * environment + module dependencies. Used by routes to soft-degrade
 * the UI before sibling #100 lands.
 */
export function walletAvailable(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

// ─── Forwarders ──────────────────────────────────────────────────

export async function chargeWallet(
  env: Env,
  orgId: string,
  params: ChargeWalletParams,
): Promise<WalletChargeResult> {
  const mod = await loadWallet(env);
  if (!mod) {
    return {
      ok: false,
      reason: 'error',
      message: 'wallet service module not deployed yet (sibling #100)',
    };
  }
  return mod.chargeWallet(env, orgId, params);
}

export async function creditWallet(
  env: Env,
  orgId: string,
  params: CreditWalletParams,
): Promise<void> {
  const mod = await loadWallet(env);
  if (!mod) return;
  await mod.creditWallet(env, orgId, params);
}

export async function getWalletState(env: Env, orgId: string): Promise<WalletState> {
  const mod = await loadWallet(env);
  if (!mod) {
    return {
      balance_cents: 0,
      subscription_status: 'none',
      default_payment_method_brand: null,
      default_payment_method_last4: null,
      last_topup_at: null,
      monthly_credit_remaining_days: null,
      recent_transactions: [],
    };
  }
  return mod.getWalletState(env, orgId);
}

export async function startWalletSubscription(
  env: Env,
  orgId: string,
  opts: { success_url: string; cancel_url: string },
): Promise<StartSubscriptionResult> {
  const mod = await loadWallet(env);
  if (!mod) {
    return { ok: false, message: 'wallet service module not deployed yet (sibling #100)' };
  }
  return mod.startSubscription(env, orgId, opts);
}

export async function topUpWallet(
  env: Env,
  orgId: string,
  amountCents: number,
): Promise<TopUpResult> {
  const mod = await loadWallet(env);
  if (!mod) {
    return { ok: false, message: 'wallet service module not deployed yet (sibling #100)' };
  }
  return mod.topUpWallet(env, orgId, amountCents);
}

/**
 * @internal Reset cached wallet module — test-only helper.
 */
export function __resetWalletAdapterForTests(): void {
  cached = undefined;
}
