/**
 * Route + value-domain tests (TDD Contract #10) for GET/PUT
 * `/api/voice/mcp-attachments` — the voice "MCPs" tab's per-channel
 * `{voice, sms}` attachment persistence (voice → `mcp_connection_ids`, sms →
 * `mcp_sms_connection_ids`, migration 0610). This route was previously UNWIRED
 * → the tab's Save hard-failed with a "Save failed" toast. db + audit are mocked
 * so these exercise the auth / validation / upsert plumbing, not integrations.
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
import { dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import { voiceRoutes } from '../routes/voice.js';
import { errorHandler } from '../middleware/error_handler.js';
import type { Env, Variables } from '../types/env.js';

const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;

const ORG = 'org-1';
const SITE = 'site-1';
const siteRow = { id: SITE, org_id: ORG, business_name: null, business_address: null };
const once = (v: unknown): void => void mockQueryOne.mockResolvedValueOnce(v as never);

function app(auth = true) {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use('*', async (c, next) => {
    if (auth) {
      c.set('userId', 'usr-1');
      c.set('orgId', ORG);
    }
    c.set('requestId', 'test');
    await next();
  });
  a.onError(errorHandler);
  a.route('/', voiceRoutes);
  const env = { DB: {}, ENVIRONMENT: 'test' } as unknown as Env;
  const ctx = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  return { request: (path: string, init?: RequestInit) => a.request(path, init, env, ctx) };
}
const put = (body: unknown, auth = true): Promise<Response> =>
  app(auth).request('/api/voice/mcp-attachments', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const get = (qs: string): Promise<Response> =>
  app().request('/api/voice/mcp-attachments' + qs, { method: 'GET' });

beforeEach(() => {
  jest.resetAllMocks();
  mockInsert.mockResolvedValue({ error: null } as never);
  mockUpdate.mockResolvedValue({ error: null, changes: 1 } as never);
});

describe('PUT /api/voice/mcp-attachments — value domains (TDD #10)', () => {
  it('VALID: upserts both channel lists → 200 with {voice, sms}', async () => {
    once(siteRow); // membership
    once({ id: 'vas-1' }); // existing settings → update
    const res = await put({ site_id: SITE, voice: ['mc-a', 'mc-b'], sms: ['mc-c'] });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { data: { voice: string[]; sms: string[] } };
    expect(j.data).toEqual({ voice: ['mc-a', 'mc-b'], sms: ['mc-c'] });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updates = mockUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(updates.mcp_connection_ids).toBe(JSON.stringify(['mc-a', 'mc-b']));
    expect(updates.mcp_sms_connection_ids).toBe(JSON.stringify(['mc-c']));
  });

  it('EMPTY lists: store null on both columns → 200', async () => {
    once(siteRow);
    once({ id: 'vas-1' });
    const res = await put({ site_id: SITE, voice: [], sms: [] });
    expect(res.status).toBe(200);
    const updates = mockUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(updates.mcp_connection_ids).toBeNull();
    expect(updates.mcp_sms_connection_ids).toBeNull();
  });

  it('UPDATE write failure → 500 (not a lying 200) — matches the INSERT path', async () => {
    once(siteRow); // membership
    once({ id: 'vas-1' }); // existing → update path
    mockUpdate.mockResolvedValueOnce({ error: 'D1_ERROR: disk full', changes: 0 } as never);
    const res = await put({ site_id: SITE, voice: ['mc-a'], sms: [] });
    expect(res.status).toBe(500);
  });

  it('no settings row yet: INSERT a new row → 200', async () => {
    once(siteRow);
    once(null); // no existing settings
    const res = await put({ site_id: SITE, voice: ['mc-a'], sms: [] });
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const row = mockInsert.mock.calls[0][2] as Record<string, unknown>;
    expect(row.site_id).toBe(SITE);
    expect(row.mcp_connection_ids).toBe(JSON.stringify(['mc-a']));
  });

  it('UNAUTHENTICATED: 401, no write', async () => {
    const res = await put({ site_id: SITE, voice: [], sms: [] }, false);
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('FOREIGN/missing site: 404 (never 403), no write', async () => {
    once(null); // membership fails
    const res = await put({ site_id: SITE, voice: [], sms: [] });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('MISSING site_id: 400', async () => {
    const res = await put({ voice: [], sms: [] });
    expect(res.status).toBe(400);
  });

  it('OVERLONG list (>20 ids): 400', async () => {
    const res = await put({
      site_id: SITE,
      voice: Array.from({ length: 21 }, (_, i) => 'id-' + i),
      sms: [],
    });
    expect(res.status).toBe(400);
  });

  it('OVERLONG id (>64 chars): 400', async () => {
    const res = await put({ site_id: SITE, voice: ['x'.repeat(65)], sms: [] });
    expect(res.status).toBe(400);
  });

  it('EMPTY-string id: 400 (min 1)', async () => {
    const res = await put({ site_id: SITE, voice: [''], sms: [] });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/voice/agent-settings — must NOT clobber mcp_connection_ids', () => {
  const putAgent = (body: unknown): Promise<Response> =>
    app().request('/api/voice/agent-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('a save WITHOUT mcp_connection_ids leaves the column UNTOUCHED (does not null it)', async () => {
    once(siteRow); // membership
    once({ id: 'vas-1' }); // existing settings → update path
    // The voice agent-settings tab sends prompts/models/etc but NEVER
    // mcp_connection_ids — that column is OWNED by the dedicated mcp-attachments
    // tab. An unconditional write here NULLED it on every settings save, WIPING
    // the user's voice MCP attachments. It must be omitted from the update set.
    const res = await putAgent({ siteId: SITE, voice_system_prompt: 'Hi there' });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updates = mockUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect('mcp_connection_ids' in updates).toBe(false); // NOT clobbered
    expect(updates.voice_system_prompt).toBe('Hi there'); // provided field still written
  });

  it('a save WITH an explicit mcp_connection_ids still sets it (explicit control preserved)', async () => {
    once(siteRow);
    once({ id: 'vas-1' });
    const res = await putAgent({ siteId: SITE, mcp_connection_ids: ['mc-a', 'mc-b'] });
    expect(res.status).toBe(200);
    const updates = mockUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(updates.mcp_connection_ids).toBe(JSON.stringify(['mc-a', 'mc-b']));
  });

  it('INSERT path (no existing row) without mcp_connection_ids omits it too', async () => {
    once(siteRow);
    once(null); // no existing settings → insert
    const res = await putAgent({ siteId: SITE, voice_system_prompt: 'Hello' });
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const row = mockInsert.mock.calls[0][2] as Record<string, unknown>;
    expect('mcp_connection_ids' in row).toBe(false); // DB default (null), not an explicit wipe
  });
});

describe('GET /api/voice/mcp-attachments — read-back', () => {
  it('parses both columns → {voice, sms}; tolerates malformed JSON', async () => {
    once(siteRow); // membership
    once({ mcp_connection_ids: JSON.stringify(['mc-a']), mcp_sms_connection_ids: 'not-json' });
    const res = await get('?siteId=' + SITE);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { data: { voice: string[]; sms: string[] } };
    expect(j.data.voice).toEqual(['mc-a']);
    expect(j.data.sms).toEqual([]); // malformed → []
  });

  it('no settings row: empty lists, not an error', async () => {
    once(siteRow);
    once(null);
    const res = await get('?siteId=' + SITE);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { data: { voice: string[]; sms: string[] } };
    expect(j.data).toEqual({ voice: [], sms: [] });
  });

  it('missing siteId query: 400', async () => {
    const res = await get('');
    expect(res.status).toBe(400);
  });
});
