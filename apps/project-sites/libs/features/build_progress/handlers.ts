/**
 * @module libs/features/build_progress/handlers
 * @description Hono routes for Event-Sourced Build Progress (idea #10).
 *
 * | Method | Path                          | Purpose                                       |
 * | ------ | ----------------------------- | --------------------------------------------- |
 * | GET    | /api/sites/:id/build/stream   | SSE — replay backlog then stream new events   |
 * | GET    | /api/sites/:id/build/events   | JSON replay of the full event log             |
 *
 * `:id` is the site id, used directly as the build correlation id (`buildId`)
 * — the site-generation workflow emits events keyed by `params.siteId`.
 *
 * Both routes 404 when the `streaming_generation` flag is off (never 403 —
 * don't leak feature existence) per [[feature-flags]].
 *
 * The SSE endpoint replays the durable backlog immediately, then polls the
 * KV event log every 2s, emitting only events not yet sent. It closes the
 * stream once a terminal event (`publish.completed` / `build.failed`) is seen
 * or after a hard cap, so connections never hang indefinitely.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import {
  FLAG_KEY,
  getBuildEvents,
  isBuildComplete,
} from './service.js';
import { isTerminalBuildEvent, type BuildEvent } from '../../../src/services/build_events.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const buildProgress = new Hono<AppContext>();

/** Auth + flag gate. Returns a Response to short-circuit, or null to proceed. */
async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  }
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  return null;
}

/** JSON replay of the complete, ordered event log. */
buildProgress.get('/api/sites/:id/build/events', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const siteId = c.req.param('id');
  const events = await getBuildEvents(c.env, siteId);
  return c.json({
    buildId: siteId,
    complete: isBuildComplete(events),
    count: events.length,
    events,
  });
});

/** Max poll iterations before forcibly closing an SSE connection. */
const SSE_MAX_POLLS = 600; // 600 × 2s = 20 min ceiling
const SSE_POLL_MS = 2_000;

/** SSE — replay the backlog, then stream new events until terminal/cap. */
buildProgress.get('/api/sites/:id/build/stream', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const siteId = c.req.param('id');
  const env = c.env;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (event: string, data: unknown): void => {
        if (closed) return;
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // 1. Replay the durable backlog immediately.
        const backlog = await getBuildEvents(env, siteId);
        let lastIndex = backlog.length;
        for (const ev of backlog) send('build', ev);

        if (backlog.some((e) => isTerminalBuildEvent(e.type))) {
          send('done', { ok: true });
          return;
        }

        // 2. Poll for new events. Emit only events past the last sent index.
        for (let i = 0; i < SSE_MAX_POLLS; i++) {
          await new Promise((resolve) => setTimeout(resolve, SSE_POLL_MS));
          const all: BuildEvent[] = await getBuildEvents(env, siteId);
          const fresh = all.slice(lastIndex);
          lastIndex = all.length;
          for (const ev of fresh) send('build', ev);
          if (fresh.some((e) => isTerminalBuildEvent(e.type))) {
            send('done', { ok: true });
            return;
          }
        }
        // Hit the cap without a terminal event — close cleanly.
        send('timeout', { ok: false, reason: 'stream poll cap reached' });
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : 'stream failed' });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
});
