/**
 * Route coverage for the Unified Visitor Inbox API (`src/routes/inbox.ts`,
 * convergence r40). Feature-flag `unified_inbox`.
 *
 * Exercises every handler end-to-end through the real Hono app + the shared
 * {@link errorHandler}, mocking only the boundaries: the feature-flag gate,
 * the inbox service layer, and D1. Covers list, get, reply, assign, status,
 * draft-with-ai, plus the flag gate (404 non-leak), org-scoping (404 on
 * cross-org / missing rows), and Zod validation (400).
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));

jest.mock('../services/inbox.js', () => ({
  listConversations: jest.fn(),
  getMessages: jest.fn(),
  appendMessage: jest.fn(),
  assignConversation: jest.fn(),
  updateConversationStatus: jest.fn(),
  draftReplyWithAI: jest.fn(),
  sendViaChannel: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { inbox } from '../routes/inbox.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  listConversations,
  getMessages,
  appendMessage,
  assignConversation,
  updateConversationStatus,
  draftReplyWithAI,
  sendViaChannel,
} from '../services/inbox.js';

const mockIsFlagOn = isFlagOn as unknown as jest.Mock;
const mockListConversations = listConversations as unknown as jest.Mock;
const mockGetMessages = getMessages as unknown as jest.Mock;
const mockAppendMessage = appendMessage as unknown as jest.Mock;
const mockAssignConversation = assignConversation as unknown as jest.Mock;
const mockUpdateConversationStatus = updateConversationStatus as unknown as jest.Mock;
const mockDraftReplyWithAI = draftReplyWithAI as unknown as jest.Mock;
const mockSendViaChannel = sendViaChannel as unknown as jest.Mock;

// ─── D1 mock ───────────────────────────────────────────────────────────────

/**
 * Minimal D1 mock: `prepare().bind().first()` returns the queued row.
 * Each `prepare` call shifts the next result off the queue so a single
 * handler that issues two queries (reply: conversation + visitor) is
 * deterministic.
 */
function makeDb(firstResults: Array<unknown>) {
  const queue = [...firstResults];
  const prepare = jest.fn(() => ({
    bind: jest.fn(() => ({
      first: jest.fn(async () => (queue.length ? queue.shift() : null)),
    })),
  }));
  return { prepare } as unknown as D1Database;
}

