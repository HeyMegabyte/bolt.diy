/**
 * @module __tests__/voice
 * @description Route-layer tests for the AI Voice + SMS module. Focus: every
 * resource-ownership-by-id gate now returns **404 (never 403)** for a
 * site/number/call/recording the caller's org doesn't own — and a foreign-org
 * resource is indistinguishable from a missing one (existence oracle closed).
 * Previously `requireSiteMembership` + the number/call gates split into 404
 * (missing) vs 403 (foreign), leaking that the id was real.
 *
 * Twilio/audit/agent services are mocked so these exercise the ownership
 * plumbing, not the integrations.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/twilio.js', () => ({
  isTwilioConfigured: jest.fn().mockReturnValue(true),
  searchAvailableNumbers: jest.fn().mockResolvedValue([]),
  purchaseNumber: jest.fn(),
  releaseNumber: jest.fn().mockResolvedValue(undefined),
  formatVanity: jest.fn().mockReturnValue(null),
  letterToDigit: jest.fn().mockReturnValue(''),
}));

jest.mock('../services/vanity_generator.js', () => ({ suggestVanityWords: jest.fn() }));
jest.mock('../services/sms_agent.js', () => ({ simulateInbound: jest.fn() }));
jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

import { Hono } from 'hono';
import { dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';
import { voiceRoutes } from '../routes/voice.js';
import { errorHandler } from '../middleware/error_handler.js';
import type { Env, Variables } from '../types/env.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;

const baseDb = () =>
  ({
    prepare: () => ({ bind: () => ({ run: async () => ({ meta: {} }) }) }),
  }) as unknown as Env['DB'];

function app(ids?: { userId?: string; orgId?: string }) {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use('*', async (c, next) => {
    if (ids?.userId) c.set('userId', ids.userId);
    if (ids?.orgId) c.set('orgId', ids.orgId);
    c.set('requestId', 'test-req');
    await next();
  });
  a.onError(errorHandler);
  a.route('/', voiceRoutes);
  const env = { DB: baseDb(), ENVIRONMENT: 'test' } as unknown as Env;
  const ctx = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  const request = (path: string, init?: RequestInit) => a.request(path, init, env, ctx);
  return { request };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
});

// ─── requireSiteMembership (via GET /numbers?siteId=) ─────────────────
describe('site-membership gate (404 never 403)', () => {
  it('401 when unauthenticated', async () => {
    const { request } = app();
    expect((await request('/api/voice/numbers?siteId=s1')).status).toBe(401);
  });

  it('400 when siteId is missing', async () => {
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request('/api/voice/numbers')).status).toBe(400);
  });

  it('404 for a non-existent site', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // requireSiteMembership site lookup
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request('/api/voice/numbers?siteId=s1')).status).toBe(404);
  });

  it('404 (NOT 403) for a foreign-org site — identical to missing (oracle closed)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 's1', org_id: 'OTHER_ORG' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/voice/numbers?siteId=s1');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(mockQuery).not.toHaveBeenCalled(); // never lists a foreign site's numbers
  });

  it('200 lists numbers for an org-owned site', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 's1', org_id: 'org-a' } as never);
    mockQuery.mockResolvedValueOnce({
      data: [{ id: 'n1', phone_number: '+15551234567' }],
      error: null,
    });
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/voice/numbers?siteId=s1');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { numbers: unknown[] }).numbers).toHaveLength(1);
  });
});

// ─── DELETE /numbers/:id (number ownership) ──────────────────────────
describe('DELETE /api/voice/numbers/:id (404 never 403)', () => {
  it('404 for a missing number', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request('/api/voice/numbers/n1', { method: 'DELETE' })).status).toBe(404);
  });

  it('404 (NOT 403) for a foreign-org number (no release, no update)', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'n1',
      org_id: 'OTHER_ORG',
      twilio_sid: 'PNxxx',
      phone_number: '+15551234567',
    } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/voice/numbers/n1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(mockUpdate).not.toHaveBeenCalled(); // never soft-deletes a foreign number
  });
});

// ─── GET /calls/:id (call ownership) ─────────────────────────────────
describe('GET /api/voice/calls/:id (404 never 403)', () => {
  it('404 for a missing call', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request('/api/voice/calls/c1')).status).toBe(404);
  });

  it('404 (NOT 403) for a foreign-org call (transcript never returned)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'c1', org_id: 'OTHER_ORG' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/voice/calls/c1');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(mockQuery).not.toHaveBeenCalled(); // recordings query never runs for a foreign call
  });

  it('200 returns call + recordings for an owned call', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'c1', org_id: 'org-a' } as never);
    mockQuery.mockResolvedValueOnce({ data: [{ id: 'rec1' }], error: null });
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/voice/calls/c1');
    expect(res.status).toBe(200);
    const out = (await res.json()) as { call: unknown; recordings: unknown[] };
    expect(out.recordings).toHaveLength(1);
  });
});

// ─── GET /recordings/:id/stream (recording ownership via call) ───────
describe('GET /api/voice/recordings/:id/stream (404 never 403)', () => {
  it('404 for a missing recording', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // recording lookup
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request('/api/voice/recordings/r1/stream')).status).toBe(404);
  });

  it('404 (NOT 403) when the recording’s call belongs to another org', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'r1',
        call_id: 'c1',
        r2_key: 'k',
        mime: null,
        size_bytes: null,
      } as never) // recording
      .mockResolvedValueOnce({ org_id: 'OTHER_ORG' } as never); // owning call
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/voice/recordings/r1/stream');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});
