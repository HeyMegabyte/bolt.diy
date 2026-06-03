/**
 * Additive route coverage for `routes/domain_purchase.ts` (convergence r36).
 *
 * The sibling `wallet_purchase.test.ts` already exercises the happy/409/424/
 * 402/500-refund/404 branches of `POST /api/domains/purchase`. THIS spec is
 * deliberately ADDITIVE — it covers the branches + routes that file does not:
 *
 *   POST /api/domains/purchase
 *     - 401 unauthenticated (no orgId)
 *     - 400 Zod (missing site_id, malformed domain, too short)
 *     - 503 wallet_not_configured (walletAvailable === false)
 *     - 500 wallet_error (chargeWallet throws)
 *     - 500 wallet_error (charge ok:false, reason:'error')
 *     - 200 ssl_status:'failed' (provisionCustomDomain throws — site still binds)
 *
 *   POST /api/billing/checkout/wallet   — 401, Zod 400, 503-as-400, success, failure
 *   POST /api/billing/checkout/topup    — 401, Zod 400, 503-as-400, success, failure
 *   GET  /api/billing/wallet            — 401, soft-degrade (wallet off), live state
 *
 * Boundaries mocked: D1 (`db`), audit, RDAP, CF Registrar, domains service,
 * wallet adapter. Never hits a real API. ts-jest global `jest`.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/rdap_availability.js', () => ({
  checkAvailability: jest.fn(),
}));

jest.mock('../services/cf_registrar.js', () => ({
  buildTldPriceMap: jest.fn(),
  porkbunFallback: jest.fn((d: string) => `https://porkbun.com/checkout/search?q=${d}`),
  registerDomain: jest.fn(),
  listSupportedTlds: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/domains.js', () => ({
  provisionCustomDomain: jest.fn().mockResolvedValue({
    hostname: 'vito.com',
    status: 'pending',
    is_primary: true,
  }),
}));

jest.mock('../services/wallet_adapter.js', () => ({
  walletAvailable: jest.fn(() => true),
  chargeWallet: jest.fn(),
  creditWallet: jest.fn().mockResolvedValue(undefined),
  getWalletState: jest.fn(),
  startWalletSubscription: jest.fn(),
  topUpWallet: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { domainPurchase } from '../routes/domain_purchase.js';
import { dbQueryOne } from '../services/db.js';
import { checkAvailability } from '../services/rdap_availability.js';
import { buildTldPriceMap, registerDomain } from '../services/cf_registrar.js';
import { provisionCustomDomain } from '../services/domains.js';
import {
  chargeWallet,
  getWalletState,
  startWalletSubscription,
  topUpWallet,
  walletAvailable,
} from '../services/wallet_adapter.js';

const mockDbQueryOne = dbQueryOne as unknown as jest.Mock;
const mockCheckAvail = checkAvailability as unknown as jest.Mock;
const mockBuildTldMap = buildTldPriceMap as unknown as jest.Mock;
const mockRegister = registerDomain as unknown as jest.Mock;
const mockProvision = provisionCustomDomain as unknown as jest.Mock;
const mockCharge = chargeWallet as unknown as jest.Mock;
const mockGetState = getWalletState as unknown as jest.Mock;
const mockStartSub = startWalletSubscription as unknown as jest.Mock;
const mockTopUp = topUpWallet as unknown as jest.Mock;
const mockWalletAvailable = walletAvailable as unknown as jest.Mock;

// ─── Harness ───────────────────────────────────────────────────────────────

/**
 * Build the app with a middleware that seeds auth context vars. Passing no
 * vars (the default) simulates an unauthenticated request — the handler reads
 * `c.get('orgId')` and throws `unauthorized` when absent.
 */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', domainPurchase);
  return app;
}

function makeEnv(): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    CACHE_KV: {} as KVNamespace,
    STRIPE_SECRET_KEY: 'sk_test_123',
    CLOUDFLARE_API_KEY: 'cf_key',
    CLOUDFLARE_EMAIL: 'ops@projectsites.dev',
  } as unknown as Env;
}

