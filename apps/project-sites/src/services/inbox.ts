/**
 * @module inbox
 * @description Unified Visitor Inbox service — data-access layer for
 * `conversations` + `messages` D1 tables.
 *
 * Consumed by `src/routes/inbox.ts` for API endpoints. AI-draft replies
 * are generated via `external_llm.ts` and stored with `ai_drafted=1`.
 *
 * Channel-native send dispatch:
 *   form    → no outbound send (one-way submission channel)
 *   chat    → append message; client polls via existing AI chat endpoints
 *   voice   → Twilio REST (if TWILIO_ACCOUNT_SID set), else degrade gracefully
 *   sms     → Twilio SMS (if TWILIO_ACCOUNT_SID set), else degrade gracefully
 *   email   → Resend (if RESEND_API_KEY set), else degrade gracefully
 *
 * @example
 * ```ts
 * const page = await listConversations(env, orgId, { status: 'open', limit: 25 });
 * await replyToConversation(env, convId, orgId, { body: 'Hello!', authorId: userId });
 * ```
 */

import type { Env } from '../types/env.js';
import type { VisitorIdentityRow } from './visitor_identity.js';

export interface ConversationRow {
  id: string;
  org_id: string;
  site_id: string;
  visitor_id: string;
  channel: string;
  subject: string | null;
  status: string;
  assigned_to: string | null;
  sla_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  last_message_at: string;
  message_count: number;
  unread_count: number;
  tags_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  author_type: 'visitor' | 'agent' | 'ai' | 'system';
  author_id: string | null;
  body: string;
  channel: string;
  ai_drafted: number;
  sent_at: string;
  read_at: string | null;
  metadata_json: string;
}

export interface ConversationWithVisitor extends ConversationRow {
  visitor: VisitorIdentityRow | null;
}

// ── Listing ──────────────────────────────────────────────────────────────────

/**
 * Returns paginated conversations for an org, newest-first.
 *
 * @param env    Worker environment
 * @param orgId  Organisation scope
 * @param opts   Filter options (status, channel, assignedTo, limit, cursor)
 */
export async function listConversations(
  env: Env,
  orgId: string,
  opts: {
    status?: string;
    channel?: string;
    assignedTo?: string;
    limit?: number;
    cursor?: string; // ISO-8601 `last_message_at` for keyset pagination
  } = {},
): Promise<{ conversations: ConversationWithVisitor[]; hasMore: boolean }> {
  const { status = 'open', channel, assignedTo, limit = 25, cursor } = opts;
  const params: unknown[] = [orgId];
  let where = 'c.org_id = ?';

  if (status !== 'all') {
    where += ' AND c.status = ?';
    params.push(status);
  }
  if (channel) {
    where += ' AND c.channel = ?';
    params.push(channel);
  }
  if (assignedTo) {
    where += ' AND c.assigned_to = ?';
    params.push(assignedTo);
  }
  if (cursor) {
    where += ' AND c.last_message_at < ?';
    params.push(cursor);
  }

  params.push(limit + 1); // fetch one extra to detect hasMore

  const rows = await env.DB.prepare(
    `SELECT c.*,
            v.id as v_id, v.email as v_email, v.phone as v_phone,
            v.display_name as v_display_name, v.visitor_id as v_visitor_id,
            v.anon_id as v_anon_id, v.channel_flags as v_channel_flags,
            v.first_seen_at as v_first_seen_at, v.last_seen_at as v_last_seen_at,
            v.metadata_json as v_metadata_json
       FROM conversations c
       LEFT JOIN visitor_identities v ON v.id = c.visitor_id AND v.deleted_at IS NULL
      WHERE ${where} AND c.deleted_at IS NULL
      ORDER BY c.last_message_at DESC
      LIMIT ?`,
  )
    .bind(...params)
    .all<Record<string, unknown>>()
    .then((r) => r.results ?? [])
    .catch(() => [] as Record<string, unknown>[]);

  const hasMore = rows.length > limit;
  const slice = rows.slice(0, limit);

  return {
    conversations: slice.map(rowToConvWithVisitor),
    hasMore,
  };
}

