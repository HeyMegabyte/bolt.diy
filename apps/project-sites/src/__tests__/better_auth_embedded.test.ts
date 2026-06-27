/**
 * better_auth_embedded — Phase 1 of the full Better Auth cutover.
 *
 * Locks the embedded factory's LOGIC (auth/better-auth.ts): it wires the chosen
 * methods/plugins (email+password, magic link, Google social when configured, TOTP
 * 2FA) onto the main D1 and caches per isolate. The ESM `better-auth` lib + Kysely
 * are mocked at the boundary (jest can't import their ESM), so we assert the OPTIONS
 * our factory passes — the part we own — not the vendor's internals.
 */
jest.mock('better-auth', () => ({
  betterAuth: (options: unknown) => ({ options, handler: jest.fn() }),
}));
jest.mock('better-auth/plugins', () => ({
  magicLink: () => ({ id: 'magic-link' }),
  twoFactor: () => ({ id: 'two-factor' }),
}));
jest.mock('kysely', () => ({ Kysely: class {} }));
jest.mock('kysely-d1', () => ({ D1Dialect: class {} }));
jest.mock('../platform/email-router.js', () => ({
  getEmailProvider: () => ({ sendTransactional: jest.fn() }),
}));

import { makeAuth, _resetAuthCache } from '../auth/better-auth.js';
import type { Env } from '../types/env.js';

interface BuiltOptions {
  basePath: string;
  baseURL: string;
  emailAndPassword?: { enabled: boolean };
  socialProviders?: { google?: { clientId: string } };
  plugins?: Array<{ id: string }>;
}
function opts(env: Env): BuiltOptions {
  return (makeAuth(env) as unknown as { options: BuiltOptions }).options;
}
function envOf(extra: Partial<Record<string, unknown>> = {}): Env {
  return { DB: {}, BETTER_AUTH_SECRET: 'x'.repeat(40), ...extra } as unknown as Env;
}

describe('makeAuth (embedded Better Auth)', () => {
  beforeEach(() => _resetAuthCache());

  it('mounts at /api/auth on the app origin with a handler', () => {
    const auth = makeAuth(envOf()) as unknown as { handler: unknown; options: BuiltOptions };
    expect(typeof auth.handler).toBe('function');
    expect(auth.options.basePath).toBe('/api/auth');
    expect(auth.options.baseURL).toBe('https://projectsites.dev');
  });

  it('enables email + password', () => {
    expect(opts(envOf()).emailAndPassword?.enabled).toBe(true);
  });

  it('registers the magic-link + two-factor plugins', () => {
    const ids = (opts(envOf()).plugins ?? []).map((p) => p.id);
    expect(ids).toContain('magic-link');
    expect(ids).toContain('two-factor');
  });

  it('adds Google social only when GOOGLE_CLIENT_ID + SECRET are set', () => {
    expect(opts(envOf()).socialProviders).toBeUndefined();
    _resetAuthCache();
    expect(
      opts(envOf({ GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' })).socialProviders?.google
        ?.clientId,
    ).toBe('g');
  });

  it('caches the instance per isolate', () => {
    const env = envOf();
    expect(makeAuth(env)).toBe(makeAuth(env));
  });
});
