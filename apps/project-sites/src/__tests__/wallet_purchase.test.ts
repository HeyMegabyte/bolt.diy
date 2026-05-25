/**
 * Integration tests for the wallet-charged domain purchase route.
 *
 * Mocks RDAP availability, CF Registrar (price + register), wallet
 * adapter (charge + credit), and `domainService.provisionCustomDomain`
 * so each test exercises one branch of the response matrix in isolation.
 *
 * Covers: 200 happy path, 409 taken, 424 unsupported TLD, 402 insufficient
 * wallet, 500 + refund on registrar failure.
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

jest.mock('../services/wallet_adapter.js', () => {
  return {
    walletAvailable: jest.fn(() => true),
    chargeWallet: jest.fn(),
    creditWallet: jest.fn().mockResolvedValue(undefined),
    getWalletState: jest.fn(),
    startWalletSubscription: jest.fn(),
    topUpWallet: jest.fn(),
  };
});

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
  creditWallet,
  walletAvailable,
} from '../services/wallet_adapter.js';

const mockDbQueryOne = dbQueryOne as jest.Mock;
const mockCheckAvail = checkAvailability as jest.Mock;
const mockBuildTldMap = buildTldPriceMap as jest.Mock;
const mockRegister = registerDomain as jest.Mock;
const mockCharge = chargeWallet as jest.Mock;
const mockCredit = creditWallet as jest.Mock;
const mockProvision = provisionCustomDomain as jest.Mock;
const mockWalletAvailable = walletAvailable as jest.Mock;

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('userId', 'user_test');
    c.set('orgId', 'org_test');
    c.set('requestId', 'req_test');
    await next();
  });
  app.route('/', domainPurchase);
  const env = {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    CACHE_KV: {} as KVNamespace,
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    CLOUDFLARE_API_KEY: 'cf_key',
    CLOUDFLARE_EMAIL: 'ops@projectsites.dev',
  } as unknown as Env;
  return { app, env };
}

function tldMapFor(tld: string, priceUsd: number | null, canRegister = true) {
  const m = new Map();
  m.set(tld, {
    tld,
    supported: true,
    registration_price_usd_yr: priceUsd,
    renewal_price_usd_yr: priceUsd,
    transfer_price_usd_yr: priceUsd,
    can_register: canRegister,
    can_transfer: true,
  });
  return m;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockWalletAvailable.mockReturnValue(true);
  // Default: site exists + owned by org.
  mockDbQueryOne.mockImplementation((_db: unknown, sql: string) => {
    if (sql.includes('FROM sites')) {
      return Promise.resolve({ id: 'site_test', org_id: 'org_test' });
    }
    if (sql.includes('FROM users')) {
      return Promise.resolve({
        email: 'owner@example.com',
        name: 'Test Owner',
        phone: '+15555550000',
      });
    }
    if (sql.includes('FROM hostnames')) {
      return Promise.resolve({ id: 'host_abc' });
    }
    return Promise.resolve(null);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /api/domains/purchase — wallet-charged flow', () => {
  it('returns 409 domain_taken when RDAP reports the domain registered', async () => {
    mockCheckAvail.mockResolvedValue({
      domain: 'vito.com',
      available: false,
      status: 'taken',
      source: 'rdap',
    });
    mockBuildTldMap.mockResolvedValue(tldMapFor('com', 9.5));

    const { app, env } = createApp();
    const res = await app.request(
      '/api/domains/purchase',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: 'site_test', domain: 'vito.com' }),
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('domain_taken');
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it('returns 424 tld_not_supported with fallback_url when CF Registrar lacks the TLD', async () => {
    mockCheckAvail.mockResolvedValue({
      domain: 'vito.xyz',
      available: true,
      status: 'available',
      source: 'rdap',
    });
    mockBuildTldMap.mockResolvedValue(new Map()); // empty — TLD missing

    const { app, env } = createApp();
    const res = await app.request(
      '/api/domains/purchase',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: 'site_test', domain: 'vito.xyz' }),
      },
      env,
    );

    expect(res.status).toBe(424);
    const body = await res.json();
    expect(body.error.code).toBe('tld_not_supported');
    expect(body.error.fallback_url).toContain('porkbun.com');
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it('returns 402 wallet_insufficient with topup_url when wallet charge fails', async () => {
    mockCheckAvail.mockResolvedValue({
      domain: 'vito.com',
      available: true,
      status: 'available',
      source: 'rdap',
    });
    mockBuildTldMap.mockResolvedValue(tldMapFor('com', 9.5));
    mockCharge.mockResolvedValue({
      ok: false,
      reason: 'insufficient',
      balance_cents: 200,
    });

    const { app, env } = createApp();
    const res = await app.request(
      '/api/domains/purchase',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: 'site_test', domain: 'vito.com' }),
      },
      env,
    );

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe('wallet_insufficient');
    expect(body.error.topup_url).toContain('/admin/billing');
    expect(body.error.current_balance_cents).toBe(200);
    expect(body.error.required_cents).toBe(950);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('refunds the wallet and returns 500 registrar_error when CF Registrar fails', async () => {
    mockCheckAvail.mockResolvedValue({
      domain: 'vito.com',
      available: true,
      status: 'available',
      source: 'rdap',
    });
    mockBuildTldMap.mockResolvedValue(tldMapFor('com', 9.5));
    mockCharge.mockResolvedValue({
      ok: true,
      transaction_id: 'tx_123',
      charged_cents: 950,
      balance_after_cents: 4050,
    });
    mockRegister.mockResolvedValue({
      ok: false,
      domain: 'vito.com',
      error: 'CF_API_ERROR',
      message: 'Domain already registered (race)',
    });

    const { app, env } = createApp();
    const res = await app.request(
      '/api/domains/purchase',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: 'site_test', domain: 'vito.com' }),
      },
      env,
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('registrar_error');
    expect(body.error.refunded).toBe(true);
    expect(mockCredit).toHaveBeenCalledWith(
      env,
      'org_test',
      expect.objectContaining({
        amount_cents: 950,
        reason: 'registrar_failure_refund',
      }),
    );
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it('200 happy path — charges wallet, registers, binds site, returns full envelope', async () => {
    mockCheckAvail.mockResolvedValue({
      domain: 'vito.com',
      available: true,
      status: 'available',
      source: 'rdap',
    });
    mockBuildTldMap.mockResolvedValue(tldMapFor('com', 9.5));
    mockCharge.mockResolvedValue({
      ok: true,
      transaction_id: 'tx_456',
      charged_cents: 950,
      balance_after_cents: 4050,
    });
    mockRegister.mockResolvedValue({
      ok: true,
      domain: 'vito.com',
      transaction_id: 'cf_tx_789',
    });

    const { app, env } = createApp();
    const res = await app.request(
      '/api/domains/purchase',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: 'site_test',
          domain: 'vito.com',
          suggestion_id: 'sug_777',
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.domain).toBe('vito.com');
    expect(body.data.hostname_id).toBe('host_abc');
    expect(body.data.ssl_status).toBe('pending');
    expect(body.data.charged_cents).toBe(950);
    expect(body.data.balance_after_cents).toBe(4050);
    expect(body.data.transaction_id).toBe('tx_456');
    expect(mockProvision).toHaveBeenCalled();
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('returns 404 when the site_id does not belong to the caller org', async () => {
    mockDbQueryOne.mockImplementation((_db: unknown, sql: string) => {
      if (sql.includes('FROM sites')) return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const { app, env } = createApp();
    const res = await app.request(
      '/api/domains/purchase',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: 'site_other', domain: 'vito.com' }),
      },
      env,
    );

    expect(res.status).toBe(404);
    expect(mockCheckAvail).not.toHaveBeenCalled();
  });
});
