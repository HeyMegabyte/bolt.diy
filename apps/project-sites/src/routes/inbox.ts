/**
 * @module routes/inbox
 *
 * @description
 * Pulse Inbox — Chatwoot-equivalent multi-channel customer messaging.
 *
 * ## Routes
 *
 * ### CRUD (auth required)
 * | Method | Path                                                | Purpose                          |
 * | ------ | --------------------------------------------------- | -------------------------------- |
 * | GET    | /api/inbox/inboxes                                  | List org inboxes                 |
 * | POST   | /api/inbox/inboxes                                  | Create inbox (channel + config)  |
 * | GET    | /api/inbox/conversations                            | List conversations (filters)     |
 * | GET    | /api/inbox/conversations/:id                        | Single conversation + msgs       |
 * | POST   | /api/inbox/conversations/:id/messages               | Send outbound / internal note    |
 * | POST   | /api/inbox/conversations/:id/assign                 | Assign to user                   |
 * | POST   | /api/inbox/conversations/:id/status                 | Status + snooze                  |
 * | POST   | /api/inbox/conversations/:id/priority               | Priority tag                     |
 * | POST   | /api/inbox/conversations/:id/auto-reply             | AI-draft a reply                 |
 * | GET    | /api/inbox/canned-responses                         | List canned templates            |
 * | POST   | /api/inbox/canned-responses                         | Create canned                    |
 * | DELETE | /api/inbox/canned-responses/:id                     | Delete canned                    |
 *
 * ### Inbound webhooks (no auth — signature verified)
 * | POST   | /api/inbox/webhooks/email                           | CF Email Routing relay           |
 * | POST   | /api/inbox/webhooks/slack                           | Slack Events API                 |
 * | POST   | /api/inbox/webhooks/discord                         | Discord Interactions             |
 * | POST   | /api/inbox/webhooks/telegram                        | Telegram bot webhook             |
 * | POST   | /api/inbox/widget-messages                          | Embeddable widget (per-inbox HMAC) |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  badRequest,
  forbidden,
  notFound,
  unauthorized,
  internalError,
} from '@project-sites/shared';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbInsert, dbExecute, dbUpdate } from '../services/db.js';
import { encrypt, decrypt } from '../services/ai_crypto.js';
import {
  classifySentiment as aiClassifySentiment,
  classifyIntent as aiClassifyIntent,
  draftReply as aiDraftReply,
  extractCustomerData as aiExtractCustomerData,
  shouldAutoSend as aiShouldAutoSend,
} from '../services/inbox_ai.js';

const inbox = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Generate a short opaque ID (16 hex chars). */
function makeId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const CHANNELS = ['website', 'email', 'slack', 'discord', 'telegram', 'api'] as const;
const STATUSES = ['open', 'pending', 'resolved', 'snoozed'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
const DIRECTIONS = ['outbound', 'note'] as const;
const CONTENT_TYPES = ['text', 'markdown', 'html', 'image', 'file'] as const;

// ─────────────────────────────────────────────────────────────────
// Row types
// ─────────────────────────────────────────────────────────────────

interface InboxRow {
  id: string;
  org_id: string;
  site_id: string | null;
  name: string;
  channel: string;
  config_json: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ConversationRow {
  id: string;
  org_id: string;
  inbox_id: string;
  contact_id: string;
  assignee_user_id: string | null;
  status: string;
  snoozed_until: string | null;
  priority: string;
  sentiment: string | null;
  intent: string | null;
  subject: string | null;
  last_message_at: string;
  unread_count: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  csat_score: number | null;
  csat_feedback: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: string;
  sender_type: string;
  sender_id: string | null;
  content: string;
  content_type: string;
  attachments: string | null;
  external_id: string | null;
  ai_generated: number;
  ai_confidence: number | null;
  created_at: string;
}

interface ContactRow {
  id: string;
  org_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  external_ids: string | null;
  avatar_url: string | null;
  custom_attrs: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Load conversation + assert it belongs to caller's org. */
async function loadConv(env: Env, id: string, orgId: string): Promise<ConversationRow> {
  const row = await dbQueryOne<ConversationRow>(
    env.DB,
    `SELECT * FROM chat_conversations WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!row) throw notFound('Conversation not found');
  if (row.org_id !== orgId) throw forbidden('Conversation not accessible');
  return row;
}

/** Look up or create a contact by (org, channel-specific external id OR email). */
async function upsertContact(
  env: Env,
  orgId: string,
  opts: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    externalKey?: string; // e.g. "slack" | "discord" | "telegram"
    externalId?: string;
    avatarUrl?: string | null;
  },
): Promise<ContactRow> {
  // Lookup priority: external id → email → phone.
  let existing: ContactRow | null = null;
  if (opts.externalKey && opts.externalId) {
    const { data } = await dbQuery<ContactRow>(
      env.DB,
      `SELECT * FROM chat_contacts WHERE org_id = ? AND external_ids LIKE ? LIMIT 1`,
      [orgId, `%"${opts.externalKey}":"${opts.externalId}"%`],
    );
    existing = data[0] ?? null;
  }
  if (!existing && opts.email) {
    existing = await dbQueryOne<ContactRow>(
      env.DB,
      `SELECT * FROM chat_contacts WHERE org_id = ? AND email = ? LIMIT 1`,
      [orgId, opts.email],
    );
  }
  if (!existing && opts.phone) {
    existing = await dbQueryOne<ContactRow>(
      env.DB,
      `SELECT * FROM chat_contacts WHERE org_id = ? AND phone = ? LIMIT 1`,
      [orgId, opts.phone],
    );
  }

  if (existing) {
    await dbExecute(
      env.DB,
      `UPDATE chat_contacts SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [existing.id],
    );
    return existing;
  }

  const id = makeId();
  const externalIds =
    opts.externalKey && opts.externalId
      ? JSON.stringify({ [opts.externalKey]: opts.externalId })
      : null;
  await dbInsert(env.DB, 'chat_contacts', {
    id,
    org_id: orgId,
    name: opts.name ?? null,
    email: opts.email ?? null,
    phone: opts.phone ?? null,
    external_ids: externalIds,
    avatar_url: opts.avatarUrl ?? null,
  });
  const created = await dbQueryOne<ContactRow>(
    env.DB,
    `SELECT * FROM chat_contacts WHERE id = ?`,
    [id],
  );
  if (!created) throw internalError('Contact insert failed');
  return created;
}

/** Find or create the open conversation between a contact and an inbox. */
async function findOrCreateConv(
  env: Env,
  orgId: string,
  inboxId: string,
  contactId: string,
  subject?: string | null,
): Promise<ConversationRow> {
  const existing = await dbQueryOne<ConversationRow>(
    env.DB,
    `SELECT * FROM chat_conversations
     WHERE inbox_id = ? AND contact_id = ? AND status != 'resolved'
     ORDER BY last_message_at DESC LIMIT 1`,
    [inboxId, contactId],
  );
  if (existing) return existing;

  const id = makeId();
  await dbInsert(env.DB, 'chat_conversations', {
    id,
    org_id: orgId,
    inbox_id: inboxId,
    contact_id: contactId,
    status: 'open',
    priority: 'normal',
    subject: subject ?? null,
    last_message_at: new Date().toISOString(),
    unread_count: 0,
  });
  const conv = await dbQueryOne<ConversationRow>(
    env.DB,
    `SELECT * FROM chat_conversations WHERE id = ?`,
    [id],
  );
  if (!conv) throw internalError('Conversation insert failed');
  return conv;
}

/** Push a message into the ConversationHub DO for fan-out. */
async function broadcastToHub(
  env: Env,
  conversationId: string,
  payload: { type: string; data: unknown },
): Promise<void> {
  const hub = env.CONVERSATION_HUB;
  if (!hub) return;
  try {
    const id = hub.idFromName(conversationId);
    const stub = hub.get(id);
    await stub.fetch('http://hub/broadcast', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'inbox',
        message: 'hub broadcast failed',
        conversation_id: conversationId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Persist an inbound message + broadcast + fire classifier + maybe auto-reply. */
async function persistInboundAndDispatch(
  env: Env,
  ctx: ExecutionContext,
  args: {
    conv: ConversationRow;
    senderType: 'contact' | 'system' | 'bot';
    senderId?: string | null;
    content: string;
    contentType?: (typeof CONTENT_TYPES)[number];
    externalId?: string | null;
    attachments?: unknown;
  },
): Promise<MessageRow> {
  const id = makeId();
  await dbInsert(env.DB, 'chat_messages', {
    id,
    conversation_id: args.conv.id,
    direction: 'inbound',
    sender_type: args.senderType,
    sender_id: args.senderId ?? null,
    content: args.content,
    content_type: args.contentType ?? 'text',
    attachments: args.attachments ? JSON.stringify(args.attachments) : null,
    external_id: args.externalId ?? null,
    ai_generated: 0,
  });

  await dbExecute(
    env.DB,
    `UPDATE chat_conversations
       SET last_message_at = CURRENT_TIMESTAMP,
           unread_count = unread_count + 1,
           updated_at = CURRENT_TIMESTAMP,
           status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END
       WHERE id = ?`,
    [args.conv.id],
  );

  const message = (await dbQueryOne<MessageRow>(
    env.DB,
    `SELECT * FROM chat_messages WHERE id = ?`,
    [id],
  ))!;

  await broadcastToHub(env, args.conv.id, { type: 'message', data: message });

  // Fire-and-forget AI classifier + maybe auto-reply.
  ctx.waitUntil(classifyAndMaybeAutoReply(env, args.conv, message));

  return message;
}

/**
 * Sentiment + intent + customer-data extraction for every inbound message.
 * Delegates to the shared `services/inbox_ai` module so the AI logic stays
 * in one place. Auto-reply gate uses the shared `shouldAutoSend` helper.
 */
async function classifyAndMaybeAutoReply(
  env: Env,
  conv: ConversationRow,
  message: MessageRow,
): Promise<void> {
  // 1. Sentiment + intent in parallel.
  let sentiment: 'positive' | 'neutral' | 'negative' | null = null;
  let intent: string | null = null;
  try {
    const [s, i] = await Promise.all([
      aiClassifySentiment(env, { content: message.content }),
      aiClassifyIntent(env, { content: message.content }),
    ]);
    sentiment = s;
    intent = i;
    await dbExecute(
      env.DB,
      `UPDATE chat_conversations SET sentiment = COALESCE(?, sentiment), intent = COALESCE(?, intent) WHERE id = ?`,
      [sentiment, intent, conv.id],
    );
    await broadcastToHub(env, conv.id, { type: 'status', data: { sentiment, intent } });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'inbox',
        message: 'classifier failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // 2. Customer-data extraction — auto-fill chat_contacts.custom_attrs.
  try {
    const extracted = await aiExtractCustomerData(env, { content: message.content });
    if (extracted.email || extracted.phone || extracted.company) {
      const contact = await dbQueryOne<{
        id: string;
        email: string | null;
        phone: string | null;
        custom_attrs: string | null;
      }>(env.DB, `SELECT id, email, phone, custom_attrs FROM chat_contacts WHERE id = ?`, [
        conv.contact_id,
      ]);
      if (contact) {
        const attrs = contact.custom_attrs ? JSON.parse(contact.custom_attrs) : {};
        if (extracted.company) attrs.company = extracted.company;
        attrs.last_intent = extracted.intent;
        const updates: Record<string, unknown> = {
          custom_attrs: JSON.stringify(attrs),
          last_seen_at: new Date().toISOString(),
        };
        if (extracted.email && !contact.email) updates.email = extracted.email;
        if (extracted.phone && !contact.phone) updates.phone = extracted.phone;
        await dbUpdate(env.DB, 'chat_contacts', updates, 'id = ?', [contact.id]);
      }
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'inbox',
        message: 'extract_customer_data failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // 3. Auto-reply (opt-in per inbox config).
  try {
    const inboxRow = await dbQueryOne<InboxRow>(
      env.DB,
      `SELECT * FROM chat_inboxes WHERE id = ?`,
      [conv.inbox_id],
    );
    const cfg = inboxRow?.config_json ? JSON.parse(inboxRow.config_json) : {};
    if (!cfg?.auto_reply?.enabled) return;
    await draftAutoReply(env, conv, cfg);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'inbox',
        message: 'auto-reply hook failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Draft 3 AI replies via the shared service, pick the most-confident one,
 * and either send it (if config.auto_reply.auto_send + confidence >=
 * threshold) or persist as an internal note for human approval.
 */
async function draftAutoReply(
  env: Env,
  conv: ConversationRow,
  cfg: { auto_reply?: { enabled?: boolean; auto_send?: boolean; confidence_threshold?: number } },
): Promise<void> {
  const { data: history } = await dbQuery<MessageRow>(
    env.DB,
    `SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 12`,
    [conv.id],
  );
  const ordered = [...history].reverse().map((m) => ({
    role: (m.sender_type === 'contact' ? 'contact' : 'agent') as 'contact' | 'agent',
    content: m.content,
  }));

  const { drafts } = await aiDraftReply(env, {
    conversation_id: conv.id,
    context_messages: ordered,
  });

  // Pick the highest-confidence draft (concise/warm/formal tones).
  const best = [...drafts].sort((a, b) => b.confidence - a.confidence)[0];
  if (!best || !best.content) return;

  const willSend = aiShouldAutoSend(cfg, best);
  const id = makeId();
  await dbInsert(env.DB, 'chat_messages', {
    id,
    conversation_id: conv.id,
    direction: willSend ? 'outbound' : 'note',
    sender_type: 'bot',
    sender_id: null,
    content: best.content,
    content_type: 'text',
    ai_generated: 1,
    ai_confidence: best.confidence,
  });
  if (willSend) {
    await dbExecute(
      env.DB,
      `UPDATE chat_conversations SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [conv.id],
    );
  }
  const msg = await dbQueryOne<MessageRow>(env.DB, `SELECT * FROM chat_messages WHERE id = ?`, [
    id,
  ]);
  if (msg) await broadcastToHub(env, conv.id, { type: 'message', data: msg });
}

/** AES-GCM encrypt a channel token using `ai_crypto.ts`. */
async function encryptToken(env: Env, plaintext: string): Promise<string | null> {
  try {
    return await encrypt(env, plaintext);
  } catch {
    return null;
  }
}

/** Decrypt a channel token (returns null on missing key). */
async function decryptToken(env: Env, blob: string): Promise<string | null> {
  try {
    return await decrypt(env, blob);
  } catch {
    return null;
  }
}

/** Look up the inbox for an inbound channel webhook (signature-validated). */
async function findInboxForChannel(
  env: Env,
  channel: (typeof CHANNELS)[number],
  matcher: (cfg: Record<string, unknown>) => boolean,
): Promise<InboxRow | null> {
  const { data } = await dbQuery<InboxRow>(
    env.DB,
    `SELECT * FROM chat_inboxes WHERE channel = ? AND deleted_at IS NULL`,
    [channel],
  );
  for (const row of data) {
    try {
      const cfg = row.config_json ? (JSON.parse(row.config_json) as Record<string, unknown>) : {};
      if (matcher(cfg)) return row;
    } catch {
      continue;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────

const createInboxBody = z.object({
  name: z.string().min(1).max(200),
  channel: z.enum(CHANNELS),
  site_id: z.string().min(1).max(64).optional(),
  config: z
    .object({
      // Channel-specific keys — encrypted before persist.
      slack_workspace_id: z.string().optional(),
      slack_bot_token: z.string().optional(),
      slack_signing_secret: z.string().optional(),
      discord_guild_id: z.string().optional(),
      discord_bot_token: z.string().optional(),
      discord_public_key: z.string().optional(),
      telegram_bot_token: z.string().optional(),
      telegram_chat_id: z.string().optional(),
      email_forwarding_address: z.string().email().optional(),
      widget_hmac_secret: z.string().optional(),
      auto_reply: z
        .object({
          enabled: z.boolean().optional(),
          auto_send: z.boolean().optional(),
        })
        .optional(),
    })
    .partial()
    .optional(),
});

const sendMessageBody = z.object({
  direction: z.enum(DIRECTIONS).default('outbound'),
  content: z.string().min(1).max(64_000),
  content_type: z.enum(CONTENT_TYPES).default('text'),
  attachments: z
    .array(
      z.object({
        r2_key: z.string(),
        mime: z.string(),
        name: z.string(),
        size: z.number().int().nonnegative(),
      }),
    )
    .max(20)
    .optional(),
});

const assignBody = z.object({ user_id: z.string().min(1).max(64).nullable() });
const statusBody = z.object({
  status: z.enum(STATUSES),
  snoozed_until: z.string().datetime().optional(),
});
const priorityBody = z.object({ priority: z.enum(PRIORITIES) });

const cannedCreateBody = z.object({
  short_code: z.string().min(1).max(64),
  content: z.string().min(1).max(8000),
});

// ─────────────────────────────────────────────────────────────────
// INBOX CRUD
// ─────────────────────────────────────────────────────────────────

inbox.get('/api/inbox/inboxes', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const { data } = await dbQuery<InboxRow>(
    c.env.DB,
    `SELECT id, org_id, site_id, name, channel, status, created_at, updated_at
       FROM chat_inboxes WHERE org_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    [orgId],
  );
  return c.json({ inboxes: data });
});

inbox.post('/api/inbox/inboxes', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  let body: z.infer<typeof createInboxBody>;
  try {
    body = createInboxBody.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('Invalid body', { issues: err.issues });
    throw badRequest('Invalid JSON');
  }

  // Encrypt secret-ish keys before persist.
  const cfg: Record<string, unknown> = { ...(body.config ?? {}) };
  for (const key of [
    'slack_bot_token',
    'slack_signing_secret',
    'discord_bot_token',
    'discord_public_key',
    'telegram_bot_token',
    'widget_hmac_secret',
  ]) {
    const v = cfg[key];
    if (typeof v === 'string' && v.length > 0) {
      const enc = await encryptToken(c.env, v);
      if (enc) cfg[key] = `enc:${enc}`;
    }
  }

  const id = makeId();
  await dbInsert(c.env.DB, 'chat_inboxes', {
    id,
    org_id: orgId,
    site_id: body.site_id ?? null,
    name: body.name,
    channel: body.channel,
    config_json: JSON.stringify(cfg),
    status: 'active',
  });
  const row = await dbQueryOne<InboxRow>(c.env.DB, `SELECT * FROM chat_inboxes WHERE id = ?`, [
    id,
  ]);
  return c.json({ inbox: row }, 201);
});

// ─────────────────────────────────────────────────────────────────
// CONVERSATIONS
// ─────────────────────────────────────────────────────────────────

inbox.get('/api/inbox/conversations', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId) throw unauthorized();

  const statusFilter = c.req.query('status');
  const assignee = c.req.query('assignee');
  const inboxId = c.req.query('inbox_id');
  const limit = Math.min(200, Number(c.req.query('limit') ?? '50') || 50);

  const where: string[] = ['org_id = ?'];
  const params: unknown[] = [orgId];

  if (statusFilter && (STATUSES as readonly string[]).includes(statusFilter)) {
    where.push('status = ?');
    params.push(statusFilter);
  }
  if (assignee === 'me') {
    if (!userId) throw unauthorized();
    where.push('assignee_user_id = ?');
    params.push(userId);
  } else if (assignee) {
    where.push('assignee_user_id = ?');
    params.push(assignee);
  }
  if (inboxId) {
    where.push('inbox_id = ?');
    params.push(inboxId);
  }

  const { data } = await dbQuery<ConversationRow>(
    c.env.DB,
    `SELECT * FROM chat_conversations WHERE ${where.join(' AND ')}
       ORDER BY last_message_at DESC LIMIT ?`,
    [...params, limit],
  );
  return c.json({ conversations: data });
});

inbox.get('/api/inbox/conversations/:id', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const id = c.req.param('id');
  const conv = await loadConv(c.env, id, orgId);

  const { data: messages } = await dbQuery<MessageRow>(
    c.env.DB,
    `SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 50`,
    [id],
  );
  const contact = await dbQueryOne<ContactRow>(
    c.env.DB,
    `SELECT * FROM chat_contacts WHERE id = ?`,
    [conv.contact_id],
  );
  return c.json({ conversation: conv, contact, messages: messages.reverse() });
});

inbox.post('/api/inbox/conversations/:id/messages', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) throw unauthorized();
  const id = c.req.param('id');
  const conv = await loadConv(c.env, id, orgId);

  let body: z.infer<typeof sendMessageBody>;
  try {
    body = sendMessageBody.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('Invalid body', { issues: err.issues });
    throw badRequest('Invalid JSON');
  }

  const msgId = makeId();
  await dbInsert(c.env.DB, 'chat_messages', {
    id: msgId,
    conversation_id: id,
    direction: body.direction,
    sender_type: 'agent',
    sender_id: userId,
    content: body.content,
    content_type: body.content_type,
    attachments: body.attachments ? JSON.stringify(body.attachments) : null,
    ai_generated: 0,
  });

  await dbExecute(
    c.env.DB,
    `UPDATE chat_conversations
       SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
           unread_count = 0
       WHERE id = ?`,
    [id],
  );

  const message = await dbQueryOne<MessageRow>(c.env.DB, `SELECT * FROM chat_messages WHERE id = ?`, [
    msgId,
  ]);
  await broadcastToHub(c.env, id, { type: 'message', data: message });

  // Channel fan-out happens in waitUntil to keep API latency low.
  if (body.direction === 'outbound') {
    c.executionCtx.waitUntil(dispatchOutboundToChannel(c.env, conv, body.content));
  }

  return c.json({ message }, 201);
});

inbox.post('/api/inbox/conversations/:id/assign', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const id = c.req.param('id');
  await loadConv(c.env, id, orgId);
  let body: z.infer<typeof assignBody>;
  try {
    body = assignBody.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('Invalid body', { issues: err.issues });
    throw badRequest('Invalid JSON');
  }
  await dbUpdate(c.env.DB, 'chat_conversations', { assignee_user_id: body.user_id }, 'id = ?', [
    id,
  ]);
  await broadcastToHub(c.env, id, { type: 'status', data: { assignee_user_id: body.user_id } });
  return c.json({ ok: true });
});

inbox.post('/api/inbox/conversations/:id/status', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const id = c.req.param('id');
  await loadConv(c.env, id, orgId);
  let body: z.infer<typeof statusBody>;
  try {
    body = statusBody.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('Invalid body', { issues: err.issues });
    throw badRequest('Invalid JSON');
  }
  const updates: Record<string, unknown> = { status: body.status };
  if (body.status === 'snoozed') {
    if (!body.snoozed_until) throw badRequest('snoozed_until required when status=snoozed');
    updates.snoozed_until = body.snoozed_until;
  } else {
    updates.snoozed_until = null;
  }
  if (body.status === 'resolved') updates.resolved_at = new Date().toISOString();
  await dbUpdate(c.env.DB, 'chat_conversations', updates, 'id = ?', [id]);
  await broadcastToHub(c.env, id, { type: 'status', data: updates });
  return c.json({ ok: true });
});

inbox.post('/api/inbox/conversations/:id/priority', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const id = c.req.param('id');
  await loadConv(c.env, id, orgId);
  let body: z.infer<typeof priorityBody>;
  try {
    body = priorityBody.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('Invalid body', { issues: err.issues });
    throw badRequest('Invalid JSON');
  }
  await dbUpdate(c.env.DB, 'chat_conversations', { priority: body.priority }, 'id = ?', [id]);
  await broadcastToHub(c.env, id, { type: 'status', data: { priority: body.priority } });
  return c.json({ ok: true });
});

inbox.post('/api/inbox/conversations/:id/auto-reply', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const id = c.req.param('id');
  const conv = await loadConv(c.env, id, orgId);
  // Force `auto_send: false` so this manual endpoint never sends without an
  // agent reviewing the draft — it always lands as an internal note.
  c.executionCtx.waitUntil(
    draftAutoReply(c.env, conv, {
      auto_reply: { enabled: true, auto_send: false, confidence_threshold: 1.01 },
    }),
  );
  return c.json({ ok: true, queued: true });
});

