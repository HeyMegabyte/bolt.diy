/**
 * Health check routes
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get('/', async (c) => {
  const checks: Record<string, { status: 'pass' | 'fail'; message?: string; latency_ms?: number }> = {};

  // Check Supabase connection
  const dbStart = Date.now();
  try {
    const db = c.get('db');
    const { error } = await db.from('admin_settings').select('key').limit(1);
    checks.database = {
      status: error ? 'fail' : 'pass',
      message: error?.message,
      latency_ms: Date.now() - dbStart,
    };
  } catch (error) {
    checks.database = {
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      latency_ms: Date.now() - dbStart,
    };
  }

  // Check KV
  const kvStart = Date.now();
  try {
    await c.env.CACHE_KV.get('health-check');
    checks.kv = {
      status: 'pass',
      latency_ms: Date.now() - kvStart,
    };
  } catch (error) {
    checks.kv = {
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      latency_ms: Date.now() - kvStart,
    };
  }

  // Check R2
  const r2Start = Date.now();
  try {
    await c.env.SITES_BUCKET.head('health-check');
    checks.r2 = {
      status: 'pass',
      latency_ms: Date.now() - r2Start,
    };
  } catch (error) {
    // R2 returns error for non-existent keys, but that's ok
    checks.r2 = {
      status: 'pass',
      latency_ms: Date.now() - r2Start,
    };
  }

  // Determine overall status
  const allPass = Object.values(checks).every((check) => check.status === 'pass');
  const anyFail = Object.values(checks).some((check) => check.status === 'fail');

  const status = allPass ? 'healthy' : anyFail ? 'unhealthy' : 'degraded';

  return c.json({
    status,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    checks,
  });
});

// Liveness probe (minimal)
healthRoutes.get('/live', (c) => {
  return c.json({ status: 'ok' });
});

// Readiness probe
healthRoutes.get('/ready', async (c) => {
  try {
    const db = c.get('db');
    const { error } = await db.from('admin_settings').select('key').limit(1);
    if (error) throw error;
    return c.json({ status: 'ready' });
  } catch {
    return c.json({ status: 'not_ready' }, 503);
  }
});
