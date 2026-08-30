/**
 * Stage 4.1(d) — Functions internal-fetch plane (env.AI debit-then-call).
 *
 * Locks the per-site token HMAC (sign/verify round-trip + tamper/wrong-secret/
 * malformed rejection) and the `POST /api/_ps/ai/run` handler: 401 bad token, 404
 * unknown site, 400 bad body, 402 out of credits (AI NOT called, NOT debited),
 * 502 on an AI fault (NOT debited — never charge a failed run), and the happy path
 * (runs Workers AI + debits exactly 1 credit). credits + db are mocked; the handler
 * runs inside a real Hono app via `app.request`. Global `jest` (swc hoisting).
 */
jest.mock('../../credits.js', () => ({
  getBalance: jest.fn(),
  debitCredits: jest.fn(),
  maybeFireAlerts: jest.fn(async () => {}),
}));
jest.mock('../../db.js', () => ({ dbQuery: jest.fn(), dbQueryOne: jest.fn() }));
jest.mock('../../auth.js', () => ({ getSession: jest.fn() }));

import { Hono } from 'hono';
import {
  signFunctionToken,
  verifyFunctionToken,
  handleFunctionAiRun,
  handleFunctionDataForms,
  handleFunctionDataSite,
  handleFunctionAuthVerifySession,
  handleFunctionTurnstileVerify,
} from '../internal.js';
import { getBalance, debitCredits } from '../../credits.js';
import { dbQuery, dbQueryOne } from '../../db.js';
import { getSession } from '../../auth.js';

const mockBalance = getBalance as unknown as jest.Mock;
const mockDebit = debitCredits as unknown as jest.Mock;
const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockQuery = dbQuery as unknown as jest.Mock;
const mockGetSession = getSession as unknown as jest.Mock;

const SECRET = 'test-secret-123';

function makeApp(aiRun: jest.Mock = jest.fn(async () => ({ response: 'hi from AI' }))) {
  const app = new Hono();
  app.post('/api/_ps/ai/run', handleFunctionAiRun);
  const env = { DB: {}, AI: { run: aiRun }, FUNCTIONS_INTERNAL_SECRET: SECRET };
  return { app, env, aiRun };
}

