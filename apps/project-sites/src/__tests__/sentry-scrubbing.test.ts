/**
 * @module __tests__/sentry-scrubbing
 *
 * @description
 * Verifies that the `beforeSend`-equivalent scrubbing layer in
 * `services/sentry.ts` strips sensitive headers (Authorization, Cookie,
 * Stripe-Signature) from every event payload before it is transmitted to
 * Sentry. No real network call is made — `fetch` is mocked.
 *
 * Also asserts that `captureException` passes the SENTRY_RELEASE env var
 * into the emitted payload so events group correctly in the Sentry UI.
 */

import type { Env } from '../types/env.js';
import { captureException, scrubHeaders, scrubSentryEvent } from '../services/sentry.js';

// ── Mock global fetch ──────────────────────────────────────────
const mockFetch = jest.fn().mockResolvedValue({ ok: true });
(global as unknown as { fetch: unknown }).fetch = mockFetch;

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    SENTRY_DSN: 'https://pub123@o0.ingest.sentry.io/999',
    ENVIRONMENT: 'test',
    SENTRY_RELEASE: 'project-sites@1.2.3',
    ...overrides,
  } as unknown as Env;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── scrubHeaders ─────────────────────────────────────────────

describe('scrubHeaders', () => {
  it('replaces Authorization with [Filtered]', () => {
    const result = scrubHeaders({ Authorization: 'Bearer secret', 'Content-Type': 'application/json' });
    expect(result['Authorization']).toBe('[Filtered]');
    expect(result['Content-Type']).toBe('application/json');
  });

  it('replaces Cookie with [Filtered]', () => {
    const result = scrubHeaders({ cookie: 'session=abc; other=xyz' });
    expect(result['cookie']).toBe('[Filtered]');
  });

  it('replaces Stripe-Signature with [Filtered]', () => {
    const result = scrubHeaders({ 'Stripe-Signature': 'v1=abc,t=123' });
    expect(result['Stripe-Signature']).toBe('[Filtered]');
  });

  it('replaces set-cookie with [Filtered]', () => {
    const result = scrubHeaders({ 'set-cookie': 'token=secret; HttpOnly' });
    expect(result['set-cookie']).toBe('[Filtered]');
  });

  it('is case-insensitive', () => {
    const result = scrubHeaders({ AUTHORIZATION: 'Bearer tok', COOKIE: 'a=b' });
    expect(result['AUTHORIZATION']).toBe('[Filtered]');
    expect(result['COOKIE']).toBe('[Filtered]');
  });

  it('does not mutate the input object', () => {
    const input = { Authorization: 'tok', 'X-Other': 'val' };
    const result = scrubHeaders(input);
    // Input unchanged
    expect(input['Authorization']).toBe('tok');
    // Output scrubbed
    expect(result['Authorization']).toBe('[Filtered]');
  });

  it('passes through safe headers untouched', () => {
    const result = scrubHeaders({ 'Content-Type': 'text/plain', 'X-Request-ID': 'req-1' });
    expect(result['Content-Type']).toBe('text/plain');
    expect(result['X-Request-ID']).toBe('req-1');
  });
});

// ─── scrubSentryEvent ─────────────────────────────────────────

describe('scrubSentryEvent', () => {
  it('scrubs request.headers in the event', () => {
    const event = {
      level: 'error' as const,
      tags: {},
      extra: {},
      timestamp: 0,
      platform: 'javascript',
      server_name: 'worker',
      request: {
        url: 'https://example.com',
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      },
    };

    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.request?.headers?.['Authorization']).toBe('[Filtered]');
    expect(scrubbed.request?.headers?.['Content-Type']).toBe('application/json');
  });

  it('scrubs contexts.request.headers', () => {
    const event = {
      level: 'error' as const,
      tags: {},
      extra: {},
      timestamp: 0,
      platform: 'javascript',
      server_name: 'worker',
      contexts: {
        request: {
          url: 'https://example.com',
          method: 'GET',
          headers: { Cookie: 'session=abc' },
        },
      },
    };

    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.contexts?.request?.headers?.['Cookie']).toBe('[Filtered]');
  });

  it('scrubs sensitive keys from breadcrumb data', () => {
    const event = {
      level: 'error' as const,
      tags: {},
      extra: {},
      timestamp: 0,
      platform: 'javascript',
      server_name: 'worker',
      breadcrumbs: {
        values: [
          {
            type: 'default',
            category: 'http',
            message: 'GET /api',
            level: 'info' as const,
            timestamp: 0,
            data: {
              authorization: 'Bearer secret',
              'stripe-signature': 'v1=abc',
              method: 'GET',
            },
          },
        ],
      },
    };

    const scrubbed = scrubSentryEvent(event);
    const crumb = scrubbed.breadcrumbs?.values?.[0];
    expect(crumb?.data?.['authorization']).toBe('[Filtered]');
    expect(crumb?.data?.['stripe-signature']).toBe('[Filtered]');
    expect(crumb?.data?.['method']).toBe('GET'); // safe field preserved
  });

  it('does not mutate the original event', () => {
    const original = {
      level: 'error' as const,
      tags: {},
      extra: {},
      timestamp: 0,
      platform: 'javascript',
      server_name: 'worker',
      request: {
        url: 'https://example.com',
        method: 'POST',
        headers: { Authorization: 'Bearer tok' },
      },
    };

    scrubSentryEvent(original);
    expect(original.request.headers['Authorization']).toBe('Bearer tok');
  });
});

