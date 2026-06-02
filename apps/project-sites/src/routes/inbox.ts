/**
 * @module routes/inbox
 * @description Unified Visitor Inbox API — feature-flag `unified_inbox`.
 *
 * All routes return 404 when the flag is off (never 403 — don't leak feature
 * existence per [[feature-flags]] § Server guard).
 *
 * Endpoints:
 *   GET  /api/inbox/conversations         — paginated list (status, channel, assigned_to)
 *   GET  /api/inbox/conversations/:id     — single conversation + messages
 *   POST /api/inbox/conversations/:id/reply         — send reply (channel-native dispatch)
 *   POST /api/inbox/conversations/:id/assign        — assign to agent
 *   POST /api/inbox/conversations/:id/status        — update status
 *   POST /api/inbox/conversations/:id/draft-with-ai — generate AI draft reply
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  listConversations,
  getMessages,
  appendMessage,
  assignConversation,
  updateConversationStatus,
  draftReplyWithAI,
  sendViaChannel,
  type ConversationWithVisitor,
} from '../services/inbox.js';

const inboxRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Flag guard — 404 when unified_inbox is off. */
async function guardFlag(env: Env, orgId?: string, siteId?: string): Promise<boolean> {
  return isFlagOn(env, 'unified_inbox', { orgId, siteId });
}

// ── GET /api/inbox/conversations ──────────────────────────────────────────────
inboxRoutes.get('/api/inbox/conversations', async (c) => {
  const orgId = c.get('orgId') ?? '';
  if (!(await guardFlag(c.env, orgId))) return c.json({ error: 'not_found' }, 404);

  const status = c.req.query('status') ?? 'open';
  const channel = c.req.query('channel');
  const assignedTo = c.req.query('assigned_to');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '25', 10), 100);
  const cursor = c.req.query('cursor');

  const { conversations, hasMore } = await listConversations(c.env, orgId, {
    status,
    channel: channel ?? undefined,
    assignedTo: assignedTo ?? undefined,
    limit,
    cursor: cursor ?? undefined,
  });

  return c.json({ conversations, hasMore, total: conversations.length });
});

// ── GET /api/inbox/conversations/:id ─────────────────────────────────────────
inboxRoutes.get('/api/inbox/conversations/:id', async (c) => {
  const orgId = c.get('orgId') ?? '';
  if (!(await guardFlag(c.env, orgId))) return c.json({ error: 'not_found' }, 404);

  const convId = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT c.*, v.id as v_id, v.email as v_email, v.phone as v_phone,
            v.display_name as v_display_name, v.visitor_id as v_visitor_id,
            v.anon_id as v_anon_id, v.channel_flags as v_channel_flags,
            v.first_seen_at as v_first_seen_at, v.last_seen_at as v_last_seen_at,
            v.metadata_json as v_metadata_json
       FROM conversations c
       LEFT JOIN visitor_identities v ON v.id = c.visitor_id AND v.deleted_at IS NULL
      WHERE c.id = ? AND c.org_id = ? AND c.deleted_at IS NULL`,
  )
    .bind(convId, orgId)
    .first<Record<string, unknown>>()
    .catch(() => null);

  if (!row) return c.json({ error: 'not_found' }, 404);

  const messages = await getMessages(c.env, convId);

  return c.json({ conversation: row, messages });
});

// ── POST /api/inbox/conversations/:id/reply ───────────────────────────────────

const ReplyBodySchema = z.object({
  body: z.string().min(1, 'body is required').max(10000),
});

inboxRoutes.post('/api/inbox/conversations/:id/reply', zValidator('json', ReplyBodySchema), async (c) => {
  const orgId = c.get('orgId') ?? '';
  if (!(await guardFlag(c.env, orgId))) return c.json({ error: 'not_found' }, 404);

  const convId = c.req.param('id');
  const userId = c.get('userId');

  const body = c.req.valid('json');

  // Verify the conversation belongs to this org
  const conv = await c.env.DB.prepare(
    `SELECT * FROM conversations WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  )
    .bind(convId, orgId)
    .first<ConversationWithVisitor>()
    .catch(() => null);
  if (!conv) return c.json({ error: 'not_found' }, 404);

  // Load visitor for channel dispatch
  const visitor = await c.env.DB.prepare(
    `SELECT * FROM visitor_identities WHERE id = ? LIMIT 1`,
  )
    .bind(conv.visitor_id)
    .first()
    .catch(() => null) as ConversationWithVisitor['visitor'];

  // Append message
  const message = await appendMessage(c.env, {
    conversationId: convId,
    direction: 'outbound',
    authorType: 'agent',
    authorId: userId ?? null,
    body: body.body.trim(),
    channel: conv.channel,
  });

  // Dispatch via channel-native method
  const sendResult = await sendViaChannel(c.env, conv, visitor, body.body.trim());

  return c.json({ message, sent: sendResult.sent, send_reason: sendResult.reason ?? null });
});

// ── POST /api/inbox/conversations/:id/assign ──────────────────────────────────

const AssignBodySchema = z.object({
  assigned_to: z.string().uuid().nullable(),
});

inboxRoutes.post('/api/inbox/conversations/:id/assign', zValidator('json', AssignBodySchema), async (c) => {
  const orgId = c.get('orgId') ?? '';
  if (!(await guardFlag(c.env, orgId))) return c.json({ error: 'not_found' }, 404);

  const convId = c.req.param('id');
  const body = c.req.valid('json');
  const ok = await assignConversation(c.env, convId, orgId, body.assigned_to);
  if (!ok) return c.json({ error: 'not_found' }, 404);

  return c.json({ ok: true, assigned_to: body.assigned_to });
});

// ── POST /api/inbox/conversations/:id/status ──────────────────────────────────

const ConversationStatusBodySchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'spam']),
});

inboxRoutes.post('/api/inbox/conversations/:id/status', zValidator('json', ConversationStatusBodySchema), async (c) => {
  const orgId = c.get('orgId') ?? '';
  if (!(await guardFlag(c.env, orgId))) return c.json({ error: 'not_found' }, 404);

  const convId = c.req.param('id');
  const body = c.req.valid('json');

  const ok = await updateConversationStatus(c.env, convId, orgId, body.status);
  if (!ok) return c.json({ error: 'not_found' }, 404);

  return c.json({ ok: true, status: body.status });
});

// ── POST /api/inbox/conversations/:id/draft-with-ai ───────────────────────────
inboxRoutes.post('/api/inbox/conversations/:id/draft-with-ai', async (c) => {
  const orgId = c.get('orgId') ?? '';
  if (!(await guardFlag(c.env, orgId))) return c.json({ error: 'not_found' }, 404);

  const convId = c.req.param('id');

  // Verify conversation belongs to org
  const exists = await c.env.DB.prepare(
    `SELECT id FROM conversations WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  )
    .bind(convId, orgId)
    .first<{ id: string }>()
    .catch(() => null);
  if (!exists) return c.json({ error: 'not_found' }, 404);

  const draft = await draftReplyWithAI(c.env, convId, orgId);
  return c.json({ draft });
});

export { inboxRoutes as inbox };
