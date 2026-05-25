/**
 * @module routes/health
 * @description Liveness + readiness probes for the Project Sites Worker.
 *
 * Provides two endpoints:
 * - `GET /health` — lightweight probe (KV + R2 latency) suitable for
 *   uptime monitors and edge load balancers.
 * - `GET /health/deep` — full dependency sweep (KV + R2 + D1 + AI binding)
 *   that returns `503` when any dependency is degraded so orchestrators
 *   can route around the unhealthy POP.
 *
 * Neither endpoint requires auth.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';

const health = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * `GET /health` — Shallow health probe.
 *
 * @remarks
 * Verifies KV + R2 reachability with timing. Always returns `200`; the
 * `status` field flips to `"degraded"` when any check fails so monitors
 * can alert without page status codes flapping.
 *
 * Response: `{ status, version, environment, timestamp, latency_ms, checks }`
 *
 * @see {@link health.get('/health/deep')}
 */
health.get('/health', async (c) => {
  const startTime = Date.now();
  const checks: Record<string, { status: 'ok' | 'error'; latency_ms?: number; message?: string }> =
    {};

  // Check KV
  try {
    const kvStart = Date.now();
    await c.env.CACHE_KV.get('health-check-probe');
    checks['kv'] = { status: 'ok', latency_ms: Date.now() - kvStart };
  } catch (err) {
    checks['kv'] = {
      status: 'error',
      message: err instanceof Error ? err.message : 'KV check failed',
    };
  }

  // Check R2
  try {
    const r2Start = Date.now();
    await c.env.SITES_BUCKET.head('health-check-probe');
    checks['r2'] = { status: 'ok', latency_ms: Date.now() - r2Start };
  } catch (err) {
    checks['r2'] = {
      status: 'error',
      message: err instanceof Error ? err.message : 'R2 check failed',
    };
  }

  const hasErrors = Object.values(checks).some((ch) => ch.status === 'error');

  return c.json({
    status: hasErrors ? 'degraded' : 'ok',
    version: '0.1.0',
    environment: c.env.ENVIRONMENT ?? 'development',
    timestamp: new Date().toISOString(),
    latency_ms: Date.now() - startTime,
    checks,
  });
});

/**
 * `GET /health/deep` — Full-dependency readiness probe.
 *
 * @remarks
 * Verifies KV + R2 + D1 + the AI binding. Returns HTTP `503` when any
 * dependency reports `error` so orchestrators (Cloudflare Load Balancer,
 * external uptime monitors) can withdraw the unhealthy POP from rotation.
 *
 * Response: `{ status, version, environment, timestamp, region, latency_ms, checks }`
 *
 * @see {@link health.get('/health')}
 */
health.get('/health/deep', async (c) => {
  const startTime = Date.now();
  const checks: Record<string, { status: 'ok' | 'error'; latency_ms?: number; message?: string }> =
    {};

  // Check KV
  try {
    const kvStart = Date.now();
    await c.env.CACHE_KV.get('health-check-probe');
    checks['kv'] = { status: 'ok', latency_ms: Date.now() - kvStart };
  } catch (err) {
    checks['kv'] = {
      status: 'error',
      message: err instanceof Error ? err.message : 'KV check failed',
    };
  }

  // Check R2
  try {
    const r2Start = Date.now();
    await c.env.SITES_BUCKET.head('health-check-probe');
    checks['r2'] = { status: 'ok', latency_ms: Date.now() - r2Start };
  } catch (err) {
    checks['r2'] = {
      status: 'error',
      message: err instanceof Error ? err.message : 'R2 check failed',
    };
  }

  // Check D1
  try {
    const d1Start = Date.now();
    await c.env.DB.prepare('SELECT 1').first();
    checks['d1'] = { status: 'ok', latency_ms: Date.now() - d1Start };
  } catch (err) {
    checks['d1'] = {
      status: 'error',
      message: err instanceof Error ? err.message : 'D1 check failed',
    };
  }

  // Check AI binding
  try {
    const aiStart = Date.now();
    checks['ai'] = { status: c.env.AI ? 'ok' : 'error', latency_ms: Date.now() - aiStart };
  } catch {
    checks['ai'] = { status: 'error', message: 'AI binding unavailable' };
  }

  const hasErrors = Object.values(checks).some((ch) => ch.status === 'error');
  const statusCode = hasErrors ? 503 : 200;

  return c.json(
    {
      status: hasErrors ? 'degraded' : 'operational',
      version: '1.5.0',
      environment: c.env.ENVIRONMENT ?? 'development',
      timestamp: new Date().toISOString(),
      region: (c.req.raw as unknown as { cf?: { colo?: string } }).cf?.colo ?? 'unknown',
      latency_ms: Date.now() - startTime,
      checks,
    },
    statusCode,
  );
});

export { health };
