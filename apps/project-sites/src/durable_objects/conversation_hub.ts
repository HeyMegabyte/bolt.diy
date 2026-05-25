/**
 * @module durable_objects/conversation_hub
 * @description Pulse Inbox realtime fan-out — one `ConversationHub` DO per conversation.
 *
 * Each DO owns a single `chat_conversations.id`. Clients (agent dashboards +
 * embeddable visitor widgets) connect over WebSocket at
 * `wss://projectsites.dev/api/inbox/ws/:conversation_id`. Inbound REST writes
 * land in D1 first, then `fetch` into the DO's `/broadcast` endpoint to push
 * the message to every connected client.
 *
 * ## Storage
 * - **SQLite** holds presence + last-seen-by-user + typing-state so a
 *   reconnecting client can resume the read marker without a D1 round-trip.
 * - **Messages** are NOT duplicated here — D1 is the system of record. The
 *   DO only persists ephemeral session state.
 *
 * ## Hibernation
 * - Uses WebSocket Hibernation (`acceptWebSocket`) — the DO is evicted from
 *   memory when no clients are connected; CF wakes it on the next inbound
 *   message or socket connect.
 * - `sleepAfter` not strictly required with hibernation, but the DO
 *   self-evicts after the last socket closes anyway.
 *
 * ## Endpoints (DO-internal `fetch` paths)
 * - `GET  /connect`              → upgrade to WebSocket (101)
 * - `POST /broadcast`            → push `{type:'message', data}` to every socket
 * - `POST /mark-read`            → broadcast read-receipt + persist marker
 * - `POST /typing`               → broadcast typing indicator
 * - `GET  /presence`             → JSON `{ users: string[] }`
 *
 * @packageDocumentation
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types/env.js';

/** Inline schema — `CREATE IF NOT EXISTS` makes it cold-start safe. */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS presence (
  user_id     TEXT PRIMARY KEY,
  last_seen   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS read_markers (
  user_id     TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL,
  read_at     INTEGER NOT NULL
);
`;

interface SocketAttachment {
  conversation_id: string;
  user_id: string;
  role: 'agent' | 'contact';
  connected_at: number;
}

interface BroadcastPayload {
  type: 'message' | 'read' | 'typing' | 'status' | 'presence';
  data: unknown;
}

/**
 * Per-conversation realtime hub.
 *
 * @example
 * ```ts
 * const id = env.CONVERSATION_HUB.idFromName(conversationId);
 * const stub = env.CONVERSATION_HUB.get(id);
 * await stub.fetch('http://hub/broadcast', {
 *   method: 'POST',
 *   body: JSON.stringify({ type: 'message', data: row }),
 * });
 * ```
 */
export class ConversationHub extends DurableObject<Env> {
  private schemaReady = false;

  private get sql(): SqlStorage | null {
    const candidate = (this.ctx.storage as { sql?: SqlStorage }).sql;
    return candidate ?? null;
  }

  private ensureSchema(): void {
    if (this.schemaReady) return;
    this.sql?.exec(SCHEMA_SQL);
    this.schemaReady = true;
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const url = new URL(request.url);

    // ── WebSocket upgrade ──────────────────────────────────────
    if (url.pathname === '/connect') {
      if (request.headers.get('upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      const conversationId = url.searchParams.get('conversation_id') ?? '';
      const userId = url.searchParams.get('user_id') ?? '';
      const role = (url.searchParams.get('role') ?? 'agent') as 'agent' | 'contact';
      if (!conversationId || !userId) {
        return new Response('Missing conversation_id or user_id', { status: 400 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      const attachment: SocketAttachment = {
        conversation_id: conversationId,
        user_id: userId,
        role,
        connected_at: Date.now(),
      };

      // Hibernation-aware accept — CF can evict the DO between messages.
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(attachment);

      this.sql?.exec(
        `INSERT OR REPLACE INTO presence (user_id, last_seen) VALUES (?, ?)`,
        userId,
        Date.now(),
      );

      // Initial state push: presence snapshot for the joining client.
      try {
        server.send(
          JSON.stringify({
            type: 'presence',
            data: { users: this.listPresentUsers() },
          }),
        );
      } catch {
        // Best-effort.
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // ── Broadcast a new message to all sockets ────────────────
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const body = (await request.json()) as BroadcastPayload;
      this.broadcast(body);
      return Response.json({ ok: true, delivered: this.ctx.getWebSockets().length });
    }

    // ── Read marker ───────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/mark-read') {
      const body = (await request.json()) as { user_id: string; message_id: string };
      this.sql?.exec(
        `INSERT OR REPLACE INTO read_markers (user_id, message_id, read_at) VALUES (?, ?, ?)`,
        body.user_id,
        body.message_id,
        Date.now(),
      );
      this.broadcast({
        type: 'read',
        data: { user_id: body.user_id, message_id: body.message_id, read_at: Date.now() },
      });
      return Response.json({ ok: true });
    }

    // ── Typing indicator ──────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/typing') {
      const body = (await request.json()) as { user_id: string; typing: boolean };
      this.broadcast({
        type: 'typing',
        data: { user_id: body.user_id, typing: body.typing, at: Date.now() },
      });
      return Response.json({ ok: true });
    }

    // ── Presence snapshot ─────────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/presence') {
      return Response.json({ users: this.listPresentUsers() });
    }

    return new Response('not found', { status: 404 });
  }

  /** Hibernation-aware message handler — fires when a client sends data. */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    let parsed: BroadcastPayload | null = null;
    try {
      parsed = JSON.parse(text) as BroadcastPayload;
    } catch {
      return;
    }
    if (!parsed || typeof parsed.type !== 'string') return;

    // Clients only emit `typing` + `read` over the socket. New messages go
    // through the REST endpoint so they're persisted to D1 first.
    if (parsed.type === 'typing' || parsed.type === 'read') {
      this.broadcast(parsed, ws);
    }
  }

  /** Hibernation-aware close handler — drop presence + notify peers. */
  override async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    try {
      const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
      if (attachment?.user_id) {
        this.sql?.exec(`DELETE FROM presence WHERE user_id = ?`, attachment.user_id);
        this.broadcast({
          type: 'presence',
          data: { users: this.listPresentUsers() },
        });
      }
    } catch {
      // ignore
    }
  }

  /** Send to every live socket except `except` (when echoing client emits). */
  private broadcast(payload: BroadcastPayload, except?: WebSocket): void {
    const json = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(json);
      } catch {
        // Socket may have died between getWebSockets() and send().
      }
    }
  }

  /** Distinct user-ids currently connected. */
  private listPresentUsers(): string[] {
    const seen = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const att = ws.deserializeAttachment() as SocketAttachment | undefined;
        if (att?.user_id) seen.add(att.user_id);
      } catch {
        // ignore
      }
    }
    return [...seen];
  }
}