function call(
  app: Hono,
  env: Record<string, unknown>,
  token: string | undefined,
  body: unknown = { model: '@cf/x', inputs: {} },
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return app.request(
    '/api/_ps/ai/run',
    { method: 'POST', headers, body: JSON.stringify(body) },
    env,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('signFunctionToken / verifyFunctionToken', () => {
  it('round-trips: a signed token verifies to its siteId', async () => {
    const t = await signFunctionToken(SECRET, 'abc');
    expect(t.startsWith('abc.')).toBe(true);
    expect(await verifyFunctionToken(SECRET, t)).toBe('abc');
  });

  it('rejects a tampered signature', async () => {
    const t = await signFunctionToken(SECRET, 'abc');
    const tampered = `${t.slice(0, -1)}${t.at(-1) === '0' ? '1' : '0'}`;
    expect(await verifyFunctionToken(SECRET, tampered)).toBeNull();
  });

  it('rejects a wrong secret', async () => {
    const t = await signFunctionToken(SECRET, 'abc');
    expect(await verifyFunctionToken('other-secret', t)).toBeNull();
  });

  it('rejects malformed / empty tokens', async () => {
    expect(await verifyFunctionToken(SECRET, 'no-dot')).toBeNull();
    expect(await verifyFunctionToken(SECRET, '')).toBeNull();
    expect(await verifyFunctionToken('', 'abc.sig')).toBeNull();
  });
});

describe('POST /api/_ps/ai/run (handleFunctionAiRun)', () => {
  it('401 on a missing or bogus token', async () => {
    const { app, env } = makeApp();
    expect((await call(app, env, undefined)).status).toBe(401);
    expect((await call(app, env, 'bogus.sig')).status).toBe(401);
  });

  it('runs Workers AI + debits exactly 1 credit on a valid token with credits', async () => {
    mockQueryOne.mockResolvedValue({ org_id: 'org1' });
    mockBalance.mockResolvedValue(10);
    mockDebit.mockResolvedValue(9);
    const { app, env, aiRun } = makeApp();
    const token = await signFunctionToken(SECRET, 'site-abc');
    const res = await call(app, env, token, { model: '@cf/meta/llama', inputs: { prompt: 'hi' } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: unknown; credits_remaining: number };
    expect(json.result).toEqual({ response: 'hi from AI' });
    expect(json.credits_remaining).toBe(9);
    expect(aiRun).toHaveBeenCalledWith('@cf/meta/llama', { prompt: 'hi' });
    expect(mockDebit).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        orgId: 'org1',
        siteId: 'site-abc',
        amount: 1,
        reason: 'function.ai',
      }),
    );
  });

  it('402 when out of credits — AI NOT called, NOT debited', async () => {
    mockQueryOne.mockResolvedValue({ org_id: 'org1' });
    mockBalance.mockResolvedValue(0);
    const { app, env, aiRun } = makeApp();
    const res = await call(app, env, await signFunctionToken(SECRET, 'site-abc'));
    expect(res.status).toBe(402);
    expect(aiRun).not.toHaveBeenCalled();
    expect(mockDebit).not.toHaveBeenCalled();
  });

  it('404 when the site is unknown', async () => {
    mockQueryOne.mockResolvedValue(null);
    const { app, env } = makeApp();
    expect((await call(app, env, await signFunctionToken(SECRET, 'ghost'))).status).toBe(404);
  });

  it('400 when model is missing', async () => {
    mockQueryOne.mockResolvedValue({ org_id: 'org1' });
    const { app, env } = makeApp();
    const res = await call(app, env, await signFunctionToken(SECRET, 'site-abc'), { inputs: {} });
    expect(res.status).toBe(400);
  });

  it('502 + NO debit when the AI call throws (never charge a failed run)', async () => {
    mockQueryOne.mockResolvedValue({ org_id: 'org1' });
    mockBalance.mockResolvedValue(10);
    const aiRun = jest.fn(async () => {
      throw new Error('model unavailable');
    });
    const { app, env } = makeApp(aiRun);
    const res = await call(app, env, await signFunctionToken(SECRET, 'site-abc'));
    expect(res.status).toBe(502);
    expect(mockDebit).not.toHaveBeenCalled();
  });
});

// ── Stage 4.1(e) — env.DATA read backends ──
function makeDataApp() {
  const app = new Hono();
  app.get('/api/_ps/data/forms', handleFunctionDataForms);
  app.get('/api/_ps/data/site', handleFunctionDataSite);
  return { app, env: { DB: {}, FUNCTIONS_INTERNAL_SECRET: SECRET } };
}

function dataReq(app: Hono, env: Record<string, unknown>, path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return app.request(path, { method: 'GET', headers }, env);
}