// ─── captureException + PII contract ─────────────────────────

describe('captureException PII contract', () => {
  it('sends SENTRY_RELEASE in the event payload', async () => {
    const env = makeEnv();
    await captureException(env, new Error('test error'), { requestId: 'req-1' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body['release']).toBe('project-sites@1.2.3');
  });

  it('sends ENVIRONMENT in the event payload', async () => {
    const env = makeEnv({ ENVIRONMENT: 'production' });
    await captureException(env, new Error('prod error'));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body['environment']).toBe('production');
  });

  it('does NOT send Authorization header in request context', async () => {
    const env = makeEnv();
    await captureException(env, new Error('leak test'), {
      request: {
        url: 'https://projectsites.dev/api/sites',
        method: 'POST',
        headers: { Authorization: 'Bearer super-secret', 'Content-Type': 'application/json' },
      },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      request?: { headers?: Record<string, string> };
      contexts?: { request?: { headers?: Record<string, string> } };
    };
    const reqHeaders = body.request?.headers ?? body.contexts?.request?.headers ?? {};
    // The authorization header MUST be scrubbed
    expect(reqHeaders['Authorization']).not.toBe('Bearer super-secret');
    // It should be either missing or replaced with [Filtered]
    if (reqHeaders['Authorization'] !== undefined) {
      expect(reqHeaders['Authorization']).toBe('[Filtered]');
    }
  });

  it('does NOT send Cookie in request context', async () => {
    const env = makeEnv();
    await captureException(env, new Error('cookie test'), {
      request: {
        url: 'https://projectsites.dev/api/me',
        method: 'GET',
        headers: { Cookie: 'session=tok; _ps=abc', 'X-Request-ID': 'req-x' },
      },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      request?: { headers?: Record<string, string> };
      contexts?: { request?: { headers?: Record<string, string> } };
    };
    const reqHeaders = body.request?.headers ?? body.contexts?.request?.headers ?? {};
    expect(reqHeaders['Cookie']).not.toBe('session=tok; _ps=abc');
    if (reqHeaders['Cookie'] !== undefined) {
      expect(reqHeaders['Cookie']).toBe('[Filtered]');
    }
  });

  it('does NOT send Stripe-Signature in request context', async () => {
    const env = makeEnv();
    await captureException(env, new Error('stripe sig test'), {
      request: {
        url: 'https://projectsites.dev/webhooks/stripe',
        method: 'POST',
        headers: { 'Stripe-Signature': 'v1=abc,t=12345', 'Content-Type': 'application/json' },
      },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      request?: { headers?: Record<string, string> };
      contexts?: { request?: { headers?: Record<string, string> } };
    };
    const reqHeaders = body.request?.headers ?? body.contexts?.request?.headers ?? {};
    expect(reqHeaders['Stripe-Signature']).not.toBe('v1=abc,t=12345');
    if (reqHeaders['Stripe-Signature'] !== undefined) {
      expect(reqHeaders['Stripe-Signature']).toBe('[Filtered]');
    }
  });

  it('includes safe metadata (Content-Type, X-Request-ID) unmodified', async () => {
    const env = makeEnv();
    await captureException(env, new Error('safe headers'), {
      request: {
        url: 'https://projectsites.dev/api/sites',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': 'req-safe',
          Authorization: 'Bearer secret',
        },
      },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      request?: { headers?: Record<string, string> };
      contexts?: { request?: { headers?: Record<string, string> } };
    };
    const reqHeaders = body.request?.headers ?? body.contexts?.request?.headers ?? {};
    // Safe headers pass through
    expect(reqHeaders['Content-Type']).toBe('application/json');
    expect(reqHeaders['X-Request-ID']).toBe('req-safe');
    // Sensitive header scrubbed
    if (reqHeaders['Authorization'] !== undefined) {
      expect(reqHeaders['Authorization']).toBe('[Filtered]');
    }
  });
});
