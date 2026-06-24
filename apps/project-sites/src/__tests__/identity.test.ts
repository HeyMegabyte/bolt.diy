/**
 * §27/§28/ADR-0006 — app-auth identity layer. The port Fake, the Logto OIDC
 * adapter + WorkOS SSO adapter (mocked fetch), and the factory selection (Logto
 * default, WorkOS for enterprise, null → custom auth stays live).
 */
import { FakeIdentityProvider, IdentityProviderError } from '../platform/identity.js';
import { LogtoIdentityProvider } from '../services/logto_provider.js';
import { WorkOsEnterpriseIdentityProvider } from '../services/workos_provider.js';
import { getIdentityProvider } from '../middleware/identity.js';
import { LogtoIdentityProvider as Logto } from '../services/logto_provider.js';
import { WorkOsEnterpriseIdentityProvider as WorkOs } from '../services/workos_provider.js';
import type { Env } from '../types/env.js';

/** A fetch stub returning the given JSON for each successive call. */
function fetchSeq(...responses: Array<{ status?: number; json?: unknown }>): typeof fetch {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  (fn as unknown as { calls: typeof calls }).calls = calls;
  return fn;
}

describe('FakeIdentityProvider', () => {
  it('returns the configured user from handleCallback + validateSession', async () => {
    const u = { subject: 's1', email: 'a@b.com', name: 'A', provider: 'logto' as const };
    const p = new FakeIdentityProvider(u);
    expect(await p.handleCallback({ code: 'c', redirectUri: 'r' })).toEqual(u);
    expect(await p.validateSession('tok')).toEqual({ valid: true, user: u });
    expect(await p.validateSession('')).toEqual({ valid: false, reason: 'no token' });
  });
});

describe('LogtoIdentityProvider', () => {
  const cfg = { endpoint: 'https://t.logto.app/', appId: 'app1', appSecret: 'sec' };

  it('builds the OIDC authorize URL', async () => {
    const p = new LogtoIdentityProvider({ ...cfg, fetchImpl: fetchSeq() });
    const url = await p.createLoginUrl({ redirectUri: 'https://x/cb', state: 'st8' });
    expect(url).toContain('https://t.logto.app/oidc/auth?');
    expect(url).toContain('client_id=app1');
    expect(url).toContain('state=st8');
    expect(url).toContain('response_type=code');
  });

  it('exchanges code → access token → userinfo on callback', async () => {
    const fetchImpl = fetchSeq(
      { json: { access_token: 'at1' } }, // token endpoint
      { json: { sub: 'logto-sub', email: 'u@x.com', name: 'U' } }, // userinfo
    );
    const p = new LogtoIdentityProvider({ ...cfg, fetchImpl });
    const user = await p.handleCallback({ code: 'c', redirectUri: 'https://x/cb' });
    expect(user).toEqual({ subject: 'logto-sub', email: 'u@x.com', name: 'U', provider: 'logto' });
  });

  it('throws IdentityProviderError on a non-2xx token exchange', async () => {
    const p = new LogtoIdentityProvider({ ...cfg, fetchImpl: fetchSeq({ status: 401 }) });
    await expect(p.handleCallback({ code: 'c', redirectUri: 'r' })).rejects.toBeInstanceOf(
      IdentityProviderError,
    );
  });
});

describe('WorkOsEnterpriseIdentityProvider', () => {
  const cfg = { apiKey: 'sk_test', clientId: 'client_1' };

  it('builds an org-scoped SSO authorize URL', async () => {
    const p = new WorkOsEnterpriseIdentityProvider({ ...cfg, fetchImpl: fetchSeq() });
    const url = await p.createLoginUrl({ redirectUri: 'https://x/cb', state: 's', organizationId: 'org_9' });
    expect(url).toContain('https://api.workos.com/sso/authorize?');
    expect(url).toContain('organization=org_9');
  });

  it('maps the SSO profile to a user on callback', async () => {
    const fetchImpl = fetchSeq({
      json: { profile: { id: 'wos_1', email: 'e@corp.com', first_name: 'E', last_name: 'Corp', organization_id: 'org_9' } },
    });
    const p = new WorkOsEnterpriseIdentityProvider({ ...cfg, fetchImpl });
    const user = await p.handleCallback({ code: 'c', redirectUri: 'r' });
    expect(user).toEqual({
      subject: 'wos_1',
      email: 'e@corp.com',
      name: 'E Corp',
      provider: 'workos',
      organizationId: 'org_9',
    });
  });
});

describe('getIdentityProvider factory (ADR-0006 selection)', () => {
  const logtoEnv = { LOGTO_ENDPOINT: 'https://t.logto.app', LOGTO_APP_ID: 'a', LOGTO_APP_SECRET: 's' } as Env;
  const workosEnv = { ...logtoEnv, WORKOS_API_KEY: 'k', WORKOS_CLIENT_ID: 'c' } as Env;

  it('defaults to Logto when configured', () => {
    expect(getIdentityProvider(logtoEnv)).toBeInstanceOf(Logto);
  });

  it('uses WorkOS for an enterprise login when configured', () => {
    expect(getIdentityProvider(workosEnv, { enterprise: true })).toBeInstanceOf(WorkOs);
  });

  it('still prefers Logto for a non-enterprise login even when WorkOS is configured', () => {
    expect(getIdentityProvider(workosEnv)).toBeInstanceOf(Logto);
  });

  it('returns null when neither is configured (custom auth stays live)', () => {
    expect(getIdentityProvider({} as Env)).toBeNull();
  });
});
