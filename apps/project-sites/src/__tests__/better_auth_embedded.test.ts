/**
 * better_auth_embedded — the embedded Better Auth factory (ADR-0006).
 *
 * Locks the factory's CONFIG + plugin wiring (the part we own). The ESM better-auth
 * lib + Kysely are mocked at the boundary (jest can't import their ESM), so we assert
 * the OPTIONS our factory passes: CF-native hardening (cookieCache off, KV secondary
 * storage with TTL floor, KV rate limiting, email verification) + the plugin set.
 */
jest.mock('better-auth', () => ({ betterAuth: (options) => ({ options, handler: jest.fn() }) }));
jest.mock('better-auth/plugins', () => ({
  magicLink: () => ({ id: 'magic-link' }),
  twoFactor: () => ({ id: 'two-factor' }),
  admin: () => ({ id: 'admin' }),
  anonymous: () => ({ id: 'anonymous' }),
  username: () => ({ id: 'username' }),
  haveIBeenPwned: () => ({ id: 'haveibeenpwned' }),
  multiSession: () => ({ id: 'multi-session' }),
  oneTap: () => ({ id: 'one-tap' }),
  emailOTP: () => ({ id: 'email-otp' }),
  organization: () => ({ id: 'organization' }),
  captcha: () => ({ id: 'captcha' }),
}));
jest.mock('better-auth/plugins/access', () => ({
  createAccessControl: () => ({ newRole: (s) => ({ statements: s }) }),
}));
jest.mock('kysely', () => ({ Kysely: class {} }));
jest.mock('kysely-d1', () => ({ D1Dialect: class {} }));
jest.mock('../platform/email-router.js', () => ({
  getEmailProvider: () => ({ sendTransactional: jest.fn() }),
}));

import { makeAuth, _resetAuthCache } from '../auth/better-auth.js';

function envOf(extra = {}) {
  return {
    DB: {},
    CACHE_KV: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
    BETTER_AUTH_SECRET: 'x'.repeat(40),
    ...extra,
  };
}
const opts = (env) => makeAuth(env).options;

describe('makeAuth (embedded Better Auth)', () => {
  beforeEach(() => _resetAuthCache());

  it('mounts at /api/auth on the app origin, no localhost trusted origin', () => {
    const o = opts(envOf());
    expect(o.basePath).toBe('/api/auth');
    expect(o.baseURL).toBe('https://projectsites.dev');
    expect(o.trustedOrigins.some((x) => /localhost/.test(x))).toBe(false);
  });

  it('disables cookieCache (#4203) + sets session refresh', () => {
    const s = opts(envOf()).session;
    expect(s.cookieCache.enabled).toBe(false);
    expect(s.updateAge).toBeGreaterThan(0);
  });

  it('floors KV secondaryStorage TTL to >=60s (#7124)', async () => {
    const env = envOf();
    await opts(env).secondaryStorage.set('k', 'v', 10);
    expect(env.CACHE_KV.put).toHaveBeenCalledWith('ba:k', 'v', { expirationTtl: 60 });
  });

  it('enables KV-backed rate limiting + email verification', () => {
    const o = opts(envOf());
    expect(o.rateLimit.enabled).toBe(true);
    expect(o.rateLimit.storage).toBe('secondary-storage');
    expect(o.emailAndPassword.requireEmailVerification).toBe(true);
  });

  it('registers the full plugin set', () => {
    const ids = opts(envOf({ TURNSTILE_SECRET_KEY: 't' })).plugins.map((p) => p.id);
    for (const id of [
      'magic-link',
      'two-factor',
      'organization',
      'admin',
      'anonymous',
      'username',
      'multi-session',
      'one-tap',
      'email-otp',
      'haveibeenpwned',
      'captcha',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('omits captcha when TURNSTILE_SECRET_KEY is unset', () => {
    const ids = opts(envOf()).plugins.map((p) => p.id);
    expect(ids).not.toContain('captcha');
  });

  it('adds Google social only when GOOGLE_CLIENT_ID + SECRET set', () => {
    expect(opts(envOf()).socialProviders.google).toBeUndefined();
    _resetAuthCache();
    expect(
      opts(envOf({ GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' })).socialProviders.google
        .clientId,
    ).toBe('g');
  });
});
