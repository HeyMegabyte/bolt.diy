/**
 * @module routes/editor_chats
 *
 * @description
 * Worker routes powering the native Angular editor chat surface
 * (`/admin/editor-native`). Owns the CRUD lifecycle for `editor_chats` +
 * `editor_chat_messages` and the server-side LLM streaming proxy so
 * provider API keys (OpenAI, Anthropic) never reach the browser.
 *
 * ## Routes
 *
 * | Method | Path                                       | Purpose                          |
 * | ------ | ------------------------------------------ | -------------------------------- |
 * | GET    | /api/editor-chats?site_id=X                | List chats for a site            |
 * | POST   | /api/editor-chats                          | Create a new chat                |
 * | GET    | /api/editor-chats/:chatId                  | Get chat + messages              |
 * | POST   | /api/editor-chats/:chatId/messages         | Append a message                 |
 * | DELETE | /api/editor-chats/:chatId                  | Soft-delete a chat               |
 * | POST   | /api/editor-chats/:chatId/stream           | SSE stream from LLM provider     |
 *
 * All routes require an authenticated session (`Bearer <token>`). Each
 * chat is scoped to (site, user) — a user cannot list, read, append, or
 * stream against a chat belonging to another user.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { unauthorized, notFound, badRequest, forbidden } from '@project-sites/shared';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbInsert, dbExecute } from '../services/db.js';
import { streamChatResponse, type LlmProvider } from '../services/editor_llm.js';
import { DASHBOARD_PERSONA_SYSTEM_PROMPT } from '../prompts/dashboard_persona.js';

const editorChats = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Generate a short opaque ID (16 hex chars, 64 bits of entropy). */
function makeId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const PROVIDERS = ['workers-ai', 'openai', 'anthropic', 'ollama'] as const;
const ROLES = ['user', 'assistant', 'system', 'tool'] as const;

const createChatBody = z.object({
  site_id: z.string().min(1).max(64),
  title: z.string().min(1).max(200).optional(),
  provider: z.enum(PROVIDERS).default('workers-ai'),
  model: z.string().min(1).max(120).optional(),
});

const appendMessageBody = z.object({
  role: z.enum(ROLES),
  content: z.string().min(1).max(64_000),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
});

const streamBody = z.object({
  // Messages window the client wants the model to see. Server appends
  // nothing — the client already persisted the user message via
  // POST /messages before kicking off the stream.
  messages: z
    .array(
      z.object({
        role: z.enum(ROLES),
        content: z.string().min(1).max(64_000),
      }),
    )
    .min(1)
    .max(200),
  provider: z.enum(PROVIDERS).optional(),
  model: z.string().min(1).max(120).optional(),
});

interface EditorChatRow {
  id: string;
  site_id: string;
  user_id: string;
  title: string;
  model: string;
  provider: string;
  created_at: string;
  updated_at: string;
}

interface EditorMessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  created_at: string;
}

/** Confirm the caller owns (or co-owns) the site the chat is bound to. */
async function ensureSiteAccess(env: Env, siteId: string, userId: string): Promise<void> {
  const row = await dbQueryOne<{ id: string }>(
    env.DB,
    `SELECT s.id FROM sites s
       LEFT JOIN memberships m ON m.org_id = s.org_id AND m.deleted_at IS NULL
       WHERE s.id = ?
         AND s.deleted_at IS NULL
         AND (s.created_by = ? OR m.user_id = ?)
       LIMIT 1`,
    [siteId, userId, userId],
  );
  if (!row) throw forbidden('Site not accessible');
}

/** Load a chat row by id + assert it belongs to the calling user. */
async function loadOwnedChat(
  env: Env,
  chatId: string,
  userId: string,
): Promise<EditorChatRow> {
  const chat = await dbQueryOne<EditorChatRow>(
    env.DB,
    `SELECT id, site_id, user_id, title, model, provider, created_at, updated_at
       FROM editor_chats
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1`,
    [chatId],
  );
  if (!chat) throw notFound('Chat not found');
  if (chat.user_id !== userId) throw forbidden('Chat not accessible');
  return chat;
}

// ─── GET /api/editor-chats?site_id=X ─────────────────────────────────

editorChats.get('/api/editor-chats', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw unauthorized();

  const siteId = c.req.query('site_id');
  if (!siteId) throw badRequest('site_id query param required');

  await ensureSiteAccess(c.env, siteId, userId);

  const { data } = await dbQuery<EditorChatRow>(
    c.env.DB,
    `SELECT id, site_id, user_id, title, model, provider, created_at, updated_at
       FROM editor_chats
       WHERE site_id = ? AND user_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT 200`,
    [siteId, userId],
  );

  return c.json({ chats: data });
});

// ─── POST /api/editor-chats ──────────────────────────────────────────

