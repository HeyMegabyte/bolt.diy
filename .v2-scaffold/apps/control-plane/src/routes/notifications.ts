/**
 * Notifications — list / ack / WebSocket stream backed by the per-user NotificationHub DO.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

const app = new Hono<HonoEnv>();

function stubFor(c: any) {
  const userId = requireAuth(c);
  const id = c.env.NOTIFICATION_HUB.idFromName(userId);
  return c.env.NOTIFICATION_HUB.get(id);
}

app.get('/', async (c) => {
  const stub = stubFor(c);
  return stub.fetch('https://do/list');
});

app.post(
  '/ack',
  zValidator('json', z.object({ ids: z.array(z.string().min(1)).min(1).max(100) })),
  async (c) => {
    const stub = stubFor(c);
    return stub.fetch('https://do/ack', {
      method: 'POST',
      body: JSON.stringify(c.req.valid('json')),
    });
  },
);

app.get('/stream', async (c) => {
  const upgrade = c.req.header('upgrade');
  if (upgrade?.toLowerCase() !== 'websocket') {
    throw new AppError(ErrorCode.BAD_REQUEST, 'WebSocket upgrade required');
  }
  const stub = stubFor(c);
  return stub.fetch('https://do/stream', { headers: { upgrade: 'websocket' } });
});

export default app;
