/**
 * GET/POST /api/admin/notifications — per-user, cross-device notification prefs.
 *
 * The admin "Notification preferences" toggles (user-settings.component.ts
 * `toggleNotification()`) keep localStorage as the instant source of truth and
 * forward-sync the FULL pref map to POST /api/admin/notifications (debounced).
 * Before this route existed, that POST always 404'd (a silent guaranteed-fail
 * the client now latches off). This locks the wired, cross-device behaviour:
 *
 * 1. 401 on both verbs when unauthenticated (no userId)
 * 2. POST persists the validated map to the per-user memory store + echoes it
 * 3. POST rejects a non-boolean / malformed body with 400 and writes NOTHING
 *    (Zod at the boundary — [[zod-everywhere]] + [[contract-first-ai]])
 * 4. GET round-trips exactly what POST stored (cross-device contract)
 * 5. GET never throws on corrupt stored JSON — falls back to empty prefs
 *
 * The store is mocked in-memory so set→get round-trips without real D1.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/anthropic_memory.js', () => {
  const store = new Map<string, string>();
  const k = (scope: { kind: string; id: string }, key: string) => `${scope.kind}:${scope.id}:${key}`;
  return {
    __store: store,
    getMemory: jest.fn(async (_env: unknown, scope: { kind: string; id: string }, key: string) =>
      store.has(k(scope, key)) ? store.get(k(scope, key)) : null,
    ),
    setMemory: jest.fn(async (_env: unknown, scope: { kind: string; id: string }, key: string, value: string) => {
      store.set(k(scope, key), value);
    }),
  };
});

jest.mock('../lib/sentry.js', () => ({ captureError: jest.fn(), captureMessage: jest.fn(), createSentry: jest.fn() }));
jest.mock('../lib/posthog.js', () => ({ capture: jest.fn(), trackAuth: jest.fn(), trackSite: jest.fn(), trackError: jest.fn() }));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
import * as mem from '../services/anthropic_memory.js';

const setMemory = mem.setMemory as unknown as jest.Mock;
const memStore = (mem as unknown as { __store: Map<string, string> }).__store;

function createMockEnv(): Env {
  return { ENVIRONMENT: 'test', DB: {} as D1Database } as unknown as Env;
}

function createApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', api);
  return { app, env: createMockEnv() };
}

const getReq = (app: Hono<{ Bindings: Env; Variables: Variables }>, env: Env) =>
  app.request('/api/admin/notifications', { method: 'GET' }, env);
const postReq = (app: Hono<{ Bindings: Env; Variables: Variables }>, env: Env, body: unknown) =>
  app.request('/api/admin/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);

beforeEach(() => {
  jest.clearAllMocks();
  memStore.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('GET/POST /api/admin/notifications (cross-device notification prefs)', () => {
  it('GET returns 401 when unauthenticated', async () => {
    const { app, env } = createApp({});
    const res = await getReq(app, env);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe('UNAUTHORIZED');
  });

  it('POST returns 401 when unauthenticated and writes nothing', async () => {
    const { app, env } = createApp({});
    const res = await postReq(app, env, { prefs: { digest: true } });
    expect(res.status).toBe(401);
    expect(setMemory).not.toHaveBeenCalled();
  });

  it('POST persists the validated pref map to the per-user store + echoes it', async () => {
    const { app, env } = createApp({ userId: 'user-1' });
    const prefs = { product_digest: true, security_alerts: true, marketing: false };
    const res = await postReq(app, env, { prefs });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { saved?: boolean; prefs?: Record<string, boolean> } };
    expect(body.data?.saved).toBe(true);
    expect(body.data?.prefs).toEqual(prefs);
    // Stored under the USER scope (cross-device), serialized.
    expect(setMemory).toHaveBeenCalledTimes(1);
    const [, scope, key, value] = setMemory.mock.calls[0];
    expect(scope).toEqual({ kind: 'user', id: 'user-1' });
    expect(key).toBe('notification_prefs');
    expect(JSON.parse(value as string)).toEqual(prefs);
  });

  it('POST rejects a non-boolean / malformed body with 400 and writes NOTHING (Zod at the boundary)', async () => {
    const { app, env } = createApp({ userId: 'user-1' });
    const res = await postReq(app, env, { prefs: { digest: 'yes' } }); // value not boolean
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe('VALIDATION_ERROR');
    expect(setMemory).not.toHaveBeenCalled();
  });

  it('POST rejects a body missing the prefs key with 400', async () => {
    const { app, env } = createApp({ userId: 'user-1' });
    const res = await postReq(app, env, { notprefs: {} });
    expect(res.status).toBe(400);
    expect(setMemory).not.toHaveBeenCalled();
  });

  it('GET round-trips exactly what POST stored (cross-device contract)', async () => {
    const { app, env } = createApp({ userId: 'user-1' });
    const prefs = { product_digest: false, build_alerts: true };
    await postReq(app, env, { prefs });
    const res = await getReq(app, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { prefs?: Record<string, boolean> } };
    expect(body.data?.prefs).toEqual(prefs);
  });

  it('GET defaults to empty prefs when nothing has been stored', async () => {
    const { app, env } = createApp({ userId: 'fresh-user' });
    const res = await getReq(app, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data?: { prefs?: Record<string, boolean> } }).data?.prefs).toEqual({});
  });

  it('GET never throws on corrupt stored JSON — falls back to empty prefs', async () => {
    memStore.set('user:user-1:notification_prefs', 'not-valid-json{{');
    const { app, env } = createApp({ userId: 'user-1' });
    const res = await getReq(app, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data?: { prefs?: Record<string, boolean> } }).data?.prefs).toEqual({});
  });

  it('two devices (same userId) see the same prefs — POST on one, GET on another', async () => {
    const prefs = { weekly_summary: true };
    const deviceA = createApp({ userId: 'shared-user' });
    await postReq(deviceA.app, deviceA.env, { prefs });
    const deviceB = createApp({ userId: 'shared-user' }); // fresh app instance = different "device"
    const res = await getReq(deviceB.app, deviceB.env);
    expect(((await res.json()) as { data?: { prefs?: Record<string, boolean> } }).data?.prefs).toEqual(prefs);
  });
});