function jsonReq(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  method: 'POST' | 'GET',
  path: string,
  body: unknown,
  env: Env,
) {
  return app.request(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}

function tldMapFor(tld: string, priceUsd: number | null, canRegister = true) {
  const m = new Map();
  m.set(tld, {
    tld,
    supported: true,
    registration_price_usd_yr: priceUsd,
    renewal_price_usd_yr: priceUsd,
    can_register: canRegister,
    can_transfer: true,
  });
  return m;
}

const AUTH: Partial<Variables> = {
  userId: 'user_test',
  orgId: 'org_test',
  requestId: 'req_test',
};

/** Default D1 lookup behavior: site owned by org + user + hostname present. */
function seedDbOwned() {
  mockDbQueryOne.mockImplementation((_db: unknown, sql: string) => {
    if (sql.includes('FROM sites')) {
      return Promise.resolve({ id: 'site_test', org_id: 'org_test' });
    }
    if (sql.includes('FROM users')) {
      return Promise.resolve({ email: 'owner@example.com', name: 'Test Owner', phone: '+15555550000' });
    }
    if (sql.includes('FROM hostnames')) {
      return Promise.resolve({ id: 'host_abc' });
    }
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockWalletAvailable.mockReturnValue(true);
  seedDbOwned();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── POST /api/domains/purchase — uncovered branches ─────────────────────────

describe('POST /api/domains/purchase — auth + validation + wallet edge branches', () => {
  it('returns 401 when unauthenticated (no orgId)', async () => {
    const env = makeEnv();
    const res = await jsonReq(makeApp(), 'POST', '/api/domains/purchase', {
      site_id: 'site_test',
      domain: 'vito.com',
    }, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('UNAUTHORIZED');
    // Short-circuits before touching any boundary.
    expect(mockDbQueryOne).not.toHaveBeenCalled();
    expect(mockCheckAvail).not.toHaveBeenCalled();
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it('returns 400 when site_id is missing (Zod)', async () => {
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/domains/purchase', {
      domain: 'vito.com',
    }, env);
    expect(res.status).toBe(400);
    expect(mockCheckAvail).not.toHaveBeenCalled();
  });

  it('returns 400 when the domain is malformed (Zod regex)', async () => {
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/domains/purchase', {
      site_id: 'site_test',
      domain: 'not a domain',
    }, env);
    expect(res.status).toBe(400);
    expect(mockCheckAvail).not.toHaveBeenCalled();
  });

  it('returns 400 when the domain is too short (Zod min length)', async () => {
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/domains/purchase', {
      site_id: 'site_test',
      domain: 'ab',
    }, env);
    expect(res.status).toBe(400);
  });

  it('returns 503 wallet_not_configured when the wallet binding is absent', async () => {
    mockWalletAvailable.mockReturnValue(false);
    mockCheckAvail.mockResolvedValue({ domain: 'vito.com', available: true, status: 'available', source: 'rdap' });
    mockBuildTldMap.mockResolvedValue(tldMapFor('com', 9.5));

    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/domains/purchase', {
      site_id: 'site_test',
      domain: 'vito.com',
    }, env);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: { code?: string; topup_url?: string } };
    expect(body.error?.code).toBe('wallet_not_configured');
    expect(body.error?.topup_url).toBe('/admin/billing');
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it('returns 500 wallet_error when chargeWallet throws unexpectedly', async () => {
    mockCheckAvail.mockResolvedValue({ domain: 'vito.com', available: true, status: 'available', source: 'rdap' });
    mockBuildTldMap.mockResolvedValue(tldMapFor('com', 9.5));
    mockCharge.mockRejectedValue(new Error('D1 deadlock'));

    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/domains/purchase', {
      site_id: 'site_test',
      domain: 'vito.com',
    }, env);

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('wallet_error');
    // Never reaches the registrar when the charge throws.
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('returns 500 wallet_error when charge resolves ok:false reason:error', async () => {
    mockCheckAvail.mockResolvedValue({ domain: 'vito.com', available: true, status: 'available', source: 'rdap' });
    mockBuildTldMap.mockResolvedValue(tldMapFor('com', 9.5));
    mockCharge.mockResolvedValue({ ok: false, reason: 'error', message: 'stripe declined' });

    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/domains/purchase', {
      site_id: 'site_test',
      domain: 'vito.com',
    }, env);

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('wallet_error');
    expect(body.error?.message).toBe('stripe declined');
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('returns 200 with ssl_status="failed" when registrar succeeds but provisioning throws', async () => {
    mockCheckAvail.mockResolvedValue({ domain: 'vito.com', available: true, status: 'available', source: 'rdap' });
    mockBuildTldMap.mockResolvedValue(tldMapFor('com', 9.5));
    mockCharge.mockResolvedValue({
      ok: true,
      transaction_id: 'tx_999',
      charged_cents: 950,
      balance_after_cents: 4050,
    });
    mockRegister.mockResolvedValue({ ok: true, domain: 'vito.com', transaction_id: 'cf_999' });
    mockProvision.mockRejectedValue(new Error('CF for SaaS rejected hostname'));

    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/domains/purchase', {
      site_id: 'site_test',
      domain: 'vito.com',
    }, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data['ssl_status']).toBe('failed');
    // hostname_id is null because the lookup never ran after provisioning threw.
    expect(body.data['hostname_id']).toBeNull();
    expect(body.data['transaction_id']).toBe('tx_999');
  });
});

