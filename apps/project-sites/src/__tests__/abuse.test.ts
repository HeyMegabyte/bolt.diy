/**
 * §48 app-aware abuse layer — the port providers + requireNotAbusive middleware.
 * Fake/AllowAll providers return their verdict; the middleware passes a clean
 * request through and 429s a flagged one (with Retry-After); getAbuseProvider
 * fails OPEN (AllowAll) when ARCJET_KEY is unset.
 */
import { Hono } from 'hono';
import {
  FakeAbuseProvider,
  AllowAllAbuseProvider,
  type AbuseProvider,
} from '../platform/abuse.js';
import { getAbuseProvider, requireNotAbusive } from '../middleware/abuse.js';
import type { Env, Variables } from '../types/env.js';

function appWith(provider: AbuseProvider) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'req-1');
    await next();
  });
  app.post('/api/claim/x', requireNotAbusive('claim', () => provider), (c) => c.json({ ok: true }));
  return app;
}

describe('abuse providers', () => {
  it('FakeAbuseProvider returns its configured verdict', async () => {
    expect(await new FakeAbuseProvider().decide(ctx())).toEqual({ allow: true });
    expect(
      await new FakeAbuseProvider({ allow: false, reason: 'bot', retryAfterSec: 60 }).decide(ctx()),
    ).toEqual({ allow: false, reason: 'bot', retryAfterSec: 60 });
  });

  it('AllowAllAbuseProvider always allows (fail-open)', async () => {
    expect(await new AllowAllAbuseProvider().decide(ctx())).toEqual({ allow: true });
  });
});

describe('getAbuseProvider', () => {
  it('fails OPEN (AllowAll) when ARCJET_KEY is unset', () => {
    expect(getAbuseProvider({} as Env)).toBeInstanceOf(AllowAllAbuseProvider);
  });

  it('honors an injected provider', () => {
    const p = new FakeAbuseProvider();
    expect(getAbuseProvider({} as Env, { provider: p })).toBe(p);
  });
});

describe('requireNotAbusive middleware', () => {
  it('passes a clean request through to the handler', async () => {
    const res = await appWith(new FakeAbuseProvider({ allow: true })).request('/api/claim/x', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('429s a flagged request with the reason + Retry-After', async () => {
    const res = await appWith(
      new FakeAbuseProvider({ allow: false, reason: 'bot', retryAfterSec: 30 }),
    ).request('/api/claim/x', { method: 'POST' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('RATE_LIMITED');
    expect(json.error.message).toContain('bot');
  });
});

function ctx() {
  return { ip: '1.2.3.4', path: '/api/claim/x', kind: 'claim' as const };
}
