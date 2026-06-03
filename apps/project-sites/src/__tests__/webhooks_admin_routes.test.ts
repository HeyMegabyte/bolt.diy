/**
 * Route coverage for the Outbound Webhooks admin API (convergence r41).
 *
 * Exercises every handler in {@link webhooksAdmin} end-to-end through the real
 * Hono app, mocking only the service boundaries (feature flag, site ownership,
 * `outbound_webhooks` service). Covers: auth 401, flag-gate 404, foreign-org
 * 404, Zod 400, list/create/delete/deliveries success, service-rejection 400,
 * delete-miss 404, and the secret-leak contract (secret returned ONCE on
 * create, NEVER on list).
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));
jest.mock('../services/site_ownership.js', () => ({
  assertSiteOwned: jest.fn(),
}));
jest.mock('../services/outbound_webhooks.js', () => ({
  createWebhookEndpoint: jest.fn(),
  listWebhookEndpoints: jest.fn(),
  deleteWebhookEndpoint: jest.fn(),
  listDeliveries: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { webhooksAdmin } from '../routes/webhooks_admin.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assertSiteOwned } from '../services/site_ownership.js';
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
  deleteWebhookEndpoint,
  listDeliveries,
} from '../services/outbound_webhooks.js';

const mockIsFlagOn = isFlagOn as unknown as jest.Mock;
const mockAssertSiteOwned = assertSiteOwned as unknown as jest.Mock;
const mockCreate = createWebhookEndpoint as unknown as jest.Mock;
const mockList = listWebhookEndpoints as unknown as jest.Mock;
const mockDelete = deleteWebhookEndpoint as unknown as jest.Mock;
const mockDeliveries = listDeliveries as unknown as jest.Mock;

// ─── Harness ───────────────────────────────────────────────────────────────

function makeEnv(): Env {
  return { ENVIRONMENT: 'test', DB: {} as D1Database } as unknown as Env;
}

/** App with a middleware that seeds the auth context vars the gate reads. */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    await next();
  });
  app.route('/', webhooksAdmin);
  return app;
}

const SITE = 'site-1';
const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1' };

function req(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  init: RequestInit,
  env: Env,
) {
  return app.request(path, init, env);
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: flag on + site owned, so the gate passes unless a test overrides.
  mockIsFlagOn.mockResolvedValue(true);
  mockAssertSiteOwned.mockResolvedValue(true);
});

// ─── Gate (shared by all handlers) ───────────────────────────────────────────

describe('webhooks_admin — gate', () => {
  it('returns 401 when unauthenticated (no userId)', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), `/api/sites/${SITE}/webhooks`, { method: 'GET' }, env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    // Short-circuits before flag/ownership/service.
    expect(mockIsFlagOn).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns 404 when the outbound_webhooks flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), `/api/sites/${SITE}/webhooks`, { method: 'GET' }, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND'); // never 403 — don't leak feature existence
    expect(mockIsFlagOn).toHaveBeenCalledWith(env, 'outbound_webhooks', { siteId: SITE, orgId: 'org-1' });
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns 404 when the site is not owned by the caller org', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), `/api/sites/${SITE}/webhooks`, { method: 'GET' }, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', SITE);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns 404 when authenticated but orgId is absent', async () => {
    const env = makeEnv();
    // userId present, orgId missing → gate's `!orgId` short-circuits to 404.
    const res = await req(makeApp({ userId: 'user-1' }), `/api/sites/${SITE}/webhooks`, { method: 'GET' }, env);
    expect(res.status).toBe(404);
    expect(mockList).not.toHaveBeenCalled();
  });
});

// ─── GET list ────────────────────────────────────────────────────────────────

describe('GET /api/sites/:siteId/webhooks', () => {
  it('returns 200 with org+site-scoped endpoints (NO secret field)', async () => {
    const endpoints = [
      { id: 'ep-1', url: 'https://hook.example/a', eventTypes: ['site.published'], enabled: 1 },
      { id: 'ep-2', url: 'https://hook.example/b', eventTypes: ['site.deleted'], enabled: 1 },
    ];
    mockList.mockResolvedValue(endpoints);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), `/api/sites/${SITE}/webhooks`, { method: 'GET' }, env);
    expect(res.status).toBe(200);
    const text = await res.text();
    const json = JSON.parse(text) as { ok: boolean; endpoints: typeof endpoints };
    expect(json.ok).toBe(true);
    expect(json.endpoints).toHaveLength(2);
    expect(mockList).toHaveBeenCalledWith(env, 'org-1', SITE);
    // Secret-leak contract: the list response must never carry a signing secret.
    expect(text).not.toMatch(/secret/i);
    expect(text).not.toMatch(/whsec_/);
  });

  it('returns 200 with an empty list when no endpoints exist', async () => {
    mockList.mockResolvedValue([]);
    const res = await req(makeApp(AUTH), `/api/sites/${SITE}/webhooks`, { method: 'GET' }, makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; endpoints: unknown[] };
    expect(json.endpoints).toEqual([]);
  });
});

