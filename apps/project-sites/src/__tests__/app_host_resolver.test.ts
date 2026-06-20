/**
 * Unit coverage for the Phase-1 app host-map resolver
 * (`services/app_host_resolver.ts`) — the KV-backed host → app-instance map that
 * lets the Worker resolve the default `{sub}.app.projectsites.dev` hostname AND
 * future customer CNAMEs without a per-request D1 query.
 */
import {
  AppHostError,
  AppHostMappingSchema,
  appHostKey,
  clearAppHost,
  defaultAppHostname,
  resolveAppHost,
  setAppHost,
  type AppHostMapping,
} from '../services/app_host_resolver';

/** Minimal in-memory KV stub matching the bits the resolver uses. */
function makeKv(): { CACHE_KV: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const CACHE_KV = {
    get: async (key: string, _type?: 'json') => {
      const v = store.get(key);
      return v === undefined ? null : JSON.parse(v);
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
  return { CACHE_KV, store };
}

const MAPPING: AppHostMapping = {
  instanceId: 'inst-1',
  appSlug: 'umami',
  orgId: 'org-1',
  subdomain: 'acme',
};

describe('app_host_resolver', () => {
  it('defaultAppHostname builds the platform hostname (lower-cased)', () => {
    expect(defaultAppHostname('Acme')).toBe('acme.app.projectsites.dev');
  });

  it('appHostKey namespaces + lower-cases the hostname', () => {
    expect(appHostKey('Acme.App.ProjectSites.dev')).toBe('apphost:acme.app.projectsites.dev');
  });

  it('setAppHost → resolveAppHost round-trips the mapping', async () => {
    const env = makeKv();
    await setAppHost(env, defaultAppHostname('acme'), MAPPING);
    const got = await resolveAppHost(env, 'acme.app.projectsites.dev');
    expect(got).toEqual(MAPPING);
  });

  it('resolution is case-insensitive (DNS is)', async () => {
    const env = makeKv();
    await setAppHost(env, 'app.acme.com', MAPPING);
    expect(await resolveAppHost(env, 'APP.ACME.COM')).toEqual(MAPPING);
  });

  it('resolveAppHost returns null for an unmapped hostname', async () => {
    const env = makeKv();
    expect(await resolveAppHost(env, 'nope.app.projectsites.dev')).toBeNull();
  });

  it('resolveAppHost returns null (never throws) on a malformed KV value', async () => {
    const env = makeKv();
    env.store.set(appHostKey('bad.app.projectsites.dev'), JSON.stringify({ instanceId: 'x' })); // missing fields
    expect(await resolveAppHost(env, 'bad.app.projectsites.dev')).toBeNull();
  });

  it('setAppHost rejects an invalid mapping (typed error, nothing written)', async () => {
    const env = makeKv();
    await expect(
      setAppHost(env, 'x.app.projectsites.dev', {
        instanceId: '',
        appSlug: 'u',
        orgId: 'o',
        subdomain: 's',
      }),
    ).rejects.toBeInstanceOf(AppHostError);
    expect(env.store.size).toBe(0);
  });

  it('clearAppHost removes the mapping (resolve → null after)', async () => {
    const env = makeKv();
    await setAppHost(env, defaultAppHostname('acme'), MAPPING);
    await clearAppHost(env, defaultAppHostname('acme'));
    expect(await resolveAppHost(env, 'acme.app.projectsites.dev')).toBeNull();
  });

  it('clearAppHost on an absent key is a no-op', async () => {
    const env = makeKv();
    await expect(clearAppHost(env, 'ghost.app.projectsites.dev')).resolves.toBeUndefined();
  });

  it('the mapping schema is strict (rejects unknown fields)', () => {
    expect(AppHostMappingSchema.safeParse({ ...MAPPING, extra: 1 }).success).toBe(false);
  });
});
