/**
 * Coverage for the AUTHED `POST /api/domains/purchase` Stripe-checkout endpoint
 * (`routes/api.ts`). Like `/api/donate`, this hands client-supplied
 * `success_url`/`cancel_url` straight to Stripe's hosted-checkout return URL —
 * so an authed user could set `success_url=https://evil.com/phish` and have
 * Stripe redirect the buyer off-site post-payment (open-redirect / phishing).
 * The body was read with a bare `as`-cast, so:
 *   - a malformed JSON body 500'd instead of a clean 400
 *   - `success_url`/`cancel_url` were unconstrained (any host, any scheme)
 *
 * The fix mirrors the donate hardening: a Zod boundary (https-only URLs) plus
 * `pickSafeRedirect` clamping the redirect to the site's OWN domains (its
 * `{slug}.projectsites.dev` + registered custom hostnames + the platform host),
 * falling back to a safe default URL otherwise. Validation runs before the
 * Stripe fetch, so the 400 tests need no Stripe key; the redirect test mocks it.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';

// SQL-aware mock: site/user lookups go through dbQueryOne→dbQuery→.all(), the
// hostnames lookup uses .all() directly, and audit writes use .run(). Branch on
// the SQL so each query gets the right shape (sites row / user row / hostnames).
let mockHostnames: { hostname: string }[] = [];
const siteRow = { id: 'site-1', org_id: 'org-1', slug: 'nsk' };
const userRow = { email: 'a@b.com' };
const mockDb = {
  prepare: jest.fn((sql: string) => {
    const isHostnames = /FROM hostnames/i.test(sql);
    const isUsers = /FROM users/i.test(sql);
    const row = isHostnames ? null : isUsers ? userRow : siteRow;
    const results = isHostnames ? mockHostnames : row ? [row] : [];
    return {
      bind: jest.fn(() => ({
        first: jest.fn().mockResolvedValue(row),
        all: jest.fn().mockResolvedValue({ results }),
        run: jest.fn().mockResolvedValue({}),
      })),
    };
  }),
} as unknown as D1Database;

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: mockDb,
    STRIPE_SECRET_KEY: 'sk_test_x',
    ...overrides,
  } as unknown as Env;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.use('*', async (c, next) => {
  c.set('orgId', 'org-1');
  c.set('userId', 'user-1');
  c.set('requestId', 'req-1');
  await next();
});
app.route('/', api);

function post(env: Env, body: unknown, rawBody?: string) {
  return app.request(
    '/api/domains/purchase',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody !== undefined ? rawBody : JSON.stringify(body),
    },
    env,
  );
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  mockHostnames = [];
  jest.clearAllMocks();
});

describe('POST /api/domains/purchase — input boundary', () => {
  it('returns 400 (not 500) on a malformed JSON body', async () => {
    const res = await post(makeEnv(), undefined, 'not-json');
    expect(res.status).toBe(400);
  });

  it('rejects a missing domain / site_id', async () => {
    const res = await post(makeEnv(), { domain: 'example.com' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-https success_url (redirect-scheme injection)', async () => {
    const res = await post(makeEnv(), {
      domain: 'example.com',
      site_id: 'site-1',
      // eslint-disable-next-line no-script-url
      success_url: 'javascript:alert(1)',
    });
    expect(res.status).toBe(400);
  });

  it('ignores a cross-host success_url and falls back to a safe own domain', async () => {
    mockHostnames = []; // no custom domains → only nsk.projectsites.dev + platform host
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ url: 'https://x', id: 'cs_1' }), { status: 200 }),
      );
    global.fetch = fetchMock;
    const res = await post(makeEnv(), {
      domain: 'example.com',
      site_id: 'site-1',
      success_url: 'https://evil.com/phish',
      cancel_url: 'https://evil.com/cancel',
    });
    expect(res.status).toBe(200);
    const sentForm = (fetchMock.mock.calls[0][1] as RequestInit).body;
    const params = new URLSearchParams(String(sentForm));
    expect(params.get('success_url')).not.toContain('evil.com');
    expect(params.get('cancel_url')).not.toContain('evil.com');
  });

  it('keeps a success_url that points at the site own domain', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ url: 'https://x', id: 'cs_1' }), { status: 200 }),
      );
    global.fetch = fetchMock;
    const res = await post(makeEnv(), {
      domain: 'example.com',
      site_id: 'site-1',
      success_url: 'https://nsk.projectsites.dev/thanks',
    });
    expect(res.status).toBe(200);
    const params = new URLSearchParams(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(params.get('success_url')).toBe('https://nsk.projectsites.dev/thanks');
  });

  it('creates a Stripe checkout session for a valid purchase', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_1', id: 'cs_test_1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    const res = await post(makeEnv(), { domain: 'example.com', site_id: 'site-1' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { checkout_url: string; session_id: string } };
    expect(json.data.checkout_url).toContain('checkout.stripe.com');
    expect(json.data.session_id).toBe('cs_test_1');
  });
});
