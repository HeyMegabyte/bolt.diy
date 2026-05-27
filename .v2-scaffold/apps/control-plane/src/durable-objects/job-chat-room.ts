/**
 * JobChatRoom — per `{tenantId}:{bookingId}`. Tenant ↔ end-customer chat about a job.
 * SQLite messages table, last 1000 retained for replay. WS fan-out.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.js';

interface ChatMessage {
  id: string;
  ts: number;
  from_user_id: string;
  from_role: 'tenant' | 'customer' | 'crew' | 'system';
  body: string;
  attachments?: { url: string; kind: string }[];
}

export class JobChatRoom extends DurableObject<Env> {
  private sockets = new Set<WebSocket>();

  override async fetch(req: Request): Promise<Response> {
    await this.ensureSchema();
    const url = new URL(req.url);

    if (url.pathname === '/post' && req.method === 'POST') {
      const msg = (await req.json()) as ChatMessage;
      this.ctx.storage.sql.exec(
        `INSERT INTO messages (id, ts, from_user_id, from_role, body, attachments)
         VALUES (?, ?, ?, ?, ?, ?)`,
        msg.id,
        msg.ts,
        msg.from_user_id,
        msg.from_role,
        msg.body,
        msg.attachments ? JSON.stringify(msg.attachments) : null,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY ts DESC LIMIT 1000)`,
      );
      const frame = JSON.stringify(msg);
      for (const ws of this.sockets) {
        try {
          ws.send(frame);
        } catch {
          this.sockets.delete(ws);
        }
      }
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/stream') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();
      this.sockets.add(server);
      server.addEventListener('close', () => this.sockets.delete(server));
      // Replay last 50 messages.
      const recent = this.ctx.storage.sql
        .exec(`SELECT * FROM messages ORDER BY ts DESC LIMIT 50`)
        .toArray()
        .reverse();
      for (const r of recent) server.send(JSON.stringify(r));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/history') {
      const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
      const rows = this.ctx.storage.sql
        .exec(`SELECT * FROM messages ORDER BY ts DESC LIMIT ?`, limit)
        .toArray();
      return Response.json(rows);
    }

    return new Response('not found', { status: 404 });
  }

  private async ensureSchema(): Promise<void> {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        from_user_id TEXT NOT NULL,
        from_role TEXT NOT NULL,
        body TEXT NOT NULL,
        attachments TEXT
      )`,
    );
    this.ctx.storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts DESC)`,
    );
  }
}