// ─────────────────────────────────────────────────────────────────
// CANNED RESPONSES
// ─────────────────────────────────────────────────────────────────

inbox.get('/api/inbox/canned-responses', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, short_code, content, created_by, created_at
       FROM chat_canned_responses WHERE org_id = ? ORDER BY short_code ASC`,
    [orgId],
  );
  return c.json({ canned: data });
});

inbox.post('/api/inbox/canned-responses', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) throw unauthorized();
  let body: z.infer<typeof cannedCreateBody>;
  try {
    body = cannedCreateBody.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('Invalid body', { issues: err.issues });
    throw badRequest('Invalid JSON');
  }
  const id = makeId();
  const { error } = await dbInsert(c.env.DB, 'chat_canned_responses', {
    id,
    org_id: orgId,
    short_code: body.short_code,
    content: body.content,
    created_by: userId,
  });
  if (error) throw badRequest(error);
  return c.json({ id }, 201);
});

inbox.delete('/api/inbox/canned-responses/:id', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const id = c.req.param('id');
  await dbExecute(c.env.DB, `DELETE FROM chat_canned_responses WHERE id = ? AND org_id = ?`, [
    id,
    orgId,
  ]);
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────
// OUTBOUND CHANNEL DISPATCH
// ─────────────────────────────────────────────────────────────────

/** Fan out an outbound message to the source channel (email/slack/discord/telegram). */
async function dispatchOutboundToChannel(
  env: Env,
  conv: ConversationRow,
  content: string,
): Promise<void> {
  const inboxRow = await dbQueryOne<InboxRow>(
    env.DB,
    `SELECT * FROM chat_inboxes WHERE id = ?`,
    [conv.inbox_id],
  );
  if (!inboxRow) return;
  const cfg = inboxRow.config_json ? (JSON.parse(inboxRow.config_json) as Record<string, string>) : {};
  const contact = await dbQueryOne<ContactRow>(
    env.DB,
    `SELECT * FROM chat_contacts WHERE id = ?`,
    [conv.contact_id],
  );

  try {
    if (inboxRow.channel === 'email' && contact?.email && env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: cfg.email_from ?? 'noreply@projectsites.dev',
          to: contact.email,
          subject: conv.subject ?? 'Re: your conversation',
          text: content,
        }),
      });
      return;
    }

    if (inboxRow.channel === 'slack') {
      const enc = cfg.slack_bot_token;
      const token =
        enc && enc.startsWith('enc:') ? await decryptToken(env, enc.slice(4)) : (enc ?? null);
      const channel = contact?.external_ids
        ? (JSON.parse(contact.external_ids) as Record<string, string>).slack_channel
        : null;
      if (token && channel) {
        await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({ channel, text: content }),
        });
      }
      return;
    }

    if (inboxRow.channel === 'telegram') {
      const enc = cfg.telegram_bot_token;
      const token =
        enc && enc.startsWith('enc:') ? await decryptToken(env, enc.slice(4)) : (enc ?? null);
      const chatId = contact?.external_ids
        ? (JSON.parse(contact.external_ids) as Record<string, string>).telegram
        : null;
      if (token && chatId) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: content }),
        });
      }
      return;
    }

    if (inboxRow.channel === 'discord') {
      const enc = cfg.discord_bot_token;
      const token =
        enc && enc.startsWith('enc:') ? await decryptToken(env, enc.slice(4)) : (enc ?? null);
      const channelId = contact?.external_ids
        ? (JSON.parse(contact.external_ids) as Record<string, string>).discord_channel
        : null;
      if (token && channelId) {
        await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        });
      }
      return;
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'inbox',
        message: 'outbound dispatch failed',
        channel: inboxRow.channel,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// INBOUND WEBHOOKS
// ─────────────────────────────────────────────────────────────────

/** Convert hex string → Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Constant-time comparison. */
function timingSafeEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

/** HMAC-SHA256(hex). */
async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Email (CF Email Routing → POST here) ──────────────────────
const emailWebhookBody = z.object({
  to: z.string(),
  from: z.string(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  message_id: z.string().optional(),
  org_id: z.string().optional(),
  inbox_id: z.string().optional(),
});

inbox.post('/api/inbox/webhooks/email', async (c) => {
  let body: z.infer<typeof emailWebhookBody>;
  try {
    body = emailWebhookBody.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('Invalid body', { issues: err.issues });
    throw badRequest('Invalid JSON');
  }

  // Verify internal HMAC from Email Worker (X-Inbox-Sig: hex(hmac-sha256(secret, raw))).
  // The Email Worker shares INTERNAL_BUILD_SECRET (re-used as the shared secret).
  const sigHeader = c.req.header('x-inbox-sig');
  if (c.env.INTERNAL_BUILD_SECRET && sigHeader) {
    const expected = await hmacHex(c.env.INTERNAL_BUILD_SECRET, JSON.stringify(body));
    if (!timingSafeEq(hexToBytes(expected), hexToBytes(sigHeader))) {
      throw forbidden('bad signature');
    }
  }

  // Resolve inbox: by explicit body.inbox_id, else by matching forwarding address.
  let inboxRow: InboxRow | null = null;
  if (body.inbox_id) {
    inboxRow = await dbQueryOne<InboxRow>(
      c.env.DB,
      `SELECT * FROM chat_inboxes WHERE id = ? AND deleted_at IS NULL`,
      [body.inbox_id],
    );
  }
  if (!inboxRow) {
    inboxRow = await findInboxForChannel(c.env, 'email', (cfg) => cfg.email_forwarding_address === body.to);
  }
  if (!inboxRow) throw notFound('No inbox for email recipient');

  const contact = await upsertContact(c.env, inboxRow.org_id, {
    email: body.from,
    name: body.from.split('@')[0],
  });
  const conv = await findOrCreateConv(
    c.env,
    inboxRow.org_id,
    inboxRow.id,
    contact.id,
    body.subject,
  );
  await persistInboundAndDispatch(c.env, c.executionCtx, {
    conv,
    senderType: 'contact',
    senderId: contact.id,
    content: body.text ?? body.html ?? '(empty message)',
    contentType: body.html ? 'html' : 'text',
    externalId: body.message_id ?? null,
  });
  return c.json({ ok: true, conversation_id: conv.id });
});

// ── Slack Events API ───────────────────────────────────────────
inbox.post('/api/inbox/webhooks/slack', async (c) => {
  const raw = await c.req.text();
  const ts = c.req.header('x-slack-request-timestamp') ?? '';
  const sig = c.req.header('x-slack-signature') ?? '';

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw badRequest('Invalid JSON');
  }

  // URL verification handshake.
  if (payload.type === 'url_verification') {
    return c.json({ challenge: payload.challenge });
  }

  const teamId = (payload.team_id as string | undefined) ?? '';
  const inboxRow = await findInboxForChannel(c.env, 'slack', (cfg) => cfg.slack_workspace_id === teamId);
  if (!inboxRow) throw notFound('No inbox for Slack workspace');

  const cfg = inboxRow.config_json ? (JSON.parse(inboxRow.config_json) as Record<string, string>) : {};
  const encSecret = cfg.slack_signing_secret;
  const signingSecret =
    encSecret && encSecret.startsWith('enc:')
      ? await decryptToken(c.env, encSecret.slice(4))
      : (encSecret ?? null);
  if (signingSecret && ts && sig) {
    const base = `v0:${ts}:${raw}`;
    const expected = `v0=${await hmacHex(signingSecret, base)}`;
    if (expected !== sig) throw forbidden('bad signature');
  }

  const event = payload.event as
    | { type?: string; user?: string; text?: string; channel?: string; ts?: string; bot_id?: string }
    | undefined;
  if (!event || event.type !== 'message' || event.bot_id) return c.json({ ok: true });

  const contact = await upsertContact(c.env, inboxRow.org_id, {
    name: event.user,
    externalKey: 'slack',
    externalId: event.user ?? 'unknown',
  });
  // Stash slack_channel for outbound dispatch.
  if (event.channel) {
    const ext = contact.external_ids ? JSON.parse(contact.external_ids) : {};
    ext.slack_channel = event.channel;
    ext.slack = event.user;
    await dbExecute(
      c.env.DB,
      `UPDATE chat_contacts SET external_ids = ? WHERE id = ?`,
      [JSON.stringify(ext), contact.id],
    );
  }

  const conv = await findOrCreateConv(c.env, inboxRow.org_id, inboxRow.id, contact.id);
  await persistInboundAndDispatch(c.env, c.executionCtx, {
    conv,
    senderType: 'contact',
    senderId: contact.id,
    content: event.text ?? '',
    externalId: event.ts ?? null,
  });
  return c.json({ ok: true });
});

// ── Discord Interactions ───────────────────────────────────────
inbox.post('/api/inbox/webhooks/discord', async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header('x-signature-ed25519') ?? '';
  const ts = c.req.header('x-signature-timestamp') ?? '';
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw badRequest('Invalid JSON');
  }

  // PING handshake.
  if (payload.type === 1) return c.json({ type: 1 });

  const guildId = (payload.guild_id as string | undefined) ?? '';
  const inboxRow = await findInboxForChannel(
    c.env,
    'discord',
    (cfg) => cfg.discord_guild_id === guildId,
  );
  if (!inboxRow) throw notFound('No inbox for Discord guild');

  const cfg = inboxRow.config_json ? (JSON.parse(inboxRow.config_json) as Record<string, string>) : {};
  const encPub = cfg.discord_public_key;
  const publicKey =
    encPub && encPub.startsWith('enc:') ? await decryptToken(c.env, encPub.slice(4)) : (encPub ?? null);
  if (publicKey && sig && ts) {
    try {
      const verified = await verifyEd25519(publicKey, sig, ts + raw);
      if (!verified) throw forbidden('bad signature');
    } catch {
      throw forbidden('bad signature');
    }
  }

  const data = payload.data as { name?: string; options?: { value?: string }[] } | undefined;
  const member = payload.member as { user?: { id?: string; username?: string } } | undefined;
  const userText = data?.options?.[0]?.value ?? data?.name ?? '';
  const userId = member?.user?.id ?? 'unknown';
  const channelId = payload.channel_id as string | undefined;

  const contact = await upsertContact(c.env, inboxRow.org_id, {
    name: member?.user?.username ?? null,
    externalKey: 'discord',
    externalId: userId,
  });
  if (channelId) {
    const ext = contact.external_ids ? JSON.parse(contact.external_ids) : {};
    ext.discord_channel = channelId;
    ext.discord = userId;
    await dbExecute(
      c.env.DB,
      `UPDATE chat_contacts SET external_ids = ? WHERE id = ?`,
      [JSON.stringify(ext), contact.id],
    );
  }
  const conv = await findOrCreateConv(c.env, inboxRow.org_id, inboxRow.id, contact.id);
  await persistInboundAndDispatch(c.env, c.executionCtx, {
    conv,
    senderType: 'contact',
    senderId: contact.id,
    content: userText,
  });

  return c.json({ type: 4, data: { content: 'Received. An agent will reply shortly.' } });
});

/** Discord Ed25519 verification (hex sig + hex public key). */
async function verifyEd25519(publicKeyHex: string, sigHex: string, body: string): Promise<boolean> {
  const pubKey = await crypto.subtle.importKey(
    'raw',
    hexToBytes(publicKeyHex),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'Ed25519',
    pubKey,
    hexToBytes(sigHex),
    new TextEncoder().encode(body),
  );
}

// ── Telegram bot webhook ───────────────────────────────────────
inbox.post('/api/inbox/webhooks/telegram', async (c) => {
  let payload: Record<string, unknown>;
  try {
    payload = await c.req.json();
  } catch {
    throw badRequest('Invalid JSON');
  }
  // Per-inbox secret token via header (Telegram setWebhook secret_token).
  const tok = c.req.header('x-telegram-bot-api-secret-token') ?? '';
  const inboxRow = await findInboxForChannel(
    c.env,
    'telegram',
    (cfg) => cfg.telegram_webhook_secret === tok,
  );
  if (!inboxRow) throw notFound('No inbox for Telegram bot');

  const msg = payload.message as
    | { from?: { id?: number; username?: string }; chat?: { id?: number }; text?: string; message_id?: number }
    | undefined;
  if (!msg) return c.json({ ok: true });

  const senderExt = String(msg.from?.id ?? 'unknown');
  const contact = await upsertContact(c.env, inboxRow.org_id, {
    name: msg.from?.username ?? null,
    externalKey: 'telegram',
    externalId: senderExt,
  });
  if (msg.chat?.id) {
    const ext = contact.external_ids ? JSON.parse(contact.external_ids) : {};
    ext.telegram = String(msg.chat.id);
    await dbExecute(
      c.env.DB,
      `UPDATE chat_contacts SET external_ids = ? WHERE id = ?`,
      [JSON.stringify(ext), contact.id],
    );
  }
  const conv = await findOrCreateConv(c.env, inboxRow.org_id, inboxRow.id, contact.id);
  await persistInboundAndDispatch(c.env, c.executionCtx, {
    conv,
    senderType: 'contact',
    senderId: contact.id,
    content: msg.text ?? '',
    externalId: msg.message_id ? String(msg.message_id) : null,
  });
  return c.json({ ok: true });
});

// ── Website widget (HMAC-signed, no auth) ──────────────────────
const widgetMessageBody = z.object({
  inbox_id: z.string().min(1).max(64),
  signature: z.string().min(1),
  timestamp: z.number().int(),
  contact: z.object({
    name: z.string().max(200).optional(),
    email: z.string().email().optional(),
    external_id: z.string().max(120).optional(),
  }),
  content: z.string().min(1).max(8000),
});

inbox.post('/api/inbox/widget-messages', async (c) => {
  let body: z.infer<typeof widgetMessageBody>;
  try {
    body = widgetMessageBody.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('Invalid body', { issues: err.issues });
    throw badRequest('Invalid JSON');
  }

  // 5-minute replay window.
  if (Math.abs(Date.now() - body.timestamp) > 5 * 60 * 1000) {
    throw forbidden('timestamp out of range');
  }

  const inboxRow = await dbQueryOne<InboxRow>(
    c.env.DB,
    `SELECT * FROM chat_inboxes WHERE id = ? AND channel = 'website' AND deleted_at IS NULL`,
    [body.inbox_id],
  );
  if (!inboxRow) throw notFound('Inbox not found');
  const cfg = inboxRow.config_json ? (JSON.parse(inboxRow.config_json) as Record<string, string>) : {};
  const enc = cfg.widget_hmac_secret;
  const secret = enc && enc.startsWith('enc:') ? await decryptToken(c.env, enc.slice(4)) : (enc ?? null);
  if (!secret) throw forbidden('widget secret not configured');

  const basis = `${body.inbox_id}.${body.timestamp}.${body.content}`;
  const expected = await hmacHex(secret, basis);
  if (!timingSafeEq(hexToBytes(expected), hexToBytes(body.signature))) {
    throw forbidden('bad signature');
  }

  const contact = await upsertContact(c.env, inboxRow.org_id, {
    name: body.contact.name ?? null,
    email: body.contact.email ?? null,
    externalKey: 'widget',
    externalId: body.contact.external_id ?? body.contact.email ?? makeId(),
  });
  const conv = await findOrCreateConv(c.env, inboxRow.org_id, inboxRow.id, contact.id);
  const message = await persistInboundAndDispatch(c.env, c.executionCtx, {
    conv,
    senderType: 'contact',
    senderId: contact.id,
    content: body.content,
  });
  return c.json({ ok: true, conversation_id: conv.id, message_id: message.id });
});

// ─────────────────────────────────────────────────────────────────
// SNOOZE-RESUME CRON SWEEP (called from scheduled handler in index.ts)
// ─────────────────────────────────────────────────────────────────

/**
 * Re-open every snoozed conversation whose snoozed_until has elapsed.
 * Idempotent: a second call within the same minute is a no-op.
 */
export async function runSnoozeResumeSweep(
  env: Env,
): Promise<{ resumed: number }> {
  const { data } = await dbQuery<{ id: string }>(
    env.DB,
    `SELECT id FROM chat_conversations
       WHERE status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= datetime('now')`,
    [],
  );
  for (const row of data) {
    await dbExecute(
      env.DB,
      `UPDATE chat_conversations
         SET status = 'open', snoozed_until = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      [row.id],
    );
    await broadcastToHub(env, row.id, { type: 'status', data: { status: 'open' } });
  }
  return { resumed: data.length };
}

export { inbox };