editorChats.post('/api/editor-chats', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw unauthorized();

  let body: z.infer<typeof createChatBody>;
  try {
    body = createChatBody.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('Invalid body', { issues: err.issues });
    throw badRequest('Invalid JSON');
  }

  await ensureSiteAccess(c.env, body.site_id, userId);

  const id = makeId();
  const defaultModel =
    body.model ??
    (body.provider === 'openai'
      ? 'gpt-4o-mini'
      : body.provider === 'anthropic'
        ? 'claude-sonnet-4-6'
        : body.provider === 'ollama'
          ? 'llama3.1'
          : '@cf/meta/llama-3.3-70b-instruct-fp8-fast');

  await dbInsert(c.env.DB, 'editor_chats', {
    id,
    site_id: body.site_id,
    user_id: userId,
    title: body.title ?? 'New conversation',
    model: defaultModel,
    provider: body.provider,
  });

  const chat = await loadOwnedChat(c.env, id, userId);
  return c.json({ chat }, 201);
});

// ─── GET /api/editor-chats/:chatId ───────────────────────────────────

editorChats.get('/api/editor-chats/:chatId', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw unauthorized();

  const chatId = c.req.param('chatId');
  if (!chatId) throw badRequest('chatId required');

  const chat = await loadOwnedChat(c.env, chatId, userId);

  const { data: messages } = await dbQuery<EditorMessageRow>(
    c.env.DB,
    `SELECT id, chat_id, role, content, tokens_in, tokens_out, cost_usd, created_at
       FROM editor_chat_messages
       WHERE chat_id = ?
       ORDER BY created_at ASC
       LIMIT 2000`,
    [chatId],
  );

  return c.json({ chat, messages });
});

// ─── POST /api/editor-chats/:chatId/messages ─────────────────────────

editorChats.post('/api/editor-chats/:chatId/messages', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw unauthorized();

  const chatId = c.req.param('chatId');
  if (!chatId) throw badRequest('chatId required');

  const chat = await loadOwnedChat(c.env, chatId, userId);

  let body: z.infer<typeof appendMessageBody>;
  try {
    body = appendMessageBody.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('Invalid body', { issues: err.issues });
    throw badRequest('Invalid JSON');
  }

  const id = makeId();
  await dbInsert(c.env.DB, 'editor_chat_messages', {
    id,
    chat_id: chat.id,
    role: body.role,
    content: body.content,
    tokens_in: body.tokens_in ?? null,
    tokens_out: body.tokens_out ?? null,
    cost_usd: body.cost_usd ?? null,
  });

  // Bump the parent chat's updated_at so the sidebar resorts.
  await dbExecute(
    c.env.DB,
    `UPDATE editor_chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [chat.id],
  );

  // If this is the first user message and the chat still has the
  // default title, derive a snappy title from the first 60 chars.
  if (body.role === 'user' && chat.title === 'New conversation') {
    const derived = body.content.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (derived) {
      await dbExecute(c.env.DB, `UPDATE editor_chats SET title = ? WHERE id = ?`, [
        derived,
        chat.id,
      ]);
    }
  }

  const message = await dbQueryOne<EditorMessageRow>(
    c.env.DB,
    `SELECT id, chat_id, role, content, tokens_in, tokens_out, cost_usd, created_at
       FROM editor_chat_messages WHERE id = ? LIMIT 1`,
    [id],
  );
  return c.json({ message }, 201);
});

// ─── DELETE /api/editor-chats/:chatId ────────────────────────────────

editorChats.delete('/api/editor-chats/:chatId', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw unauthorized();

  const chatId = c.req.param('chatId');
  if (!chatId) throw badRequest('chatId required');

  await loadOwnedChat(c.env, chatId, userId);

  await dbExecute(
    c.env.DB,
    `UPDATE editor_chats SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    [chatId],
  );

  return c.json({ ok: true });
});

// ─── POST /api/editor-chats/:chatId/stream ───────────────────────────
// Server-side LLM proxy. Returns an SSE stream of `{delta, tokens, done,
// error}` events. The browser never sees provider API keys.

editorChats.post('/api/editor-chats/:chatId/stream', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw unauthorized();

  const chatId = c.req.param('chatId');
  if (!chatId) throw badRequest('chatId required');

  const chat = await loadOwnedChat(c.env, chatId, userId);

  let body: z.infer<typeof streamBody>;
  try {
    body = streamBody.parse(await c.req.json());
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest('Invalid body', { issues: err.issues });
    throw badRequest('Invalid JSON');
  }

  const provider = (body.provider ?? chat.provider) as LlmProvider;
  const model = body.model ?? chat.model;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>): void => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream already closed by client disconnect — ignore.
        }
      };

      // Prepend the dashboard persona as a leading system message — single
      // source of truth at `src/prompts/dashboard_persona.ts`. If the client
      // already supplied a system message, the persona stacks above it so the
      // voice contract reads first; per-call instructions read second.
      const personaMessages = [
        { role: 'system' as const, content: DASHBOARD_PERSONA_SYSTEM_PROMPT },
        ...body.messages,
      ];

      try {
        await streamChatResponse(c.env, {
          provider,
          model,
          messages: personaMessages,
          onDelta: (delta) => send({ delta }),
          onTokens: (tokens) => send({ tokens }),
        });
        send({ done: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'stream_failed';
        send({ error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

export { editorChats };
