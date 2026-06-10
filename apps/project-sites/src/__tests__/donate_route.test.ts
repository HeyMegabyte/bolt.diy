/**
 * Coverage for the PUBLIC `POST /api/donate` Stripe-checkout endpoint
 * (`routes/search.ts`). This is an UNAUTHENTICATED, payment-creating surface,
 * so its input boundary is security-relevant:
 *   - a non-integer / `NaN` / string amount must NOT reach Stripe's `unit_amount`
 *     (`"abc" < 100` is `false`, so the old cast let it slip through)
 *   - a malformed JSON body must be a clean 400, never an unhandled 500
 *   - client-supplied `successUrl`/`cancelUrl` must be https (no `javascript:`/
 *     `data:` redirect injection into Stripe's hosted-checkout return URL)
 *
 * Validation runs BEFORE the Stripe fetch, so the 400 tests need no Stripe key;
 * one happy-path test mocks the Stripe REST call.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { search, pickSafeRedirect } from '../routes/search.js';

describe('pickSafeRedirect — own-domain-only Stripe redirect', () => {
  const allowed = new Set(['nsk.projectsites.dev', 'donate.nsk.org']);
  const fallback = 'https://nsk.projectsites.dev/donate.html';

  it('keeps a URL on one of the site own domains', () => {
    expect(pickSafeRedirect('https://nsk.projectsites.dev/thanks', fallback, allowed)).toBe(
      'https://nsk.projectsites.dev/thanks',
    );
    expect(pickSafeRedirect('https://donate.nsk.org/ok', fallback, allowed)).toBe(
      'https://donate.nsk.org/ok',
    );
  });

  it('falls back for a cross-host (phishing) URL', () => {
    expect(pickSafeRedirect('https://evil.com/steal', fallback, allowed)).toBe(fallback);
  });

  it('falls back when undefined or unparseable', () => {
    expect(pickSafeRedirect(undefined, fallback, allowed)).toBe(fallback);
    expect(pickSafeRedirect('::::not a url', fallback, allowed)).toBe(fallback);
  });
});

// .first() answers the site lookup (id + business_name); .all() answers the
// hostnames lookup (default: no custom domains → only {slug}.projectsites.dev).
let mockHostnames: { hostname: string }[] = [];
const mockDb = {
  prepare: jest.fn(() => ({
    bind: jest.fn(() => ({
      first: jest.fn().mockResolvedValue({ id: 'site-1', business_name: 'Newark Soup Kitchen' }),
      all: jest.fn().mockResolvedValue({ results: mockHostnames }),
    })),
  })),
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
app.route('/', search);

function post(env: Env, body: unknown, rawBody?: string) {
  return app.request(
    '/api/donate',
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
  jest.clearAllMocks();
});

describe('POST /api/donate — input boundary', () => {
  it('returns 400 (not 500) on a malformed JSON body', async () => {
    const res = await post(makeEnv(), undefined, 'not-json');
    expect(res.status).toBe(400);
  });

  it('rejects an amount below the $1.00 floor (message preserved)', async () => {
    const res = await post(makeEnv(), { slug: 'nsk', amount: 50 });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/min \$1\.00/);
  });

  it('rejects a non-integer amount (would break Stripe unit_amount)', async () => {
    const res = await post(makeEnv(), { slug: 'nsk', amount: 100.5 });
    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric amount that the old `< 100` check let through', async () => {
    const res = await post(makeEnv(), { slug: 'nsk', amount: 'abc' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-https successUrl (redirect injection)', async () => {
    const res = await post(makeEnv(), {
      slug: 'nsk',
      amount: 5000,
      // eslint-disable-next-line no-script-url
      successUrl: 'javascript:alert(1)',
    });
    expect(res.status).toBe(400);
  });

  it('ignores a cross-host successUrl and falls back to the site own domain', async () => {
    mockHostnames = []; // no custom domains → only nsk.projectsites.dev allowed
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ url: 'https://x', id: 'cs_1' }), { status: 200 }),
      );
    global.fetch = fetchMock;
    const res = await post(makeEnv(), {
      slug: 'nsk',
      amount: 5000,
      successUrl: 'https://evil.com/phish',
    });
    expect(res.status).toBe(200);
    const sentForm = (fetchMock.mock.calls[0][1] as RequestInit).body;
    const success = new URLSearchParams(String(sentForm)).get('success_url');
    expect(success).not.toContain('evil.com');
    expect(success).toContain('nsk.projectsites.dev');
  });

  it('creates a Stripe checkout session for a valid donation', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_1', id: 'cs_test_1' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const res = await post(makeEnv(), { slug: 'nsk', amount: 5000, interval: 'one_time' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string; sessionId: string };
    expect(json.url).toContain('checkout.stripe.com');
    expect(json.sessionId).toBe('cs_test_1');
  });
});
