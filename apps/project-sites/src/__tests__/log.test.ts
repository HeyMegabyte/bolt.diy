/**
 * @module __tests__/log
 *
 * @description
 * Validates the structured logger:
 *   - emits exactly one JSON line per call (JSON mode in test env),
 *   - payload contains every required key (`level`, `service`, `env`,
 *     `eventName`/`msg`, `ts`),
 *   - the safe-context allowlist drops untrusted keys + secret-pattern
 *     values become `[REDACTED]`,
 *   - sensitive-KEY names (authorization, token, etc.) are also REDACTED
 *     regardless of allowlist,
 *   - `child(scope)` adds a `scope` field to every entry,
 *   - `requestLogger` middleware emits one `http_request` entry per
 *     request with `method`, `path`, `status`, `durationMs`.
 */

import { Hono } from 'hono';
import { log, requestLogger } from '../lib/log.js';
import { requestIdMiddleware } from '../middleware/request_id.js';

type LogPayload = Record<string, unknown>;

/** Capture every console.warn call as a parsed JSON object. */
function captureWarn(): { calls: LogPayload[]; restore: () => void } {
  const calls: LogPayload[] = [];
  const spy = jest.spyOn(console, 'warn').mockImplementation((line: unknown) => {
    if (typeof line === 'string') {
      try {
        calls.push(JSON.parse(line) as LogPayload);
      } catch {
        calls.push({ raw: line });
      }
    }
  });
  return { calls, restore: () => spy.mockRestore() };
}

describe('log.* — structured logger', () => {
  it('emits exactly one JSON line per call', () => {
    const { calls, restore } = captureWarn();
    try {
      log.info('site_created', { slug: 'vitos' });
      expect(calls.length).toBe(1);
    } finally {
      restore();
    }
  });

  it('payload contains every required key', () => {
    const { calls, restore } = captureWarn();
    try {
      log.info('webhook_received', { event_id: 'evt_123', provider: 'stripe' });
      const entry = calls[0]!;
      expect(entry.level).toBe('info');
      expect(entry.service).toBe('project-sites');
      // `eventName` is the backward-compat alias for `msg`
      expect(entry.eventName).toBe('webhook_received');
      expect(entry.msg).toBe('webhook_received');
      expect(entry.ts).toEqual(expect.any(String));
      // In test env, NODE_ENV=test is the resolved env (no Hono context provided)
      expect(entry.env).toBe('test');
      expect(entry.provider).toBe('stripe');
      expect(entry.event_id).toBe('evt_123');
    } finally {
      restore();
    }
  });

  it('drops non-allowlisted fields and redacts secret-VALUE-pattern fields', () => {
    const { calls, restore } = captureWarn();
    try {
      log.warn('payment_failed', {
        order_id: 'should-be-dropped',      // not in allowlist → dropped
        message: 'sk_live_' + 'x'.repeat(32), // allowlisted key but secret value → redacted
        status: 500,  // allowlisted
        slug: 'vitos', // allowlisted
      });
      const entry = calls[0]!;
      expect(entry).not.toHaveProperty('order_id');
      expect(entry.message).toBe('[REDACTED]');
      expect(entry.status).toBe(500);
      expect(entry.slug).toBe('vitos');
    } finally {
      restore();
    }
  });

  it('redacts fields whose KEY name is sensitive (authorization, token, password, etc.)', () => {
    const { calls, restore } = captureWarn();
    try {
      log.warn('auth_attempt', {
        // Keys that match SENSITIVE_KEY_RE — values MUST be [REDACTED]
        authorization: 'Bearer tok_' + 'a'.repeat(30),
        token: 'super-secret-jwt',
        password: 'hunter2',
        api_key: 'sk_live_' + 'k'.repeat(20),
        'stripe-signature': 't=123,v1=abc',
        cookie: '__session=xyz',
        // Safe fields that should pass through
        status: 401,
        slug: 'test-site',
      });
      const entry = calls[0]!;
      expect(entry.authorization).toBe('[REDACTED]');
      expect(entry.token).toBe('[REDACTED]');
      expect(entry.password).toBe('[REDACTED]');
      expect(entry.api_key).toBe('[REDACTED]');
      expect(entry['stripe-signature']).toBe('[REDACTED]');
      expect(entry.cookie).toBe('[REDACTED]');
      // Safe fields pass through unchanged
      expect(entry.status).toBe(401);
      expect(entry.slug).toBe('test-site');
    } finally {
      restore();
    }
  });

  it('warn + error emit at correct level', () => {
    const { calls, restore } = captureWarn();
    try {
      log.warn('retry_attempt', { attempt: 2, max: 3 });
      log.error('payment_failed', { code: 'card_declined' });
      expect(calls[0]!.level).toBe('warn');
      expect(calls[1]!.level).toBe('error');
    } finally {
      restore();
    }
  });

  it('debug is suppressed when env=production', () => {
    const { calls, restore } = captureWarn();
    try {
      // Without context, env=test (NODE_ENV=test), debug emits
      log.debug('route_matched', { path: '/api/foo' });
      expect(calls.length).toBe(1);

      // Simulate production context — debug should be a no-op
      const fakeCtx = {
        env: { ENVIRONMENT: 'production' },
        get: () => undefined,
      } as unknown as Parameters<typeof log.debug>[2];
      log.debug('route_matched', { path: '/api/foo' }, fakeCtx);
      expect(calls.length).toBe(1); // still 1
    } finally {
      restore();
    }
  });

  it('child(scope) adds scope field to every entry', () => {
    const { calls, restore } = captureWarn();
    try {
      const scoped = log.child('billing');
      scoped.info('checkout_started', { status: 200 });
      const entry = calls[0]!;
      expect(entry.scope).toBe('project-sites/billing');
      expect(entry.level).toBe('info');
    } finally {
      restore();
    }
  });
});

describe('requestLogger middleware', () => {
  it('emits one http_request entry per request with method/path/status/durationMs', async () => {
    const { calls, restore } = captureWarn();
    try {
      const app = new Hono<{
        Bindings: { ENVIRONMENT?: string };
        Variables: Record<string, never>;
      }>();
      app.use('*', requestIdMiddleware);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.use('*', requestLogger as any);
      app.get('/ping', (c) => c.json({ ok: true }));

      const res = await app.request('/ping', { headers: { 'cf-connecting-ip': '1.2.3.4' } });
      expect(res.status).toBe(200);

      const entry = calls.find((c) => c.eventName === 'http_request');
      expect(entry).toBeDefined();
      expect(entry!.method).toBe('GET');
      expect(entry!.path).toBe('/ping');
      expect(entry!.status).toBe(200);
      expect(typeof entry!.durationMs).toBe('number');
      expect(entry!.requestId).toEqual(expect.any(String));
    } finally {
      restore();
    }
  });
});
