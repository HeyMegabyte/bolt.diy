/**
 * Route coverage for the `billing_addons` sub-app (convergence r36).
 *
 * Exercises each handler end-to-end through the real Hono app + the shared
 * {@link errorHandler}, mocking only the boundaries (`fetch` to Stripe, D1).
 * Covers: auth 401 on every route, Zod 400 on the validated POSTs, the
 * mock-when-no-Stripe-key path, the live-Stripe success path, the Stripe
 * error → 400 path, and the org-scoped D1 lookup for subscription cancel.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { billingAddons } from '../routes/billing_addons.js';

// ─── Boundary helpers ──────────────────────────────────────────────────────

/** Minimal D1 mock; `firstResult` is what `.first()` resolves to. */
function makeDb(firstResult: unknown = null) {
  const first = jest.fn(async () => firstResult);
  const bind = jest.fn(() => ({ first }));
  const prepare = jest.fn(() => ({ bind }));
  return { prepare, bind, first, _prepare: prepare } as unknown as D1Database & {
    prepare: jest.Mock;
    bind: jest.Mock;
    first: jest.Mock;
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: makeDb(),
    ...overrides,
  } as unknown as Env;
}

/** Build the app, seeding the auth context vars the handlers read. */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', billingAddons);
  return app;
}

type App = Hono<{ Bindings: Env; Variables: Variables }>;

function jsonReq(app: App, path: string, body: unknown, env: Env) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}

