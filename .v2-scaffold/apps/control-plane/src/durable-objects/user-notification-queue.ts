/**
 * UserNotificationQueue — per-user push queue. Stores pending notifications in SQLite
 * until the client connects via WS and drains them.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.js';

interface Notification {
  id: string;
  ts: number;
  kind: string;
  body: string;
  link?: string;
  meta?: Record<string, unknown>;
}

export class UserNotificationQueue extends DurableObject<Env> {
  private sockets = new Set<WebSocket>();

  override async fetch(req: Request): Promise<Response> {
    await this.ensureSchema();
    const url = new URL(req.url);

    if (url.pathname === '/append' && req.method === 'POST') {
      const raw = (await req.json()) as Partial<Notification>;
      const n: Notification = {
        id: raw.id ?? crypto.randomUUID(),
        ts: raw.ts ?? Date.now(),
        kind: raw.kind ?? 'system',
        body: raw.body ?? '',
        link: raw.link,
        meta: raw.meta,
      };
      this.ctx.storage.sql.exec(
        `INSERT INTO notifications (id, ts, kind, body, link, meta, read_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        n.id,
        n.ts,
        n.kind,
        n.body,
        n.link ?? null,
        n.meta ? JSON.stringify(n.meta) : null,
      );
      const frame = JSON.stringify(n);
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
      const pending = this.ctx.storage.sql
        .exec(
          `SELECT id, ts, kind, body, link, meta FROM notifications
           WHERE read_at IS NULL ORDER BY ts DESC LIMIT 50`,
        )
        .toArray()
        .reverse();
      for (const r of pending) server.send(JSON.stringify(r));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/ack' && req.method === 'POST') {
      const { ids } = (await req.json()) as { ids: string[] };
      const now = Date.now();
      for (const id of ids) {
        this.ctx.storage.sql.exec(
          `UPDATE notifications SET read_at = ? WHERE id = ?`,
          now,
          id,
        );
      }
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/list') {
      const rows = this.ctx.storage.sql
        .exec(`SELECT id, ts, kind, body, link, meta, read_at FROM notifications ORDER BY ts DESC LIMIT 100`)
        .toArray();
      return Response.json(rows);
    }

    return new Response('not found', { status: 404 });
  }

  private async ensureSchema(): Promise<void> {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        link TEXT,
        meta TEXT,
        read_at INTEGER
      )`,
    );
  }
}