// ─── POST /api/billing/checkout/wallet ───────────────────────────────────────

describe('POST /api/billing/checkout/wallet', () => {
  const VALID = {
    success_url: 'https://app.projectsites.dev/ok',
    cancel_url: 'https://app.projectsites.dev/cancel',
  };

  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await jsonReq(makeApp(), 'POST', '/api/billing/checkout/wallet', VALID, env);
    expect(res.status).toBe(401);
    expect(mockStartSub).not.toHaveBeenCalled();
  });

  it('returns 400 when success_url is not a URL (Zod)', async () => {
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/billing/checkout/wallet', {
      success_url: 'not-a-url',
      cancel_url: 'https://app.projectsites.dev/cancel',
    }, env);
    expect(res.status).toBe(400);
    expect(mockStartSub).not.toHaveBeenCalled();
  });

  it('returns 400 when the wallet binding is not configured', async () => {
    mockWalletAvailable.mockReturnValue(false);
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/billing/checkout/wallet', VALID, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(mockStartSub).not.toHaveBeenCalled();
  });

  it('returns the checkout_url on success', async () => {
    mockStartSub.mockResolvedValue({ ok: true, checkout_url: 'https://checkout.stripe.com/c/abc' });
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/billing/checkout/wallet', VALID, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { checkout_url: string } };
    expect(body.data.checkout_url).toBe('https://checkout.stripe.com/c/abc');
    expect(mockStartSub).toHaveBeenCalledWith(env, 'org_test', {
      success_url: VALID.success_url,
      cancel_url: VALID.cancel_url,
    });
  });

  it('returns 400 when startWalletSubscription reports failure', async () => {
    mockStartSub.mockResolvedValue({ ok: false, message: 'Stripe not configured' });
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/billing/checkout/wallet', VALID, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe('Stripe not configured');
  });
});

// ─── POST /api/billing/checkout/topup ────────────────────────────────────────