function getReq(app: App, path: string, env: Env) {
  return app.request(path, { method: 'GET' }, env);
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

/** Build a fetch mock that returns `body` with the given `ok`/`status`. */
function fetchReturning(body: unknown, opts: { ok?: boolean; status?: number } = {}) {
  return jest.fn(async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
});

// ─── POST /api/billing/addons/purchase ───────────────────────────────────────

describe('POST /api/billing/addons/purchase', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await jsonReq(makeApp(), '/api/billing/addons/purchase', { addon: 'extra-sites' }, makeEnv());
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 when the body fails Zod validation (empty addon)', async () => {
    const res = await jsonReq(makeApp(AUTH), '/api/billing/addons/purchase', { addon: '' }, makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns 400 when addon is missing entirely', async () => {
    const res = await jsonReq(makeApp(AUTH), '/api/billing/addons/purchase', {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns a synthetic checkout_url when Stripe is not configured', async () => {
    const res = await jsonReq(
      makeApp(AUTH),
      '/api/billing/addons/purchase',
      { addon: 'extra-sites', billing: 'yearly' },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { checkout_url: string; addon: string; billing: string };
    expect(json.addon).toBe('extra-sites');
    expect(json.billing).toBe('yearly');
    expect(json.checkout_url).toContain('cs_test_addon_extra-sites_yearly');
  });

  it('defaults billing to monthly when omitted (mock path)', async () => {
    const res = await jsonReq(makeApp(AUTH), '/api/billing/addons/purchase', { addon: 'seats' }, makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { billing: string };
    expect(json.billing).toBe('monthly');
  });

  it('creates a live Stripe checkout session when keys are present', async () => {
    global.fetch = fetchReturning({ url: 'https://checkout.stripe.com/c/pay/live_addon', id: 'cs_live_1' });
    const res = await jsonReq(
      makeApp(AUTH),
      '/api/billing/addons/purchase',
      { addon: 'extra-sites' },
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { checkout_url: string; session_id: string };
    expect(json.checkout_url).toBe('https://checkout.stripe.com/c/pay/live_addon');
    expect(json.session_id).toBe('cs_live_1');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/checkout/sessions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns 400 with STRIPE_ERROR when Stripe rejects the session', async () => {
    global.fetch = fetchReturning({ error: { message: 'No such price' } }, { ok: false, status: 402 });
    const res = await jsonReq(
      makeApp(AUTH),
      '/api/billing/addons/purchase',
      { addon: 'bad-addon' },
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(json.error?.code).toBe('STRIPE_ERROR');
    expect(json.error?.message).toBe('No such price');
  });
});

// ─── POST /api/billing/checkout/topup ─────────────────────────────────────────

describe('POST /api/billing/checkout/topup', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await jsonReq(makeApp(), '/api/billing/checkout/topup', { bundle: 'pack-10' }, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns 400 when amount_cents is not a positive integer', async () => {
    const res = await jsonReq(makeApp(AUTH), '/api/billing/checkout/topup', { amount_cents: -5 }, makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns a synthetic checkout_url (mock path) using the bundle name', async () => {
    const res = await jsonReq(makeApp(AUTH), '/api/billing/checkout/topup', { bundle: 'pack-10' }, makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { checkout_url: string };
    expect(json.checkout_url).toContain('cs_test_topup_pack-10');
  });

  it('creates a live one-time checkout session with provided cents', async () => {
    global.fetch = fetchReturning({ url: 'https://checkout.stripe.com/c/pay/topup', id: 'cs_topup_1' });
    const res = await jsonReq(
      makeApp(AUTH),
      '/api/billing/checkout/topup',
      { amount_cents: 1500 },
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { checkout_url: string; session_id: string };
    expect(json.checkout_url).toBe('https://checkout.stripe.com/c/pay/topup');
    expect(json.session_id).toBe('cs_topup_1');
  });

  it('returns 400 with STRIPE_ERROR when topup session creation fails', async () => {
    global.fetch = fetchReturning({ error: { message: 'card_declined' } }, { ok: false, status: 402 });
    const res = await jsonReq(
      makeApp(AUTH),
      '/api/billing/checkout/topup',
      { amount_cents: 1500 },
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('STRIPE_ERROR');
  });
});

// ─── POST /api/billing/usage/report ───────────────────────────────────────────

describe('POST /api/billing/usage/report', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await jsonReq(makeApp(), '/api/billing/usage/report', { value: 3 }, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns a synthetic event_id with defaulted meter (mock path)', async () => {
    const res = await jsonReq(makeApp(AUTH), '/api/billing/usage/report', {}, makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { event_id: string; meter: string; value: number };
    expect(json.event_id).toContain('meter_evt_mock_');
    expect(json.meter).toBe('site_renders');
    expect(json.value).toBe(1);
  });

  it('posts a meter event to Stripe when keys are present', async () => {
    global.fetch = fetchReturning({ id: 'mbe_live_1' });
    const res = await jsonReq(
      makeApp(AUTH),
      '/api/billing/usage/report',
      { meter: 'site_renders', value: 5 },
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { event_id: string; value: number };
    expect(json.event_id).toBe('mbe_live_1');
    expect(json.value).toBe(5);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/billing/meter_events',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns 400 with STRIPE_ERROR when the meter event is rejected', async () => {
    global.fetch = fetchReturning({ error: { message: 'meter not found' } }, { ok: false, status: 400 });
    const res = await jsonReq(
      makeApp(AUTH),
      '/api/billing/usage/report',
      { meter: 'ghost', value: 2 },
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('STRIPE_ERROR');
  });
});

// ─── GET /api/billing/invoices/upcoming ───────────────────────────────────────

describe('GET /api/billing/invoices/upcoming', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await getReq(makeApp(), '/api/billing/invoices/upcoming', makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns a mock invoice preview when Stripe is not configured', async () => {
    const res = await getReq(makeApp(AUTH), '/api/billing/invoices/upcoming', makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { lines: unknown[]; total_cents: number; currency: string };
    expect(json.total_cents).toBe(5000);
    expect(json.currency).toBe('usd');
    expect(Array.isArray(json.lines)).toBe(true);
  });

  it('maps Stripe invoice lines into the response shape', async () => {
    global.fetch = fetchReturning({
      lines: { data: [{ description: 'Pro plan', quantity: 1, amount: 5000 }, { description: null, quantity: null, amount: 250 }] },
      amount_due: 5250,
      currency: 'usd',
    });
    const res = await getReq(makeApp(AUTH), '/api/billing/invoices/upcoming', makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      lines: Array<{ description: string; amount_cents: number }>;
      total_cents: number;
    };
    expect(json.total_cents).toBe(5250);
    expect(json.lines).toHaveLength(2);
    expect(json.lines[0]).toMatchObject({ description: 'Pro plan', amount_cents: 5000 });
    expect(json.lines[1].description).toBe(''); // null coerced to empty string
  });

  it('falls back to a default preview when Stripe returns an error', async () => {
    global.fetch = fetchReturning({}, { ok: false, status: 404 });
    const res = await getReq(makeApp(AUTH), '/api/billing/invoices/upcoming', makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { total_cents: number };
    expect(json.total_cents).toBe(5000);
  });
});

// ─── POST /api/billing/subscription/cancel ────────────────────────────────────

describe('POST /api/billing/subscription/cancel', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await jsonReq(makeApp(), '/api/billing/subscription/cancel', undefined, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns a 30-day mock cancellation when Stripe is not configured', async () => {
    const res = await jsonReq(makeApp(AUTH), '/api/billing/subscription/cancel', undefined, makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; cancel_at: string };
    expect(json.status).toBe('canceled');
    expect(typeof json.cancel_at).toBe('string');
  });

  it('looks up the org-scoped subscription and cancels it at period end', async () => {
    global.fetch = fetchReturning({ status: 'active', cancel_at: 1893456000 });
    const db = makeDb({ stripe_subscription_id: 'sub_live_1' });
    const res = await jsonReq(
      makeApp(AUTH),
      '/api/billing/subscription/cancel',
      undefined,
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x', DB: db }),
    );
    expect(res.status).toBe(200);
    // org-scoped query bound to the caller's org id
    expect(db.bind).toHaveBeenCalledWith('org-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/subscriptions/sub_live_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    const json = (await res.json()) as { status: string; cancel_at: string | null };
    expect(json.status).toBe('active');
    expect(json.cancel_at).toBe(new Date(1893456000 * 1000).toISOString());
  });

  it('returns a mock cancellation when no subscription row exists for the org', async () => {
    const fetchSpy = fetchReturning({});
    global.fetch = fetchSpy;
    const db = makeDb(null); // no row found
    const res = await jsonReq(
      makeApp(AUTH),
      '/api/billing/subscription/cancel',
      undefined,
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x', DB: db }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('canceled');
    // never reaches Stripe when no sub id is on file
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 400 with STRIPE_ERROR when the cancel call fails', async () => {
    global.fetch = fetchReturning({ error: { message: 'sub gone' } }, { ok: false, status: 404 });
    const db = makeDb({ stripe_subscription_id: 'sub_live_1' });
    const res = await jsonReq(
      makeApp(AUTH),
      '/api/billing/subscription/cancel',
      undefined,
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x', DB: db }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('STRIPE_ERROR');
  });
});

// ─── POST /api/agency/stripe-connect/onboard ──────────────────────────────────

describe('POST /api/agency/stripe-connect/onboard', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await jsonReq(makeApp(), '/api/agency/stripe-connect/onboard', undefined, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns a mock onboarding_url when Stripe is not configured', async () => {
    const res = await jsonReq(makeApp(AUTH), '/api/agency/stripe-connect/onboard', undefined, makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { onboarding_url: string };
    expect(json.onboarding_url).toContain('connect.stripe.com');
  });

  it('creates a Connect account + onboarding link when keys are present', async () => {
    let call = 0;
    global.fetch = jest.fn(async () => {
      call += 1;
      if (call === 1) return { ok: true, status: 200, json: async () => ({ id: 'acct_live_1' }) };
      return { ok: true, status: 200, json: async () => ({ url: 'https://connect.stripe.com/setup/acct_live_1' }) };
    }) as unknown as typeof fetch;

    const res = await jsonReq(
      makeApp(AUTH),
      '/api/agency/stripe-connect/onboard',
      undefined,
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { onboarding_url: string; account_id: string };
    expect(json.account_id).toBe('acct_live_1');
    expect(json.onboarding_url).toBe('https://connect.stripe.com/setup/acct_live_1');
    expect((global.fetch as jest.Mock)).toHaveBeenCalledTimes(2);
  });

  it('returns 400 when the Connect account cannot be created', async () => {
    global.fetch = fetchReturning({}, { ok: false, status: 400 });
    const res = await jsonReq(
      makeApp(AUTH),
      '/api/agency/stripe-connect/onboard',
      undefined,
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('STRIPE_ERROR');
  });

  it('returns 400 when the account link cannot be created', async () => {
    let call = 0;
    global.fetch = jest.fn(async () => {
      call += 1;
      if (call === 1) return { ok: true, status: 200, json: async () => ({ id: 'acct_live_1' }) };
      return { ok: false, status: 400, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const res = await jsonReq(
      makeApp(AUTH),
      '/api/agency/stripe-connect/onboard',
      undefined,
      makeEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('STRIPE_ERROR');
  });
});

// ─── GET /api/affiliates/payouts ──────────────────────────────────────────────

describe('GET /api/affiliates/payouts', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await getReq(makeApp(), '/api/affiliates/payouts', makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns pending payout rows scoped to the caller org', async () => {
    const res = await getReq(makeApp(AUTH), '/api/affiliates/payouts', makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      payouts: Array<{ affiliate_id: string; amount_cents: number; status: string }>;
    };
    expect(json.payouts).toHaveLength(1);
    expect(json.payouts[0].status).toBe('pending');
    expect(json.payouts[0].amount_cents).toBe(2500);
    // affiliate id is derived from the org id slice: `aff_${orgId.slice(0,6)}`
    expect(json.payouts[0].affiliate_id).toBe('aff_org-1');
  });
});