function rowToConvWithVisitor(r: Record<string, unknown>): ConversationWithVisitor {
  const conv: ConversationRow = {
    id: r['id'] as string,
    org_id: r['org_id'] as string,
    site_id: r['site_id'] as string,
    visitor_id: r['visitor_id'] as string,
    channel: r['channel'] as string,
    subject: r['subject'] as string | null,
    status: r['status'] as string,
    assigned_to: r['assigned_to'] as string | null,
    sla_due_at: r['sla_due_at'] as string | null,
    first_response_at: r['first_response_at'] as string | null,
    resolved_at: r['resolved_at'] as string | null,
    last_message_at: r['last_message_at'] as string,
    message_count: r['message_count'] as number,
    unread_count: r['unread_count'] as number,
    tags_json: r['tags_json'] as string,
    metadata_json: r['metadata_json'] as string,
    created_at: r['created_at'] as string,
    updated_at: r['updated_at'] as string,
  };

  const visitor: VisitorIdentityRow | null = r['v_id']
    ? {
        id: r['v_id'] as string,
        org_id: r['org_id'] as string,
        site_id: r['site_id'] as string,
        email: r['v_email'] as string | null,
        phone: r['v_phone'] as string | null,
        visitor_id: r['v_visitor_id'] as string | null,
        anon_id: r['v_anon_id'] as string | null,
        display_name: r['v_display_name'] as string | null,
        first_seen_at: r['v_first_seen_at'] as string,
        last_seen_at: r['v_last_seen_at'] as string,
        channel_flags: r['v_channel_flags'] as string,
        metadata_json: r['v_metadata_json'] as string,
      }
    : null;

  return { ...conv, visitor };
}

// ── Messages ─────────────────────────────────────────────────────────────────

/**
 * Fetches all messages for a conversation, oldest-first.
 */
export async function getMessages(
  env: Env,
  conversationId: string,
): Promise<MessageRow[]> {
  return env.DB.prepare(
    `SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at ASC`,
  )
    .bind(conversationId)
    .all<MessageRow>()
    .then((r) => r.results ?? [])
    .catch(() => []);
}

/**
 * Appends a message to a conversation and updates conversation metadata.
 */
export async function appendMessage(
  env: Env,
  params: {
    conversationId: string;
    direction: 'inbound' | 'outbound';
    authorType: 'visitor' | 'agent' | 'ai' | 'system';
    authorId?: string | null;
    body: string;
    channel: string;
    aiDrafted?: boolean;
  },
): Promise<MessageRow> {
  const { conversationId, direction, authorType, authorId, body, channel, aiDrafted = false } = params;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO messages
         (id, conversation_id, direction, author_type, author_id, body, channel,
          ai_drafted, sent_at, metadata_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(id, conversationId, direction, authorType, authorId ?? null, body, channel,
           aiDrafted ? 1 : 0, now, '{}', now),

    env.DB.prepare(
      `UPDATE conversations
          SET last_message_at = ?,
              message_count    = message_count + 1,
              first_response_at = CASE
                WHEN first_response_at IS NULL AND ? = 'outbound' THEN ?
                ELSE first_response_at END,
              updated_at       = ?
        WHERE id = ?`,
    ).bind(now, direction, now, now, conversationId),
  ]);

  return {
    id,
    conversation_id: conversationId,
    direction,
    author_type: authorType,
    author_id: authorId ?? null,
    body,
    channel,
    ai_drafted: aiDrafted ? 1 : 0,
    sent_at: now,
    read_at: null,
    metadata_json: '{}',
  };
}

// ── Assignment + Status ───────────────────────────────────────────────────────

