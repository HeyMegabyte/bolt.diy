/**
 * Unit tests for the observability module.
 *
 * Rules:
 * - Global `jest` only (NOT `import {jest} from '@jest/globals'`)
 * - Jest transforms strip `.js` extensions via moduleNameMapper in jest.config.cjs
 * - posthog mock path is relative to THIS __tests__/ directory
 */

// Mock posthog BEFORE any imports that transitively load it.
// Path relative to this __tests__/ file: two levels up to reach src/lib/
jest.mock('../../lib/posthog.js', () => ({
  capture: jest.fn(),
}));

import { redactSecrets } from '../context.js';
import { sendToAxiom } from '../axiom.js';
import { createLogger } from '../logger.js';
import { createAnalytics } from '../analytics.js';
import { withTraceContext, traceparentFor } from '../otel.js';
import { capture } from '../../lib/posthog.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal ExecutionContext stub. */
function makeCtx(): ExecutionContext {
  return {
    waitUntil: jest.fn(),
    passThroughOnException: jest.fn(),
  } as unknown as ExecutionContext;
}

/** Build a minimal Env stub. */
function makeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return { ...overrides } as unknown as Record<string, string>;
}

// ─── redactSecrets ───────────────────────────────────────────────────────────

describe('redactSecrets', () => {
  it('masks keys matching the secret pattern', () => {
    const result = redactSecrets({ api_token: 'super-secret-value', name: 'visible' });
    expect(result['api_token']).toBe('supe…');
    expect(result['name']).toBe('visible');
  });

  it('passes through short values without masking', () => {
    // Values ≤4 chars are not masked (nothing to redact)
    const result = redactSecrets({ password: 'abc' });
    expect(result['password']).toBe('abc');
  });

  it('passes through non-secret keys unchanged', () => {
    const result = redactSecrets({ site_id: 's_123', org_id: 'o_456' });
    expect(result['site_id']).toBe('s_123');
    expect(result['org_id']).toBe('o_456');
  });

  it('handles empty objects', () => {
    expect(redactSecrets({})).toEqual({});
  });
});

// ─── createLogger ────────────────────────────────────────────────────────────

