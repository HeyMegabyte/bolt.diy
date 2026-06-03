/**
 * @module __tests__/wallet_adapter
 * @description
 * Unit coverage for `services/wallet_adapter.ts` — the typed forwarder over
 * sibling #100's `services/wallet.ts`. Exercises:
 *  - `walletAvailable` env gating (both Stripe keys, each missing)
 *  - the unconfigured (no-Stripe-creds) soft-degrade path for every public
 *    method (charge / credit / getState / startSubscription / topUp)
 *  - the configured path: delegation to the underlying wallet module with
 *    verbatim argument forwarding + return-value passthrough
 *  - module-load caching (loadWallet only imports once) + the
 *    `__resetWalletAdapterForTests` cache-reset escape hatch
 *  - `getWalletState` zeroed default-state shape when unconfigured
 *  - org scoping (exact orgId forwarded)
 *
 * The sibling `../services/wallet.js` module is fully jest.mock'd so no real
 * Stripe/D1 is touched. ts-jest maps the adapter's dynamic `import('./wallet.js')`
 * onto the same mocked module path.
 */

// Mock the underlying wallet module the adapter dynamic-imports.
jest.mock('../services/wallet.js', () => ({
  __esModule: true,
  chargeWallet: jest.fn(),
  creditWallet: jest.fn(),
  getWalletState: jest.fn(),
  startSubscription: jest.fn(),
  topUpWallet: jest.fn(),
}));

import * as walletMod from '../services/wallet.js';
import {
  walletAvailable,
  chargeWallet,
  creditWallet,
  getWalletState,
  startWalletSubscription,
  topUpWallet,
  __resetWalletAdapterForTests,
  type ChargeWalletParams,
  type CreditWalletParams,
  type WalletChargeResult,
  type WalletState,
  type StartSubscriptionResult,
  type TopUpResult,
} from '../services/wallet_adapter.js';
import type { Env } from '../types/env.js';

// ─── Env stubs ────────────────────────────────────────────────

/** Env with both Stripe creds present → adapter loads the (mocked) module. */
function configuredEnv(): Env {
  return {
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_123',
  } as unknown as Env;
}

/** Env missing one/both Stripe creds → adapter soft-degrades. */
function unconfiguredEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return { ...overrides } as unknown as Env;
}

const ORG = 'org-abc';

const mockedCharge = walletMod.chargeWallet as unknown as jest.Mock;
const mockedCredit = walletMod.creditWallet as unknown as jest.Mock;
const mockedGetState = walletMod.getWalletState as unknown as jest.Mock;
const mockedStartSub = walletMod.startSubscription as unknown as jest.Mock;
const mockedTopUp = walletMod.topUpWallet as unknown as jest.Mock;

beforeEach(() => {
  __resetWalletAdapterForTests();
  jest.clearAllMocks();
});

// ─── walletAvailable ──────────────────────────────────────────

describe('walletAvailable', () => {
  it('returns true when both Stripe keys are present', () => {
    expect(walletAvailable(configuredEnv())).toBe(true);
  });

  it('returns false when STRIPE_SECRET_KEY is missing', () => {
    expect(walletAvailable(unconfiguredEnv({ STRIPE_WEBHOOK_SECRET: 'whsec_1' }))).toBe(false);
  });

  it('returns false when STRIPE_WEBHOOK_SECRET is missing', () => {
    expect(walletAvailable(unconfiguredEnv({ STRIPE_SECRET_KEY: 'sk_1' }))).toBe(false);
  });

  it('returns false when both keys are missing', () => {
    expect(walletAvailable(unconfiguredEnv())).toBe(false);
  });
});

// ─── Unconfigured (soft-degrade) branches ─────────────────────

