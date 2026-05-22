/**
 * @module __tests__/log
 *
 * @description
 * Validates the structured logger (item #50):
 *   - emits exactly one JSON line per call,
 *   - payload contains every required key (`level`, `service`, `env`,
 *     `eventName`, `ts`),
 *   - the safe-context allowlist drops untrusted keys + secret-pattern
 *     values become `[REDACTED]`,
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
      expect(entry.eventName).toBe('webhook_received');
      expect(entry.ts).toEqual(expect.any(String));
      expect(entry.env).toBe('unknown'); // no context provided
      expect(entry.provider).toBe('stripe');
      expect(entry.event_id).toBe('evt_123');
    } finally {
      restore();
    }
  });

  it('drops non-allowlisted fields and redacts secret-pattern values', () => {
    const { calls, restore } = captureWarn();
    try {
      log.warn('payment_failed', {
        order_id: 'should-be-dropped',
        password: 'p@ssw0rd',
        Authorization: 'Bearer ' + 'a'.repeat(40),
        message: 'sk_live_' + 'x'.repeat(32), // looks like a Stripe key
        status: 500, // allowlisted
        slug: 'vitos', // allowlisted
      });
      const entry = calls[0]!;
      expect(entry).not.toHaveProperty('order_id');
      expect(entry).not.toHaveProperty('password');
      expect(entry).not.toHaveProperty('Authorization');
      expect(entry.message).toBe('[REDACTED]');
      expect(entry.status).toBe(500);
      expect(entry.slug).toBe('vitos');
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
      // Without context, env=unknown, debug emits
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