// ─── GET deliveries ──────────────────────────────────────────────────────────

describe('GET /api/sites/:siteId/webhooks/deliveries', () => {
  it('returns 200 with the delivery log', async () => {
    const deliveries = [{ id: 'dlv-1', status: 'success', responseStatus: 200 }];
    mockDeliveries.mockResolvedValue(deliveries);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), `/api/sites/${SITE}/webhooks/deliveries`, { method: 'GET' }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; deliveries: typeof deliveries };
    expect(json.ok).toBe(true);
    expect(json.deliveries).toHaveLength(1);
    expect(mockDeliveries).toHaveBeenCalledWith(env, SITE);
  });

  it('is gated: 401 when unauthenticated', async () => {
    const res = await req(makeApp(), `/api/sites/${SITE}/webhooks/deliveries`, { method: 'GET' }, makeEnv());
    expect(res.status).toBe(401);
    expect(mockDeliveries).not.toHaveBeenCalled();
  });
});

// ─── POST create ─────────────────────────────────────────────────────────────

describe('POST /api/sites/:siteId/webhooks', () => {
  const VALID = { url: 'https://hook.example/in', eventTypes: ['site.published'] };

  it('returns 201 with id + secret on success (secret shown ONCE)', async () => {
    mockCreate.mockResolvedValue({ ok: true, id: 'ep-new', secret: 'whsec_abc123' });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), `/api/sites/${SITE}/webhooks`, jsonInit('POST', VALID), env);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; id: string; secret: string };
    expect(json.ok).toBe(true);
    expect(json.id).toBe('ep-new');
    expect(json.secret).toBe('whsec_abc123'); // create is the ONLY place the secret is returned
    expect(mockCreate).toHaveBeenCalledWith(env, 'org-1', SITE, VALID.url, VALID.eventTypes);
  });

  it('returns 400 when the URL is not a valid URL (Zod)', async () => {
    const env = makeEnv();
    const res = await req(
      makeApp(AUTH),
      `/api/sites/${SITE}/webhooks`,
      jsonInit('POST', { url: 'not-a-url', eventTypes: ['x'] }),
      env,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when eventTypes is empty (Zod min 1)', async () => {
    const res = await req(
      makeApp(AUTH),
      `/api/sites/${SITE}/webhooks`,
      jsonInit('POST', { url: 'https://hook.example/in', eventTypes: [] }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when an unknown key is present (Zod .strict)', async () => {
    const res = await req(
      makeApp(AUTH),
      `/api/sites/${SITE}/webhooks`,
      jsonInit('POST', { ...VALID, extra: 'nope' }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not valid JSON (parsed as {} → Zod fails)', async () => {
    const env = makeEnv();
    const res = await req(
      makeApp(AUTH),
      `/api/sites/${SITE}/webhooks`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' },
      env,
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when the service rejects the endpoint', async () => {
    mockCreate.mockResolvedValue({ ok: false, errors: ['url host not allowed'] });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), `/api/sites/${SITE}/webhooks`, jsonInit('POST', VALID), env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string; details?: unknown } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(json.error?.details).toEqual(['url host not allowed']);
  });

  it('is gated: 401 unauthenticated, 404 flag-off — never reaches the service', async () => {
    const env = makeEnv();
    const unauth = await req(makeApp(), `/api/sites/${SITE}/webhooks`, jsonInit('POST', VALID), env);
    expect(unauth.status).toBe(401);

    mockIsFlagOn.mockResolvedValue(false);
    const off = await req(makeApp(AUTH), `/api/sites/${SITE}/webhooks`, jsonInit('POST', VALID), env);
    expect(off.status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('DELETE /api/sites/:siteId/webhooks/:id', () => {
  it('returns 200 when an owned endpoint is deleted', async () => {
    mockDelete.mockResolvedValue({ ok: true });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), `/api/sites/${SITE}/webhooks/ep-1`, { method: 'DELETE' }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith(env, 'org-1', SITE, 'ep-1');
  });

  it('returns 404 when the endpoint is missing or already deleted', async () => {
    mockDelete.mockResolvedValue({ ok: false });
    const res = await req(makeApp(AUTH), `/api/sites/${SITE}/webhooks/ep-x`, { method: 'DELETE' }, makeEnv());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('is gated: 401 unauthenticated — never reaches the service', async () => {
    const res = await req(makeApp(), `/api/sites/${SITE}/webhooks/ep-1`, { method: 'DELETE' }, makeEnv());
    expect(res.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