describe('createLogger', () => {
  it('emits structured JSON via console.warn for info level', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ctx = makeCtx();
    const env = makeEnv(); // AXIOM_ENABLED absent → sendToAxiom is no-op
    const log = createLogger(env as unknown as Parameters<typeof createLogger>[0], ctx, {
      service: 'test',
      environment: 'test',
    });

    log.info('hello world', { site_id: 's_test' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(warnSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(emitted['level']).toBe('info');
    expect(emitted['msg']).toBe('hello world');
    expect(emitted['service']).toBe('test');
    expect(emitted['site_id']).toBe('s_test');
    expect(typeof emitted['ts']).toBe('number');

    warnSpy.mockRestore();
  });

  it('serializes error objects into the event', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ctx = makeCtx();
    const env = makeEnv();
    const log = createLogger(env as unknown as Parameters<typeof createLogger>[0], ctx, {
      service: 'test',
      environment: 'test',
    });

    const err = new Error('something broke');
    log.error('bad thing', {}, err);

    const emitted = JSON.parse(warnSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(emitted['level']).toBe('error');
    const errorField = emitted['error'] as Record<string, unknown>;
    expect(errorField['message']).toBe('something broke');
    expect(errorField['name']).toBe('Error');

    warnSpy.mockRestore();
  });
});

// ─── sendToAxiom ─────────────────────────────────────────────────────────────

describe('sendToAxiom', () => {
  it('is a no-op when AXIOM_ENABLED is not set', () => {
    const ctx = makeCtx();
    const env = makeEnv(); // no AXIOM_ENABLED, no AXIOM_TOKEN

    sendToAxiom(env as unknown as Parameters<typeof sendToAxiom>[0], ctx, 'projectsites', [
      { level: 'info', msg: 'test' },
    ]);

    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('is a no-op when AXIOM_TOKEN is absent but AXIOM_ENABLED is true', () => {
    const ctx = makeCtx();
    const env = makeEnv({ AXIOM_ENABLED: 'true' }); // no AXIOM_TOKEN

    sendToAxiom(env as unknown as Parameters<typeof sendToAxiom>[0], ctx, 'projectsites', [
      { level: 'info', msg: 'test' },
    ]);

    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('calls ctx.waitUntil when both AXIOM_ENABLED and AXIOM_TOKEN are set', () => {
    const ctx = makeCtx();
    const env = makeEnv({ AXIOM_ENABLED: 'true', AXIOM_TOKEN: 'xaat-test-token' });

    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response);

    sendToAxiom(env as unknown as Parameters<typeof sendToAxiom>[0], ctx, 'projectsites', [
      { level: 'info', msg: 'test' },
    ]);

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  });
});

// ─── withTraceContext ─────────────────────────────────────────────────────────

describe('withTraceContext', () => {
  const base = { service: 'test', environment: 'test' };

  it('extracts trace_id from a valid traceparent header', () => {
    const headers = new Headers({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    const result = withTraceContext(headers, base);
    expect(result.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('returns base context unchanged when traceparent is absent', () => {
    const headers = new Headers();
    const result = withTraceContext(headers, base);
    expect(result).toEqual(base);
    expect(result.trace_id).toBeUndefined();
  });

  it('returns base context unchanged when traceparent is malformed', () => {
    const headers = new Headers({ traceparent: 'not-a-valid-header' });
    const result = withTraceContext(headers, base);
    expect(result).toEqual(base);
  });
});

// ─── traceparentFor ───────────────────────────────────────────────────────────

describe('traceparentFor', () => {
  it('builds a valid traceparent string', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const tp = traceparentFor(traceId);
    expect(tp).toBe(`00-${traceId}-0000000000000000-01`);
  });

  it('matches the W3C traceparent format', () => {
    const traceId = 'a'.repeat(32);
    const tp = traceparentFor(traceId);
    expect(tp).toMatch(/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i);
  });
});

// ─── createAnalytics ─────────────────────────────────────────────────────────

describe('createAnalytics', () => {
  const captureMock = capture as jest.Mock;

  beforeEach(() => {
    captureMock.mockClear();
  });

  it('calls posthog capture with the correct event and distinctId', async () => {
    const ctx = makeCtx();
    const env = makeEnv();
    const analytics = createAnalytics(env as unknown as Parameters<typeof createAnalytics>[0], ctx);

    await analytics.capture('site.published', { distinct_id: 'user_123', site_id: 's_456' });

    expect(captureMock).toHaveBeenCalledTimes(1);
    const [, , event] = captureMock.mock.calls[0] as [
      unknown,
      unknown,
      { event: string; distinctId: string },
    ];
    expect(event.event).toBe('site.published');
    expect(event.distinctId).toBe('user_123');
  });

  it('falls back to "anonymous" distinctId when not provided', async () => {
    const ctx = makeCtx();
    const env = makeEnv();
    const analytics = createAnalytics(env as unknown as Parameters<typeof createAnalytics>[0], ctx);

    await analytics.capture('page.view', { path: '/' });

    const [, , event] = captureMock.mock.calls[0] as [
      unknown,
      unknown,
      { event: string; distinctId: string },
    ];
    expect(event.distinctId).toBe('anonymous');
  });

  it('identify emits a $identify event', () => {
    const ctx = makeCtx();
    const env = makeEnv();
    const analytics = createAnalytics(env as unknown as Parameters<typeof createAnalytics>[0], ctx);

    analytics.identify('user_789', { plan: 'pro' });

    expect(captureMock).toHaveBeenCalledTimes(1);
    const [, , event] = captureMock.mock.calls[0] as [
      unknown,
      unknown,
      { event: string; distinctId: string },
    ];
    expect(event.event).toBe('$identify');
    expect(event.distinctId).toBe('user_789');
  });
});