describe('POST /api/billing/checkout/topup', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await jsonReq(makeApp(), 'POST', '/api/billing/checkout/topup', { amount_cents: 2000 }, env);
    expect(res.status).toBe(401);
    expect(mockTopUp).not.toHaveBeenCalled();
  });

  it('returns 400 when amount_cents is below the 500 floor (Zod)', async () => {
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/billing/checkout/topup', { amount_cents: 100 }, env);
    expect(res.status).toBe(400);
    expect(mockTopUp).not.toHaveBeenCalled();
  });

  it('returns 400 when amount_cents exceeds the 50000 ceiling (Zod)', async () => {
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/billing/checkout/topup', { amount_cents: 99999 }, env);
    expect(res.status).toBe(400);
    expect(mockTopUp).not.toHaveBeenCalled();
  });

  it('returns 400 when the wallet binding is not configured', async () => {
    mockWalletAvailable.mockReturnValue(false);
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/billing/checkout/topup', { amount_cents: 2000 }, env);
    expect(res.status).toBe(400);
    expect(mockTopUp).not.toHaveBeenCalled();
  });

  it('charges the wallet and echoes the amount + state on success', async () => {
    mockTopUp.mockResolvedValue({ ok: true, state: { balance_cents: 5000 } });
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/billing/checkout/topup', { amount_cents: 2000 }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { ok: boolean; charged_cents: number; state: unknown } };
    expect(body.data.ok).toBe(true);
    expect(body.data.charged_cents).toBe(2000);
    expect(body.data.state).toEqual({ balance_cents: 5000 });
    expect(mockTopUp).toHaveBeenCalledWith(env, 'org_test', 2000);
  });

  it('returns 400 when topUpWallet reports failure', async () => {
    mockTopUp.mockResolvedValue({ ok: false, message: 'No payment method on file' });
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'POST', '/api/billing/checkout/topup', { amount_cents: 2000 }, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe('No payment method on file');
  });
});

// ─── GET /api/billing/wallet ─────────────────────────────────────────────────

describe('GET /api/billing/wallet', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await jsonReq(makeApp(), 'GET', '/api/billing/wallet', undefined, env);
    expect(res.status).toBe(401);
    expect(mockGetState).not.toHaveBeenCalled();
  });

  it('soft-degrades to an empty wallet when the binding is not configured', async () => {
    mockWalletAvailable.mockReturnValue(false);
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'GET', '/api/billing/wallet', undefined, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data['has_wallet']).toBe(false);
    expect(body.data['active']).toBe(false);
    expect(body.data['balance_cents']).toBe(0);
    expect(body.data['subscription_status']).toBe('none');
    expect(body.data['recent_transactions']).toEqual([]);
    // Never queries the (absent) wallet service.
    expect(mockGetState).not.toHaveBeenCalled();
  });

  it('returns the live wallet state when the binding is configured', async () => {
    mockGetState.mockResolvedValue({
      balance_cents: 4200,
      subscription_status: 'active',
      default_payment_method_brand: 'visa',
      default_payment_method_last4: '4242',
      last_topup_at: '2026-06-01T00:00:00Z',
      monthly_credit_remaining_days: 12,
      recent_transactions: [],
    });
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'GET', '/api/billing/wallet', undefined, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data['has_wallet']).toBe(true);
    expect(body.data['active']).toBe(true);
    expect(body.data['balance_cents']).toBe(4200);
    expect(body.data['default_card_last4']).toBe('4242');
    expect(mockGetState).toHaveBeenCalledWith(env, 'org_test');
  });

  it('reports has_wallet=true but active=false for a non-active subscription', async () => {
    mockGetState.mockResolvedValue({
      balance_cents: 0,
      subscription_status: 'past_due',
      default_payment_method_brand: null,
      default_payment_method_last4: null,
      last_topup_at: null,
      monthly_credit_remaining_days: null,
      recent_transactions: [],
    });
    const env = makeEnv();
    const res = await jsonReq(makeApp(AUTH), 'GET', '/api/billing/wallet', undefined, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    // subscription_status !== 'none' → has_wallet true; but not 'active' → active false.
    expect(body.data['has_wallet']).toBe(true);
    expect(body.data['active']).toBe(false);
  });
});
