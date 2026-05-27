/**
 * VoiceOrchestrator — single coordinator per active Twilio call. Tracks call legs,
 * recording state, AI agent transcript, and emits events back to NOTIFICATION_HUB.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.js';

interface CallState {
  call_sid: string;
  from: string;
  to: string;
  started_at: number;
  ended_at: number | null;
  status: 'ringing' | 'in-progress' | 'completed' | 'failed';
  legs: { sid: string; role: string }[];
}

export class VoiceOrchestrator extends DurableObject<Env> {
  private sockets = new Set<WebSocket>();

  override async fetch(req: Request): Promise<Response> {
    await this.ensureSchema();
    const url = new URL(req.url);

    if (url.pathname === '/start' && req.method === 'POST') {
      const s = (await req.json()) as CallState;
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO calls (call_sid, from_e164, to_e164, started_at, ended_at, status, legs)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        s.call_sid,
        s.from,
        s.to,
        s.started_at,
        s.ended_at,
        s.status,
        JSON.stringify(s.legs),
      );
      this.broadcast({ kind: 'started', state: s });
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/event' && req.method === 'POST') {
      const e = (await req.json()) as { call_sid: string; status: string; meta?: unknown };
      this.ctx.storage.sql.exec(
        `UPDATE calls SET status = ? WHERE call_sid = ?`,
        e.status,
        e.call_sid,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO events (call_sid, ts, kind, payload) VALUES (?, ?, ?, ?)`,
        e.call_sid,
        Date.now(),
        e.status,
        JSON.stringify(e.meta ?? {}),
      );
      this.broadcast({ kind: 'event', event: e });
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/transcript' && req.method === 'POST') {
      const t = (await req.json()) as { call_sid: string; ts: number; speaker: string; text: string };
      this.ctx.storage.sql.exec(
        `INSERT INTO transcripts (call_sid, ts, speaker, text) VALUES (?, ?, ?, ?)`,
        t.call_sid,
        t.ts,
        t.speaker,
        t.text,
      );
      this.broadcast({ kind: 'transcript', transcript: t });
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/stream') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();
      this.sockets.add(server);
      server.addEventListener('close', () => this.sockets.delete(server));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/state') {
      const calls = this.ctx.storage.sql.exec(`SELECT * FROM calls`).toArray();
      return Response.json(calls);
    }

    return new Response('not found', { status: 404 });
  }

  private broadcast(payload: unknown): void {
    const frame = JSON.stringify(payload);
    for (const ws of this.sockets) {
      try {
        ws.send(frame);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }

  private async ensureSchema(): Promise<void> {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS calls (
        call_sid TEXT PRIMARY KEY,
        from_e164 TEXT,
        to_e164 TEXT,
        started_at INTEGER,
        ended_at INTEGER,
        status TEXT,
        legs TEXT
      )`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        call_sid TEXT,
        ts INTEGER,
        kind TEXT,
        payload TEXT
      )`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS transcripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        call_sid TEXT,
        ts INTEGER,
        speaker TEXT,
        text TEXT
      )`,
    );
  }
}