describe('GET /api/_ps/data/forms (handleFunctionDataForms)', () => {
  it('401 on a missing or bogus token', async () => {
    const { app, env } = makeDataApp();
    expect((await dataReq(app, env, '/api/_ps/data/forms')).status).toBe(401);
    expect((await dataReq(app, env, '/api/_ps/data/forms', 'bogus.sig')).status).toBe(401);
  });

  it('returns THIS site’s submissions as a safe shape (parsed fields, no ip/ua)', async () => {
    mockQuery.mockResolvedValue({
      data: [
        {
          id: 'f1',
          form_name: 'contact',
          email: 'a@b.co',
          payload: '{"name":"Ada","msg":"hi"}',
          status: 'received',
          created_at: '2026-08-30T00:00:00Z',
        },
        {
          id: 'f2',
          form_name: 'quote',
          email: null,
          payload: 'not-json',
          status: 'forwarded',
          created_at: '2026-08-29T00:00:00Z',
        },
      ],
    });
    const { app, env } = makeDataApp();
    const res = await dataReq(
      app,
      env,
      '/api/_ps/data/forms',
      await signFunctionToken(SECRET, 'site-abc'),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: Record<string, unknown>[] };
    expect(json.items).toHaveLength(2);
    expect(json.items[0]).toEqual({
      id: 'f1',
      form_name: 'contact',
      email: 'a@b.co',
      fields: { name: 'Ada', msg: 'hi' },
      status: 'received',
      created_at: '2026-08-30T00:00:00Z',
    });
    // malformed payload → {} (never throws), and NO ip_address/user_agent leak
    expect(json.items[1].fields).toEqual({});
    expect(json.items[0]).not.toHaveProperty('ip_address');
    expect(json.items[0]).not.toHaveProperty('user_agent');
    // scoped to the token's siteId, newest-first. form_submissions has NO deleted_at
    // column — the query must NOT reference it (doing so errors → lying-empty).
    const [, sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE site_id = \?/);
    expect(sql).not.toMatch(/deleted_at/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(params[0]).toBe('site-abc');
  });

  it('clamps limit to [1,100] and defaults to 20', async () => {
    mockQuery.mockResolvedValue({ data: [] });
    const { app, env } = makeDataApp();
    const token = await signFunctionToken(SECRET, 'site-abc');
    await dataReq(app, env, '/api/_ps/data/forms?limit=9999', token);
    expect(mockQuery.mock.calls.at(-1)![2][1]).toBe(100);
    await dataReq(app, env, '/api/_ps/data/forms?limit=0', token);
    expect(mockQuery.mock.calls.at(-1)![2][1]).toBe(1);
    await dataReq(app, env, '/api/_ps/data/forms', token);
    expect(mockQuery.mock.calls.at(-1)![2][1]).toBe(20);
  });
});

describe('GET /api/_ps/data/site (handleFunctionDataSite)', () => {
  it('401 on a bogus token', async () => {
    const { app, env } = makeDataApp();
    expect((await dataReq(app, env, '/api/_ps/data/site', 'bogus.sig')).status).toBe(401);
  });

  it('returns the site’s own read-only metadata (scoped by token siteId)', async () => {
    const row = {
      id: 'site-abc',
      slug: 'ada-co',
      business_name: 'Ada Co',
      business_address: '1 Main St',
      status: 'published',
      created_at: '2026-08-01T00:00:00Z',
    };
    mockQueryOne.mockResolvedValue(row);
    const { app, env } = makeDataApp();
    const res = await dataReq(
      app,
      env,
      '/api/_ps/data/site',
      await signFunctionToken(SECRET, 'site-abc'),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ site: row });
    expect(mockQueryOne.mock.calls.at(-1)![2][0]).toBe('site-abc');
  });

  it('404 when the site is missing / soft-deleted', async () => {
    mockQueryOne.mockResolvedValue(null);
    const { app, env } = makeDataApp();
    expect(
      (await dataReq(app, env, '/api/_ps/data/site', await signFunctionToken(SECRET, 'ghost')))
        .status,
    ).toBe(404);
  });
});

// ── Stage 4.2(b) — ctx.verifyOwnerSession() backend ──
function makeAuthApp() {
  const app = new Hono();
  app.post('/api/_ps/auth/verify-session', handleFunctionAuthVerifySession);
  return { app, env: { DB: {}, FUNCTIONS_INTERNAL_SECRET: SECRET } };
}
function authReq(
  app: Hono,
  env: Record<string, unknown>,
  token: string | undefined,
  body: unknown,
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return app.request(
    '/api/_ps/auth/verify-session',
    { method: 'POST', headers, body: JSON.stringify(body) },
    env,
  );
}