export async function assignConversation(
  env: Env,
  conversationId: string,
  orgId: string,
  assignedTo: string | null,
): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    `UPDATE conversations SET assigned_to = ?, updated_at = ?
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  )
    .bind(assignedTo, now, conversationId, orgId)
    .run()
    .catch(() => null);
  return (res?.meta?.changes ?? 0) > 0;
}

export async function updateConversationStatus(
  env: Env,
  conversationId: string,
  orgId: string,
  status: 'open' | 'pending' | 'resolved' | 'spam',
): Promise<boolean> {
  const now = new Date().toISOString();
  const resolvedAt = status === 'resolved' ? now : null;
  const res = await env.DB.prepare(
    `UPDATE conversations SET status = ?, resolved_at = ?, updated_at = ?
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  )
    .bind(status, resolvedAt, now, conversationId, orgId)
    .run()
    .catch(() => null);
  return (res?.meta?.changes ?? 0) > 0;
}

// ── AI Draft ─────────────────────────────────────────────────────────────────

/**
 * Generates a draft reply using the worker's AI binding (Workers AI Llama).
 * Falls back to a simple template when the AI binding is unavailable.
 *
 * @param env            Worker environment
 * @param conversationId Target conversation
 * @param orgId          Org scope (for guardrail)
 * @returns              Draft body string
 */
export async function draftReplyWithAI(
  env: Env,
  conversationId: string,
  orgId: string,
): Promise<string> {
  // Load last 10 messages for context
  const recent = await env.DB.prepare(
    `SELECT direction, author_type, body FROM messages
      WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 10`,
  )
    .bind(conversationId)
    .all<{ direction: string; author_type: string; body: string }>()
    .then((r) => r.results ?? [])
    .catch(() => []);

  const thread = recent
    .reverse()
    .map((m) => `${m.direction === 'inbound' ? 'Visitor' : 'Agent'}: ${m.body}`)
    .join('\n');

  const prompt = `You are a professional customer support agent for a small business.
Draft a helpful, concise reply to the visitor based on this conversation thread.
Be friendly, empathetic, and actionable. Respond in 2-4 sentences only.
Do not add placeholders — write a ready-to-send message.

Thread:
${thread}

Draft reply:`;

  try {
    const response = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<typeof env.AI.run>[0], {
      prompt,
      max_tokens: 200,
    })) as { response?: string };
    return (response?.response ?? '').trim() || 'Thank you for reaching out. We will get back to you shortly.';
  } catch {
    return 'Thank you for reaching out. We will get back to you shortly.';
  }
}

// ── Channel-native send ───────────────────────────────────────────────────────

/**
 * Sends `body` to the visitor via the conversation's channel.
 * Degrades gracefully when the required credential is absent.
 *
 * @returns { sent: boolean; reason?: string }
 */
export async function sendViaChannel(
  env: Env,
  conv: ConversationRow,
  visitor: VisitorIdentityRow | null,
  body: string,
): Promise<{ sent: boolean; reason?: string }> {
  if (conv.channel === 'form' || conv.channel === 'chat') {
    // form is one-way; chat is read via poll — message already appended
    return { sent: true };
  }

  if (conv.channel === 'email') {
    const email = visitor?.email;
    if (!email) return { sent: false, reason: 'no_email_on_visitor' };
    if (!env.RESEND_API_KEY) return { sent: false, reason: 'resend_not_configured' };
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'noreply@projectsites.dev', to: email, subject: 'Re: Your inquiry', html: `<p>${body}</p>` }),
    }).catch(() => null);
    return { sent: res?.ok ?? false, reason: res?.ok ? undefined : 'resend_error' };
  }

  if (conv.channel === 'sms' || conv.channel === 'voice') {
    const phone = visitor?.phone;
    if (!phone) return { sent: false, reason: 'no_phone_on_visitor' };
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      return { sent: false, reason: 'twilio_not_configured' };
    }
    const from = '+15005550006'; // Twilio magic test number; real number set via TWILIO_FROM_NUMBER
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: from, To: phone, Body: body }).toString(),
      },
    ).catch(() => null);
    return { sent: res?.ok ?? false, reason: res?.ok ? undefined : 'twilio_error' };
  }

  return { sent: false, reason: 'unknown_channel' };
}