function makeEnv(db: D1Database): Env {
  return {
    ENVIRONMENT: 'test',
    DB: db,
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

/** Seed the auth context vars the handlers read (`orgId`, `userId`). */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', inbox);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function req(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  env: Env,
  init?: { method?: string; body?: unknown },
) {
  return app.request(
    path,
    {
      method: init?.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    },
    env,
    makeCtx(),
  );
}

const AUTH: Partial<Variables> = { orgId: 'org-1', userId: 'user-1', requestId: 'req-1' };
const CONV_ID = 'conv-1';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Unified Visitor Inbox routes', () => {
  // ── Flag gate (404 non-leak) ───────────────────────────────────────────────
  describe('feature-flag gate (unified_inbox off)', () => {
    it('GET /conversations returns 404 (never 403) when the flag is off', async () => {
      mockIsFlagOn.mockResolvedValue(false);
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), '/api/inbox/conversations', env);
      expect(res.status).toBe(404);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toBe('not_found');
      // Gated before touching the service.
      expect(mockListConversations).not.toHaveBeenCalled();
    });

    it('GET /conversations/:id returns 404 when flag off', async () => {
      mockIsFlagOn.mockResolvedValue(false);
      const env = makeEnv(makeDb([{ id: CONV_ID }]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}`, env);
      expect(res.status).toBe(404);
      expect(mockGetMessages).not.toHaveBeenCalled();
    });

    it('POST /reply returns 404 when flag off', async () => {
      mockIsFlagOn.mockResolvedValue(false);
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/reply`, env, {
        method: 'POST',
        body: { body: 'hello' },
      });
      expect(res.status).toBe(404);
      expect(mockAppendMessage).not.toHaveBeenCalled();
    });

    it('POST /status returns 404 when flag off', async () => {
      mockIsFlagOn.mockResolvedValue(false);
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/status`, env, {
        method: 'POST',
        body: { status: 'resolved' },
      });
      expect(res.status).toBe(404);
      expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
    });

    it('passes the caller orgId scope to the flag gate', async () => {
      mockIsFlagOn.mockResolvedValue(false);
      const env = makeEnv(makeDb([]));
      await req(makeApp(AUTH), '/api/inbox/conversations', env);
      expect(mockIsFlagOn).toHaveBeenCalledWith(env, 'unified_inbox', { orgId: 'org-1' });
    });
  });

  // ── Auth (no orgId) ─────────────────────────────────────────────────────────
  it('GET /conversations gates with empty orgId scope when unauthenticated', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv(makeDb([]));
    const res = await req(makeApp(), '/api/inbox/conversations', env);
    expect(res.status).toBe(404);
    expect(mockIsFlagOn).toHaveBeenCalledWith(env, 'unified_inbox', { orgId: '' });
    expect(mockListConversations).not.toHaveBeenCalled();
  });

  // ── GET /conversations (list) ─────────────────────────────────────────────
  describe('GET /api/inbox/conversations', () => {
    beforeEach(() => mockIsFlagOn.mockResolvedValue(true));

    it('returns the conversation list with hasMore + total', async () => {
      const conversations = [{ id: CONV_ID, channel: 'web', status: 'open' }];
      mockListConversations.mockResolvedValue({ conversations, hasMore: true });
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), '/api/inbox/conversations', env);
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        conversations: unknown[];
        hasMore: boolean;
        total: number;
      };
      expect(json.conversations).toEqual(conversations);
      expect(json.hasMore).toBe(true);
      expect(json.total).toBe(1);
    });

    it('forwards status / channel / assigned_to / limit / cursor filters (limit capped at 100)', async () => {
      mockListConversations.mockResolvedValue({ conversations: [], hasMore: false });
      const env = makeEnv(makeDb([]));
      await req(
        makeApp(AUTH),
        '/api/inbox/conversations?status=pending&channel=email&assigned_to=agent-9&limit=500&cursor=cur-2',
        env,
      );
      expect(mockListConversations).toHaveBeenCalledWith(env, 'org-1', {
        status: 'pending',
        channel: 'email',
        assignedTo: 'agent-9',
        limit: 100, // Math.min(500, 100)
        cursor: 'cur-2',
      });
    });

    it("defaults status to 'open' and limit to 25 when no query params", async () => {
      mockListConversations.mockResolvedValue({ conversations: [], hasMore: false });
      const env = makeEnv(makeDb([]));
      await req(makeApp(AUTH), '/api/inbox/conversations', env);
      expect(mockListConversations).toHaveBeenCalledWith(env, 'org-1', {
        status: 'open',
        channel: undefined,
        assignedTo: undefined,
        limit: 25,
        cursor: undefined,
      });
    });

    it('surfaces a 500 when the service throws', async () => {
      mockListConversations.mockRejectedValue(new Error('D1 read failed'));
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), '/api/inbox/conversations', env);
      expect(res.status).toBe(500);
    });
  });

  // ── GET /conversations/:id ────────────────────────────────────────────────
  describe('GET /api/inbox/conversations/:id', () => {
    beforeEach(() => mockIsFlagOn.mockResolvedValue(true));

    it('returns the conversation row + its messages', async () => {
      const row = { id: CONV_ID, org_id: 'org-1', channel: 'web', v_email: 'v@x.com' };
      const messages = [{ id: 'msg-1', body: 'hi' }];
      const env = makeEnv(makeDb([row]));
      mockGetMessages.mockResolvedValue(messages);
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}`, env);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { conversation: unknown; messages: unknown[] };
      expect(json.conversation).toEqual(row);
      expect(json.messages).toEqual(messages);
      expect(mockGetMessages).toHaveBeenCalledWith(env, CONV_ID);
    });

    it('returns 404 (org-scoping non-leak) when the row is not found for this org', async () => {
      const env = makeEnv(makeDb([null])); // cross-org / missing → query returns nothing
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}`, env);
      expect(res.status).toBe(404);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toBe('not_found');
      expect(mockGetMessages).not.toHaveBeenCalled();
    });
  });

  // ── POST /conversations/:id/reply ─────────────────────────────────────────
  describe('POST /api/inbox/conversations/:id/reply', () => {
    beforeEach(() => mockIsFlagOn.mockResolvedValue(true));

    it('appends the message, dispatches via channel, and returns sent status', async () => {
      const conv = { id: CONV_ID, org_id: 'org-1', channel: 'email', visitor_id: 'vis-1' };
      const visitor = { id: 'vis-1', email: 'v@x.com' };
      const env = makeEnv(makeDb([conv, visitor])); // 1st prepare=conv, 2nd=visitor
      const message = { id: 'msg-2', direction: 'outbound', body: 'thanks' };
      mockAppendMessage.mockResolvedValue(message);
      mockSendViaChannel.mockResolvedValue({ sent: true });

      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/reply`, env, {
        method: 'POST',
        body: { body: '  thanks  ' },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { message: unknown; sent: boolean; send_reason: unknown };
      expect(json.message).toEqual(message);
      expect(json.sent).toBe(true);
      expect(json.send_reason).toBeNull();

      // Body is trimmed before persisting + dispatch.
      expect(mockAppendMessage).toHaveBeenCalledWith(
        env,
        expect.objectContaining({
          conversationId: CONV_ID,
          direction: 'outbound',
          authorType: 'agent',
          authorId: 'user-1',
          body: 'thanks',
          channel: 'email',
        }),
      );
      expect(mockSendViaChannel).toHaveBeenCalledWith(env, conv, visitor, 'thanks');
    });

    it('passes through a send failure reason when the channel dispatch is not sent', async () => {
      const conv = { id: CONV_ID, org_id: 'org-1', channel: 'sms', visitor_id: 'vis-1' };
      const env = makeEnv(makeDb([conv, null]));
      mockAppendMessage.mockResolvedValue({ id: 'msg-3' });
      mockSendViaChannel.mockResolvedValue({ sent: false, reason: 'no_phone' });

      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/reply`, env, {
        method: 'POST',
        body: { body: 'ping' },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { sent: boolean; send_reason: string };
      expect(json.sent).toBe(false);
      expect(json.send_reason).toBe('no_phone');
    });

    it('returns 404 (org-scoping non-leak) when the conversation is not in this org', async () => {
      const env = makeEnv(makeDb([null])); // conversation lookup misses
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/reply`, env, {
        method: 'POST',
        body: { body: 'hi' },
      });
      expect(res.status).toBe(404);
      expect(mockAppendMessage).not.toHaveBeenCalled();
      expect(mockSendViaChannel).not.toHaveBeenCalled();
    });

    it('returns 400 when the body is empty (Zod min(1))', async () => {
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/reply`, env, {
        method: 'POST',
        body: { body: '' },
      });
      expect(res.status).toBe(400);
      expect(mockAppendMessage).not.toHaveBeenCalled();
    });

    it('returns 400 when the body field is missing entirely', async () => {
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/reply`, env, {
        method: 'POST',
        body: {},
      });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /conversations/:id/assign ────────────────────────────────────────
  describe('POST /api/inbox/conversations/:id/assign', () => {
    beforeEach(() => mockIsFlagOn.mockResolvedValue(true));

    it('assigns the conversation and echoes assigned_to', async () => {
      const agentId = '11111111-1111-1111-1111-111111111111';
      mockAssignConversation.mockResolvedValue(true);
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/assign`, env, {
        method: 'POST',
        body: { assigned_to: agentId },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; assigned_to: string };
      expect(json.ok).toBe(true);
      expect(json.assigned_to).toBe(agentId);
      expect(mockAssignConversation).toHaveBeenCalledWith(env, CONV_ID, 'org-1', agentId);
    });

    it('accepts a null assignee (unassign)', async () => {
      mockAssignConversation.mockResolvedValue(true);
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/assign`, env, {
        method: 'POST',
        body: { assigned_to: null },
      });
      expect(res.status).toBe(200);
      expect(mockAssignConversation).toHaveBeenCalledWith(env, CONV_ID, 'org-1', null);
    });

    it('returns 404 (org-scoping non-leak) when the service reports not found', async () => {
      mockAssignConversation.mockResolvedValue(false);
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/assign`, env, {
        method: 'POST',
        body: { assigned_to: null },
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when assigned_to is not a UUID', async () => {
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/assign`, env, {
        method: 'POST',
        body: { assigned_to: 'not-a-uuid' },
      });
      expect(res.status).toBe(400);
      expect(mockAssignConversation).not.toHaveBeenCalled();
    });
  });

  // ── POST /conversations/:id/status ────────────────────────────────────────
  describe('POST /api/inbox/conversations/:id/status', () => {
    beforeEach(() => mockIsFlagOn.mockResolvedValue(true));

    it('updates the status and echoes it', async () => {
      mockUpdateConversationStatus.mockResolvedValue(true);
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/status`, env, {
        method: 'POST',
        body: { status: 'resolved' },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; status: string };
      expect(json.ok).toBe(true);
      expect(json.status).toBe('resolved');
      expect(mockUpdateConversationStatus).toHaveBeenCalledWith(env, CONV_ID, 'org-1', 'resolved');
    });

    it('returns 404 (org-scoping non-leak) when the service reports not found', async () => {
      mockUpdateConversationStatus.mockResolvedValue(false);
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/status`, env, {
        method: 'POST',
        body: { status: 'spam' },
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 for an out-of-enum status', async () => {
      const env = makeEnv(makeDb([]));
      const res = await req(makeApp(AUTH), `/api/inbox/conversations/${CONV_ID}/status`, env, {
        method: 'POST',
        body: { status: 'archived' },
      });
      expect(res.status).toBe(400);
      expect(mockUpdateConversationStatus).not.toHaveBeenCalled();
    });
  });

  // ── POST /conversations/:id/draft-with-ai ─────────────────────────────────
  describe('POST /api/inbox/conversations/:id/draft-with-ai', () => {
    beforeEach(() => mockIsFlagOn.mockResolvedValue(true));

    it('returns the AI-generated draft when the conversation exists', async () => {
      const env = makeEnv(makeDb([{ id: CONV_ID }]));
      mockDraftReplyWithAI.mockResolvedValue('Thanks for reaching out — happy to help!');
      const res = await req(
        makeApp(AUTH),
        `/api/inbox/conversations/${CONV_ID}/draft-with-ai`,
        env,
        { method: 'POST' },
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { draft: string };
      expect(json.draft).toBe('Thanks for reaching out — happy to help!');
      expect(mockDraftReplyWithAI).toHaveBeenCalledWith(env, CONV_ID, 'org-1');
    });

    it('returns 404 (org-scoping non-leak) when the conversation is not in this org', async () => {
      const env = makeEnv(makeDb([null])); // existence check misses
      const res = await req(
        makeApp(AUTH),
        `/api/inbox/conversations/${CONV_ID}/draft-with-ai`,
        env,
        { method: 'POST' },
      );
      expect(res.status).toBe(404);
      expect(mockDraftReplyWithAI).not.toHaveBeenCalled();
    });
  });
});
