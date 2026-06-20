/**
 * Signed SiteCapabilityManifest — contract, plan defaults, HMAC sign/verify,
 * and the KV/R2 cache + resolve layer (Cloudflare-first doctrine §3).
 */
import {
  SiteCapabilityManifestSchema,
  buildManifest,
  canonicalManifestJson,
  signManifest,
  verifyManifest,
  cacheManifest,
  resolveManifest,
  type SiteCapabilityManifest,
} from '../services/site_capability_manifest.js';
import type { Env } from '../types/env.js';

const SECRET = 'test-hmac-secret-0123456789';

const base = (over: Partial<SiteCapabilityManifest> = {}): SiteCapabilityManifest => ({
  tenantId: 't1',
  siteId: 's1',
  hostname: 'acme.projectsites.dev',
  plan: 'pro',
  staticServing: true,
  db: 'neon_shared_shard',
  storage: 'r2',
  analytics: 'growth',
  sentry: 'dedicated',
  posthog: 'sampled',
  browserAutomation: 'cloudflare',
  aiGatewayBudgetMonthlyCents: 5000,
  featureFlags: { beta: true },
  manifestVersion: '1',
  release: 'rel-1',
  ...over,
});

describe('SiteCapabilityManifestSchema', () => {
  it('accepts a valid manifest and rejects unknown fields + bad enums', () => {
    expect(SiteCapabilityManifestSchema.safeParse(base()).success).toBe(true);
    expect(SiteCapabilityManifestSchema.safeParse({ ...base(), rogue: 1 }).success).toBe(false);
    expect(SiteCapabilityManifestSchema.safeParse({ ...base(), db: 'mysql' }).success).toBe(false);
  });
});

describe('buildManifest', () => {
  it('applies free-plan defaults', () => {
    const m = buildManifest({
      tenantId: 't',
      siteId: 's',
      hostname: 'h',
      plan: 'free',
      release: 'r',
    });
    expect(m).toMatchObject({
      db: 'none',
      posthog: 'none',
      aiGatewayBudgetMonthlyCents: 0,
      browserAutomation: 'cloudflare',
    });
  });

  it('applies enterprise-plan defaults + always defaults browser to cloudflare', () => {
    const m = buildManifest({
      tenantId: 't',
      siteId: 's',
      hostname: 'h',
      plan: 'enterprise',
      release: 'r',
    });
    expect(m).toMatchObject({
      db: 'neon_dedicated_project',
      sentry: 'dedicated',
      posthog: 'full_paid',
    });
    expect(m.browserAutomation).toBe('cloudflare');
  });

  it('honours overrides and re-validates the merged result', () => {
    const m = buildManifest({
      tenantId: 't',
      siteId: 's',
      hostname: 'h',
      plan: 'paid',
      release: 'r',
      overrides: { browserAutomation: 'browserbase_fallback', db: 'neon_dedicated_project' },
    });
    expect(m.browserAutomation).toBe('browserbase_fallback');
    expect(m.db).toBe('neon_dedicated_project');
    expect(() =>
      buildManifest({
        tenantId: 't',
        siteId: 's',
        hostname: 'h',
        plan: 'paid',
        release: 'r',
        overrides: { plan: 'bogus' as never },
      }),
    ).toThrow();
  });
});

describe('canonicalManifestJson', () => {
  it('is deterministic + key-sorted regardless of input key order', () => {
    const a = canonicalManifestJson(base());
    const reordered = Object.fromEntries(
      Object.entries(base()).reverse(),
    ) as SiteCapabilityManifest;
    expect(canonicalManifestJson(reordered)).toBe(a);
    expect(a.indexOf('"aiGatewayBudgetMonthlyCents"')).toBeLessThan(a.indexOf('"tenantId"'));
  });
});

describe('signManifest / verifyManifest', () => {
  it('round-trips a signed manifest', async () => {
    const signed = await signManifest(base(), SECRET);
    expect(signed.alg).toBe('HMAC-SHA256');
    expect(signed.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyManifest(signed, SECRET)).toEqual(base());
  });

  it('returns null on a tampered manifest', async () => {
    const signed = await signManifest(base(), SECRET);
    const tampered = { ...signed, manifest: { ...signed.manifest, plan: 'enterprise' as const } };
    expect(await verifyManifest(tampered, SECRET)).toBeNull();
  });

  it('returns null on the wrong secret', async () => {
    const signed = await signManifest(base(), SECRET);
    expect(await verifyManifest(signed, 'other-secret')).toBeNull();
  });
});

describe('cacheManifest + resolveManifest', () => {
  function kvStub() {
    const store = new Map<string, string>();
    return {
      store,
      kv: {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => {
          store.set(k, v);
        },
      } as unknown as Env['CACHE_KV'],
    };
  }

  it('caches under both KV keys + R2, then resolves a verified manifest by site or host', async () => {
    const { store, kv } = kvStub();
    const r2Puts: string[] = [];
    const r2 = {
      put: async (k: string) => {
        r2Puts.push(k);
      },
    } as unknown as Env['SITES_BUCKET'];
    const signed = await signManifest(base(), SECRET);

    await cacheManifest({ CACHE_KV: kv, SITES_BUCKET: r2 }, signed);
    expect(store.has('manifest:s1')).toBe(true);
    expect(store.has('host-manifest:acme.projectsites.dev')).toBe(true);
    expect(r2Puts).toEqual(['manifests/s1.json']);

    const env = { CACHE_KV: kv, MANIFEST_SIGNING_SECRET: SECRET } as Pick<
      Env,
      'CACHE_KV' | 'MANIFEST_SIGNING_SECRET' | 'MCP_ENCRYPTION_KEY'
    >;
    expect(await resolveManifest(env, { siteId: 's1' })).toEqual(base());
    expect(await resolveManifest(env, { hostname: 'ACME.projectsites.dev' })).toEqual(base());
    expect(await resolveManifest(env, { siteId: 'missing' })).toBeNull();
  });

  it('resolve returns null for a tampered KV entry', async () => {
    const { store, kv } = kvStub();
    const signed = await signManifest(base(), SECRET);
    const tampered = { ...signed, manifest: { ...signed.manifest, plan: 'enterprise' } };
    store.set('manifest:s1', JSON.stringify(tampered));
    const env = { CACHE_KV: kv, MANIFEST_SIGNING_SECRET: SECRET } as Pick<
      Env,
      'CACHE_KV' | 'MANIFEST_SIGNING_SECRET' | 'MCP_ENCRYPTION_KEY'
    >;
    expect(await resolveManifest(env, { siteId: 's1' })).toBeNull();
  });
});
