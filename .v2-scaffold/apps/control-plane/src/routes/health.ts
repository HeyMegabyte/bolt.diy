/**
 * Liveness + readiness probes. Bypasses auth + tenant + rate-limit middleware.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';

const app = new Hono<HonoEnv>();

app.get('/', (c) =>
  c.json({
    status: 'ok',
    service: 'control-plane',
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  }),
);

app.get('/ready', async (c) => {
  const checks: Record<string, 'ok' | 'fail'> = {};
  try {
    await c.env.DB.prepare('SELECT 1').first();
    checks['d1'] = 'ok';
  } catch {
    checks['d1'] = 'fail';
  }
  try {
    await c.env.CACHE.get('__readyz__');
    checks['kv'] = 'ok';
  } catch {
    checks['kv'] = 'fail';
  }
  const allOk = Object.values(checks).every((v) => v === 'ok');
  return c.json({ status: allOk ? 'ready' : 'degraded', checks }, allOk ? 200 : 503);
});

export default app;
