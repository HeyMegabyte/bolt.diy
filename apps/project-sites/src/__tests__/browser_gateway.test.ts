/**
 * browser_gateway — the CF-primary / Browserbase-fallback routing LAW + the
 * Browserbase session creation. The connect()/launch() orchestration is
 * integration-level (needs a real browser) and is not unit-tested here.
 */
import {
  chooseBrowserProvider,
  createBrowserbaseSession,
  BrowserGatewayError,
} from '../services/browser_gateway.js';
import type { Env } from '../types/env.js';

const CF_ONLY = { BROWSER: {} } as Pick<
  Env,
  'BROWSER' | 'BROWSERBASE_API_KEY' | 'BROWSERBASE_PROJECT_ID'
>;
const BB_ONLY = { BROWSERBASE_API_KEY: 'bb_live_x', BROWSERBASE_PROJECT_ID: 'proj-1' } as Pick<
  Env,
  'BROWSER' | 'BROWSERBASE_API_KEY' | 'BROWSERBASE_PROJECT_ID'
>;
const BOTH = {
  BROWSER: {},
  BROWSERBASE_API_KEY: 'bb_live_x',
  BROWSERBASE_PROJECT_ID: 'proj-1',
} as Pick<Env, 'BROWSER' | 'BROWSERBASE_API_KEY' | 'BROWSERBASE_PROJECT_ID'>;
const NEITHER = {} as Pick<Env, 'BROWSER' | 'BROWSERBASE_API_KEY' | 'BROWSERBASE_PROJECT_ID'>;

describe('chooseBrowserProvider — Browserbase-backup-only LAW', () => {
  it('defaults to CF for normal automation', () => {
    expect(chooseBrowserProvider({}, BOTH)).toEqual({ provider: 'cf', reason: 'cf-default' });
    expect(chooseBrowserProvider({}, CF_ONLY)).toEqual({ provider: 'cf', reason: 'cf-default' });
  });

  it('routes a specialty case to Browserbase', () => {
    expect(chooseBrowserProvider({ specialty: 'captcha' }, BOTH)).toEqual({
      provider: 'browserbase',
      reason: 'specialty',
    });
    expect(chooseBrowserProvider({ specialty: 'residential_proxy' }, BOTH).provider).toBe(
      'browserbase',
    );
  });

  it('falls back to Browserbase ONLY when CF is unavailable', () => {
    expect(chooseBrowserProvider({}, BB_ONLY)).toEqual({
      provider: 'browserbase',
      reason: 'cf-unavailable-fallback',
    });
  });

  it('throws when a specialty needs Browserbase but it is not configured', () => {
    expect(() => chooseBrowserProvider({ specialty: 'captcha' }, CF_ONLY)).toThrow(
      BrowserGatewayError,
    );
  });

  it('throws when no provider is available at all', () => {
    expect(() => chooseBrowserProvider({}, NEITHER)).toThrow(BrowserGatewayError);
  });

  it('honours an explicit backendPreference, but only if that provider is available', () => {
    expect(chooseBrowserProvider({ backendPreference: 'browserbase' }, BOTH)).toEqual({
      provider: 'browserbase',
      reason: 'backend-preference',
    });
    expect(() => chooseBrowserProvider({ backendPreference: 'browserbase' }, CF_ONLY)).toThrow(
      BrowserGatewayError,
    );
    expect(() => chooseBrowserProvider({ backendPreference: 'cf' }, BB_ONLY)).toThrow(
      BrowserGatewayError,
    );
    // forceProvider still works as a deprecated alias.
    expect(chooseBrowserProvider({ forceProvider: 'cf' }, BOTH).provider).toBe('cf');
  });

  it('routes skyvern_internal only on explicit backendPreference (never a default/fallback)', () => {
    expect(chooseBrowserProvider({ backendPreference: 'skyvern_internal' }, BOTH)).toEqual({
      provider: 'skyvern_internal',
      reason: 'backend-preference',
    });
    // never chosen by the default LAW.
    expect(chooseBrowserProvider({}, BOTH).provider).toBe('cf');
    expect(chooseBrowserProvider({ specialty: 'captcha' }, BOTH).provider).toBe('browserbase');
  });
});

describe('createBrowserbaseSession', () => {
  it('throws without creds', async () => {
    await expect(createBrowserbaseSession(NEITHER)).rejects.toThrow(BrowserGatewayError);
  });

  it('POSTs with the API key header + projectId, returns the parsed session', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchStub = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ id: 'sess-1', connectUrl: 'wss://connect.browserbase.com/x' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const session = await createBrowserbaseSession(BB_ONLY, fetchStub);
    expect(session).toEqual({ id: 'sess-1', connectUrl: 'wss://connect.browserbase.com/x' });
    expect(calls[0].url).toBe('https://api.browserbase.com/v1/sessions');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['X-BB-API-Key']).toBe('bb_live_x');
    expect(calls[0].init?.body).toContain('proj-1');
  });

  it('throws on a non-2xx response', async () => {
    const fetchStub = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(createBrowserbaseSession(BB_ONLY, fetchStub)).rejects.toThrow(/500/);
  });

  it('throws when the response shape is wrong', async () => {
    const fetchStub = (async () =>
      new Response(JSON.stringify({ id: 'sess-1' }), { status: 200 })) as unknown as typeof fetch;
    await expect(createBrowserbaseSession(BB_ONLY, fetchStub)).rejects.toThrow(BrowserGatewayError);
  });
});
