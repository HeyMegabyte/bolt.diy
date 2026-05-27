/**
 * JobTrackingHub — per-booking GPS / status fan-out. Drives the hero map for the
 * end-customer. Sub-second crew location updates. Last 100 points retained.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.js';

interface LocationPing {
  ts: number;
  lat: number;
  lng: number;
  heading?: number;
  speed_mps?: number;
  status?: 'en_route' | 'on_site' | 'completed' | 'delayed';
  eta_seconds?: number;
}

export class JobTrackingHub extends DurableObject<Env> {
  private sockets = new Set<WebSocket>();
  private last: LocationPing | null = null;

  override async fetch(req: Request): Promise<Response> {
    await this.ensureSchema();
    const url = new URL(req.url);

    if (url.pathname === '/ping' && req.method === 'POST') {
      const ping = (await req.json()) as LocationPing;
      this.last = ping;
      this.ctx.storage.sql.exec(
        `INSERT INTO pings (ts, lat, lng, heading, speed_mps, status, eta_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ping.ts,
        ping.lat,
        ping.lng,
        ping.heading ?? null,
        ping.speed_mps ?? null,
        ping.status ?? null,
        ping.eta_seconds ?? null,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM pings WHERE id NOT IN (SELECT id FROM pings ORDER BY ts DESC LIMIT 100)`,
      );
      const frame = JSON.stringify(ping);
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
      if (this.last) server.send(JSON.stringify(this.last));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/latest') {
      return Response.json(this.last ?? { ts: null });
    }

    return new Response('not found', { status: 404 });
  }

  private async ensureSchema(): Promise<void> {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS pings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        heading REAL,
        speed_mps REAL,
        status TEXT,
        eta_seconds INTEGER
      )`,
    );
  }
}