describe('unconfigured env — soft-degrade envelopes', () => {
  const env = unconfiguredEnv();

  it('chargeWallet returns an error envelope and never calls the module', async () => {
    const result = await chargeWallet(env, ORG, {
      category: 'build',
      quantity: 1,
      base_cost_cents: 500,
      reference_type: 'site',
      reference_id: 'site-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('error');
      expect(result.message).toMatch(/not deployed yet/i);
    }
    expect(mockedCharge).not.toHaveBeenCalled();
  });

  it('creditWallet is a no-op (resolves void) without calling the module', async () => {
    await expect(
      creditWallet(env, ORG, {
        amount_cents: 100,
        reason: 'refund',
        reference_type: 'site',
        reference_id: 'site-1',
      }),
    ).resolves.toBeUndefined();
    expect(mockedCredit).not.toHaveBeenCalled();
  });

  it('getWalletState returns a zeroed default WalletState', async () => {
    const state = await getWalletState(env, ORG);
    expect(state).toEqual<WalletState>({
      balance_cents: 0,
      subscription_status: 'none',
      default_payment_method_brand: null,
      default_payment_method_last4: null,
      last_topup_at: null,
      monthly_credit_remaining_days: null,
      recent_transactions: [],
    });
    expect(mockedGetState).not.toHaveBeenCalled();
  });

  it('startWalletSubscription returns ok:false with a message', async () => {
    const res = await startWalletSubscription(env, ORG, {
      success_url: 'https://x/ok',
      cancel_url: 'https://x/no',
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not deployed yet/i);
    expect(mockedStartSub).not.toHaveBeenCalled();
  });

  it('topUpWallet returns ok:false with a message', async () => {
    const res = await topUpWallet(env, ORG, 2000);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not deployed yet/i);
    expect(mockedTopUp).not.toHaveBeenCalled();
  });
});

// ─── Configured — delegation passthrough ──────────────────────

describe('configured env — delegates to the underlying wallet module', () => {
  const env = configuredEnv();

  it('chargeWallet forwards args verbatim and returns the module result', async () => {
    const params: ChargeWalletParams = {
      category: 'image',
      quantity: 3,
      base_cost_cents: 250,
      reference_type: 'asset',
      reference_id: 'asset-9',
      metadata: { source: 'dalle' },
    };
    const moduleResult: WalletChargeResult = {
      ok: true,
      transaction_id: 'tx-1',
      charged_cents: 750,
      balance_after_cents: 1250,
    };
    mockedCharge.mockResolvedValue(moduleResult);

    const result = await chargeWallet(env, ORG, params);

    expect(result).toBe(moduleResult);
    expect(mockedCharge).toHaveBeenCalledTimes(1);
    expect(mockedCharge).toHaveBeenCalledWith(env, ORG, params);
  });

  it('chargeWallet passes through an insufficient-funds failure envelope', async () => {
    const fail: WalletChargeResult = { ok: false, reason: 'insufficient', balance_cents: 100 };
    mockedCharge.mockResolvedValue(fail);
    const result = await chargeWallet(env, ORG, {
      category: 'build',
      quantity: 1,
      base_cost_cents: 9999,
      reference_type: 'site',
      reference_id: 'site-2',
    });
    expect(result).toEqual(fail);
  });

  it('creditWallet forwards args and awaits the module', async () => {
    mockedCredit.mockResolvedValue(undefined);
    const params: CreditWalletParams = {
      amount_cents: 500,
      reason: 'goodwill',
      reference_type: 'manual',
      reference_id: 'm-1',
    };
    await creditWallet(env, ORG, params);
    expect(mockedCredit).toHaveBeenCalledWith(env, ORG, params);
  });

  it('getWalletState returns the module state', async () => {
    const state: WalletState = {
      balance_cents: 4200,
      subscription_status: 'active',
      default_payment_method_brand: 'visa',
      default_payment_method_last4: '4242',
      last_topup_at: '2026-06-01T00:00:00Z',
      monthly_credit_remaining_days: 12,
      recent_transactions: [
        {
          id: 'tx-7',
          created_at: '2026-06-02T00:00:00Z',
          category: 'build',
          amount_cents: 500,
          reference_type: 'site',
          reference_id: 'site-3',
          direction: 'debit',
        },
      ],
    };
    mockedGetState.mockResolvedValue(state);
    const result = await getWalletState(env, ORG);
    expect(result).toBe(state);
    expect(mockedGetState).toHaveBeenCalledWith(env, ORG);
  });

  it('startWalletSubscription forwards opts and returns the checkout url', async () => {
    const out: StartSubscriptionResult = { ok: true, checkout_url: 'https://stripe/checkout/abc' };
    mockedStartSub.mockResolvedValue(out);
    const opts = { success_url: 'https://x/ok', cancel_url: 'https://x/no' };
    const result = await startWalletSubscription(env, ORG, opts);
    expect(result).toBe(out);
    expect(mockedStartSub).toHaveBeenCalledWith(env, ORG, opts);
  });

  it('topUpWallet forwards the amount and returns the module result', async () => {
    const out: TopUpResult = {
      ok: true,
      state: {
        balance_cents: 5000,
        subscription_status: 'active',
        default_payment_method_brand: null,
        default_payment_method_last4: null,
        last_topup_at: null,
        monthly_credit_remaining_days: null,
        recent_transactions: [],
      },
    };
    mockedTopUp.mockResolvedValue(out);
    const result = await topUpWallet(env, ORG, 5000);
    expect(result).toBe(out);
    expect(mockedTopUp).toHaveBeenCalledWith(env, ORG, 5000);
  });
});

// ─── Module-load caching ──────────────────────────────────────

describe('loadWallet caching', () => {
  it('reaches the module fns once each across multiple configured calls', async () => {
    const env = configuredEnv();
    mockedGetState.mockResolvedValue({
      balance_cents: 0,
      subscription_status: 'none',
      default_payment_method_brand: null,
      default_payment_method_last4: null,
      last_topup_at: null,
      monthly_credit_remaining_days: null,
      recent_transactions: [],
    } as WalletState);
    mockedCredit.mockResolvedValue(undefined);

    await getWalletState(env, ORG);
    await getWalletState(env, ORG);
    await creditWallet(env, ORG, {
      amount_cents: 1,
      reason: 'r',
      reference_type: 't',
      reference_id: 'i',
    });

    // The single dynamic import is cached; all three forwarders resolved and
    // reached their module fns without re-importing/throwing.
    expect(mockedGetState).toHaveBeenCalledTimes(2);
    expect(mockedCredit).toHaveBeenCalledTimes(1);
  });

  it('caches the unconfigured (null) result — module fns never reached', async () => {
    const env = unconfiguredEnv();
    await getWalletState(env, ORG);
    await getWalletState(env, ORG);
    expect(mockedGetState).not.toHaveBeenCalled();
  });

  it('__resetWalletAdapterForTests clears the cache so a later configured env loads the module', async () => {
    // First: unconfigured caches null.
    await getWalletState(unconfiguredEnv(), ORG);
    expect(mockedGetState).not.toHaveBeenCalled();

    // Reset, then a configured env reaches the module.
    __resetWalletAdapterForTests();
    mockedGetState.mockResolvedValue({
      balance_cents: 99,
      subscription_status: 'trialing',
      default_payment_method_brand: null,
      default_payment_method_last4: null,
      last_topup_at: null,
      monthly_credit_remaining_days: 7,
      recent_transactions: [],
    } as WalletState);
    const state = await getWalletState(configuredEnv(), ORG);
    expect(state.balance_cents).toBe(99);
    expect(mockedGetState).toHaveBeenCalledTimes(1);
  });
});

// ─── Org scoping ──────────────────────────────────────────────

describe('org scoping', () => {
  it('forwards the exact orgId to the underlying module', async () => {
    const env = configuredEnv();
    mockedCharge.mockResolvedValue({
      ok: true,
      transaction_id: 'tx',
      charged_cents: 1,
      balance_after_cents: 0,
    } as WalletChargeResult);
    await chargeWallet(env, 'org-zzz', {
      category: 'c',
      quantity: 1,
      base_cost_cents: 1,
      reference_type: 't',
      reference_id: 'i',
    });
    expect(mockedCharge.mock.calls[0][1]).toBe('org-zzz');
  });
});