describe('POST /api/_ps/auth/verify-session (handleFunctionAuthVerifySession)', () => {
  it('401 on a bad site token', async () => {
    const { app, env } = makeAuthApp();
    expect((await authReq(app, env, 'bogus.sig', {})).status).toBe(401);
  });

  it('404 when the site is unknown', async () => {
    mockQueryOne.mockResolvedValue(null); // sites lookup
    const { app, env } = makeAuthApp();
    expect((await authReq(app, env, await signFunctionToken(SECRET, 'ghost'), {})).status).toBe(
      404,
    );
  });

  it('{authenticated:false} when no session_token is forwarded (no getSession call)', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org1' }); // sites
    const { app, env } = makeAuthApp();
    const res = await authReq(app, env, await signFunctionToken(SECRET, 'site-abc'), {});
    expect(await res.json()).toEqual({ authenticated: false });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('{authenticated:false} when the session token is invalid/expired', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org1' }); // sites
    mockGetSession.mockResolvedValue(null);
    const { app, env } = makeAuthApp();
    const res = await authReq(app, env, await signFunctionToken(SECRET, 'site-abc'), {
      session_token: 'x',
    });
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it('{authenticated:false} when the session user is NOT a member of the site org', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org1' }); // sites
    mockGetSession.mockResolvedValue({ id: 's1', user_id: 'user-x', expires_at: '2099-01-01' });
    mockQueryOne.mockResolvedValueOnce(null); // memberships → not a member
    const { app, env } = makeAuthApp();
    const res = await authReq(app, env, await signFunctionToken(SECRET, 'site-abc'), {
      session_token: 'x',
    });
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it('{authenticated:true, userId, orgId} when the session user IS a member (the owner)', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org1' }); // sites
    mockGetSession.mockResolvedValue({ id: 's1', user_id: 'user-owner', expires_at: '2099-01-01' });
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org1' }); // memberships → member
    const { app, env } = makeAuthApp();
    const res = await authReq(app, env, await signFunctionToken(SECRET, 'site-abc'), {
      session_token: 'x',
    });
    expect(await res.json()).toEqual({ authenticated: true, userId: 'user-owner', orgId: 'org1' });
  });
});

// ── Stage 4.2(b) — ctx.verifyTurnstile() backend ──
function tsReq(app: Hono, env: Record<string, unknown>, token: string | undefined, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return app.request(
    '/api/_ps/turnstile/verify',
    { method: 'POST', headers, body: JSON.stringify(body) },
    env,
  );
}
function makeTsApp(withSecret = true) {
  const app = new Hono();
  app.post('/api/_ps/turnstile/verify', handleFunctionTurnstileVerify);
  const env: Record<string, unknown> = { DB: {}, FUNCTIONS_INTERNAL_SECRET: SECRET };
  if (withSecret) env.TURNSTILE_SECRET_KEY = 'ts-secret';
  return { app, env };
}

describe('POST /api/_ps/turnstile/verify (handleFunctionTurnstileVerify)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('401 on a bad site token', async () => {
    const { app, env } = makeTsApp();
    expect((await tsReq(app, env, 'bogus.sig', { token: 't' })).status).toBe(401);
  });

  it('{success:false} when no token is provided (no siteverify call)', async () => {
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;
    const { app, env } = makeTsApp();
    const res = await tsReq(app, env, await signFunctionToken(SECRET, 'site-abc'), {});
    expect(await res.json()).toEqual({ success: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it('{success:false} when the platform Turnstile secret is unset', async () => {
    const { app, env } = makeTsApp(false);
    const res = await tsReq(app, env, await signFunctionToken(SECRET, 'site-abc'), { token: 't' });
    expect(await res.json()).toEqual({ success: false });
  });

  it('{success:true} when siteverify accepts the token', async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 })) as unknown as typeof fetch;
    const { app, env } = makeTsApp();
    const res = await tsReq(app, env, await signFunctionToken(SECRET, 'site-abc'), {
      token: 'good',
    });
    expect(await res.json()).toEqual({ success: true });
  });

  it('{success:false} when siteverify rejects the token', async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const { app, env } = makeTsApp();
    const res = await tsReq(app, env, await signFunctionToken(SECRET, 'site-abc'), {
      token: 'bad',
    });
    expect(await res.json()).toEqual({ success: false });
  });

  it('{success:false} when siteverify throws (fail-closed)', async () => {
    global.fetch = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    const { app, env } = makeTsApp();
    const res = await tsReq(app, env, await signFunctionToken(SECRET, 'site-abc'), { token: 'x' });
    expect(await res.json()).toEqual({ success: false });
  });
});
