/**
 * SiteLogStream — WS fan-out per `{tenantId}:{siteId}`. SQLite ring buffer 1000 lines.
 * Idle-hibernates after 30 min via `state.setAlarm`.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.js';

interface LogLine {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  msg: string;
  meta?: Record<string, unknown>;
}

const IDLE_MS = 30 * 60 * 1000;

export class SiteLogStream extends DurableObject<Env> {
  private sockets = new Set<WebSocket>();
  private lastActivity = Date.now();

  override async fetch(req: Request): Promise<Response> {
    this.lastActivity = Date.now();
    this.scheduleIdleAlarm();
    const url = new URL(req.url);

    await this.ensureSchema();

    if (url.pathname === '/append' && req.method === 'POST') {
      const line = (await req.json()) as LogLine;
      this.ctx.storage.sql.exec(
        `INSERT INTO log_lines (ts, level, msg, meta) VALUES (?, ?, ?, ?)`,
        line.ts,
        line.level,
        line.msg,
        line.meta ? JSON.stringify(line.meta) : null,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM log_lines WHERE id NOT IN (SELECT id FROM log_lines ORDER BY id DESC LIMIT 1000)`,
      );
      const frame = JSON.stringify(line);
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
      const client = pair[0];
      const server = pair[1];
      server.accept();
      this.sockets.add(server);
      server.addEventListener('close', () => this.sockets.delete(server));
      server.addEventListener('error', () => this.sockets.delete(server));

      // Backfill last 100 lines.
      const recent = this.ctx.storage.sql
        .exec(`SELECT ts, level, msg, meta FROM log_lines ORDER BY id DESC LIMIT 100`)
        .toArray()
        .reverse();
      for (const r of recent) server.send(JSON.stringify(r));

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/history') {
      const rows = this.ctx.storage.sql
        .exec(`SELECT ts, level, msg, meta FROM log_lines ORDER BY id DESC LIMIT 1000`)
        .toArray();
      return Response.json(rows);
    }

    return new Response('not found', { status: 404 });
  }

  override async alarm(): Promise<void> {
    // If still idle, close sockets to allow hibernation.
    if (Date.now() - this.lastActivity >= IDLE_MS) {
      for (const ws of this.sockets) {
        try {
          ws.close(1000, 'idle');
        } catch {
          /* ignore */
        }
      }
      this.sockets.clear();
    } else {
      this.scheduleIdleAlarm();
    }
  }

  private scheduleIdleAlarm(): void {
    this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  private async ensureSchema(): Promise<void> {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS log_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL,
        msg TEXT NOT NULL,
        meta TEXT
      )`,
    );
  }
}
