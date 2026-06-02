/**
 * @module __tests__/editor_chats
 * @description Route-layer tests for the native editor-chat module. Focus: the
 * ownership gates now return **404 (never 403)** for an inaccessible site or a
 * chat owned by another user — a foreign resource is indistinguishable from a
 * missing one (existence oracle closed). Editor chats are (site, user)-scoped:
 * even an org co-member cannot read another user's threads.
 *
 * `editor_llm` is mocked so these exercise the CRUD/ownership plumbing, not the
 * provider stream.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbExecute: jest.fn().mockResolvedValue({ error: null }),
}));

jest.mock('../services/editor_llm.js', () => ({ streamChatResponse: jest.fn() }));

import { Hono } from 'hono';
import { dbQuery, dbQueryOne, dbInsert, dbExecute } from '../services/db.js';
import { editorChats } from '../routes/editor_chats.js';
import { errorHandler } from '../middleware/error_handler.js';
import type { Env, Variables } from '../types/env.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockExecute = dbExecute as jest.MockedFunction<typeof dbExecute>;

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
  a.route('/', editorChats);
  const env = { DB: baseDb() } as unknown as Env;
  const ctx = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  const request = (path: string, init?: RequestInit) => a.request(path, init, env, ctx);
  return { request };
}

const json = { 'content-type': 'application/json' };
const CHAT = {
  id: 'ch1',
  site_id: 's1',
  user_id: 'u',
  title: 'New conversation',
  model: 'm',
  provider: 'workers-ai',
  created_at: 't',
  updated_at: 't',
};

beforeEach(() => {
  jest.resetAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
  mockExecute.mockResolvedValue({ error: null });
});

// ─── GET /api/editor-chats?site_id= (ensureSiteAccess → 404 never 403) ─
describe('GET /api/editor-chats (site access gate)', () => {
  it('401 when unauthenticated', async () => {
    const { request } = app();
    expect((await request('/api/editor-chats?site_id=s1')).status).toBe(401);
  });

  it('400 when site_id is missing', async () => {
    const { request } = app({ userId: 'u' });
    expect((await request('/api/editor-chats')).status).toBe(400);
  });

  it('404 (NOT 403) when the site is inaccessible — list never runs', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // ensureSiteAccess → no accessible row
    const { request } = app({ userId: 'u' });
    const res = await request('/api/editor-chats?site_id=s1');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('200 lists chats for an accessible site', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 's1' } as never); // accessible
    mockQuery.mockResolvedValueOnce({ data: [{ id: 'ch1' }], error: null });
    const { request } = app({ userId: 'u' });
    const res = await request('/api/editor-chats?site_id=s1');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { chats: unknown[] }).chats).toHaveLength(1);
  });
});

// ─── POST /api/editor-chats (create — site access gated) ──────────────
describe('POST /api/editor-chats', () => {
  const body = JSON.stringify({ site_id: 's1', provider: 'workers-ai' });

  it('404 creating against an inaccessible site (no insert)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // ensureSiteAccess
    const { request } = app({ userId: 'u' });
    const res = await request('/api/editor-chats', { method: 'POST', headers: json, body });
    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('201 creating against an accessible site', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 's1' } as never) // ensureSiteAccess
      .mockResolvedValueOnce(CHAT as never); // loadOwnedChat re-read
    const { request } = app({ userId: 'u' });
    const res = await request('/api/editor-chats', { method: 'POST', headers: json, body });
    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('400 on an invalid body (missing site_id)', async () => {
    const { request } = app({ userId: 'u' });
    const res = await request('/api/editor-chats', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ provider: 'workers-ai' }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET/POST/DELETE :chatId (loadOwnedChat → 404 for missing AND foreign) ─
describe('chat-scoped routes (loadOwnedChat existence-oracle closed)', () => {
  it('GET → 404 for a missing chat', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const { request } = app({ userId: 'u' });
    expect((await request('/api/editor-chats/ch1')).status).toBe(404);
  });

  it('GET → 404 (NOT 403) for another user’s chat — identical to missing', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...CHAT, user_id: 'OTHER_USER' } as never);
    const { request } = app({ userId: 'u' });
    const res = await request('/api/editor-chats/ch1');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(mockQuery).not.toHaveBeenCalled(); // messages never loaded for a foreign chat
  });

  it('GET → 200 returns chat + messages for the owner', async () => {
    mockQueryOne.mockResolvedValueOnce(CHAT as never);
    mockQuery.mockResolvedValueOnce({ data: [{ id: 'm1' }], error: null });
    const { request } = app({ userId: 'u' });
    const res = await request('/api/editor-chats/ch1');
    expect(res.status).toBe(200);
    const out = (await res.json()) as { messages: unknown[] };
    expect(out.messages).toHaveLength(1);
  });

  it('POST messages → 404 for another user’s chat (no insert)', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...CHAT, user_id: 'OTHER_USER' } as never);
    const { request } = app({ userId: 'u' });
    const res = await request('/api/editor-chats/ch1/messages', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ role: 'user', content: 'hi' }),
    });
    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('DELETE → 404 for a missing chat (no soft-delete)', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const { request } = app({ userId: 'u' });
    const res = await request('/api/editor-chats/ch1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('DELETE → 200 soft-deletes the owner’s chat', async () => {
    mockQueryOne.mockResolvedValueOnce(CHAT as never);
    const { request } = app({ userId: 'u' });
    const res = await request('/api/editor-chats/ch1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalled();
  });
});
