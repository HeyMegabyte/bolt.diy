/**
 * Route coverage for the `features` sub-app public/discovery surfaces that back
 * the LIVE platform flags (llms_txt, accessibility_statement, mcp_server,
 * public_api) plus the two control-plane reads:
 *   - GET /api/feature-flags        (System Admin / "Feature Flags" registry list)
 *   - GET /api/site-features        (owner Features catalog, plan-aware)
 *
 * These had ZERO tests. This spec also acts as a REGRESSION GUARD that the
 * 2026-06-07 registry trim (155→33) holds — removed flags must stay gone and
 * kept flags must stay present.
 *
 * No mocks: the discovery routes are self-contained; the flag/catalog reads run
 * against a null-returning D1 + KV stub (their documented safe fallback).
 */

import features from '../routes/features.js';

// D1 + KV stub whose reads all resolve empty → resolveFlag returns registry
// defaults, readOrgPlan falls back to 'free', site-feature state is empty.
const chain = {
  bind: () => chain,
  first: async () => null,
  all: async () => ({ results: [] }),
  run: async () => ({}),
};
const env = {
  DB: { prepare: () => chain },
  CACHE_KV: { get: async () => null, put: async () => undefined },
} as never;

const get = (path: string) => features.request(path, {}, env);

describe('features public discovery routes (LIVE flag surfaces)', () => {
  it('GET /llms.txt → 200 text/plain', async () => {
    const res = await get('/llms.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('Project Sites');
  });

  it('GET /llms-full.txt → 200', async () => {
    expect((await get('/llms-full.txt')).status).toBe(200);
  });

  it('GET /robots.txt → 200; training bots Disallowed, search/retrieval bots Allowed', async () => {
    const res = await get('/robots.txt');
    expect(res.status).toBe(200);
    const body = await res.text();
    // Parse `User-agent: X` groups → the directive line(s) until the next blank line.
    const groupFor = (ua: string): string => {
      const lines = body.split('\n');
      const i = lines.findIndex((l) => l.trim() === `User-agent: ${ua}`);
      if (i < 0) return '';
      const out: string[] = [];
      for (let j = i + 1; j < lines.length && lines[j].trim() !== ''; j++)
        out.push(lines[j].trim());
      return out.join(' ');
    };
    // Training-only crawlers must be fully disallowed (opt out of model training).
    for (const ua of [
      'GPTBot',
      'ClaudeBot',
      'Google-Extended',
      'CCBot',
      'Applebot-Extended',
      'Bytespider',
    ]) {
      expect(groupFor(ua)).toContain('Disallow: /');
      expect(groupFor(ua)).not.toContain('Allow: /');
    }
    // Search/retrieval crawlers must be allowed (keeps the site cited in AI answers).
    for (const ua of ['OAI-SearchBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot']) {
      expect(groupFor(ua)).toContain('Allow: /');
    }
  });

  it('GET /accessibility → 200 HTML with WCAG statement', async () => {
    const res = await get('/accessibility');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('WCAG 2.2');
  });

  it('GET /.well-known/mcp → 200 JSON', async () => {
    expect((await get('/.well-known/mcp')).status).toBe(200);
  });

  it('GET /.well-known/oauth-protected-resource → 200', async () => {
    expect((await get('/.well-known/oauth-protected-resource')).status).toBe(200);
  });

  it('GET /api/openapi.json → 200 OpenAPI 3.1', async () => {
    const res = await get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { openapi: string }).openapi).toBe('3.1.0');
  });

  it('GET /api/cli/version → 200 with commands', async () => {
    const res = await get('/api/cli/version');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { commands: string[] }).commands).toContain('deploy');
  });
});

describe('GET /api/feature-flags (registry list + trim regression guard)', () => {
  it('returns the registry with a consistent count', async () => {
    const res = await get('/api/feature-flags');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { flags: Array<{ key: string }>; count: number };
    expect(json.count).toBe(json.flags.length);
    expect(json.count).toBeGreaterThan(20);
    // Trim-regression TRIPWIRE, not a hard spec: the 2026-06-07 trim cut the
    // registry 155→33; deliberate feature waves have since grown it to ~90.
    // <120 trips only if the registry balloons back toward pre-trim sprawl —
    // raise this consciously (with a wave rationale) rather than reflexively.
    expect(json.count).toBeLessThan(120);
  });

  it('KEEPS the core + surviving flags', async () => {
    const keys = (
      (await (await get('/api/feature-flags')).json()) as { flags: Array<{ key: string }> }
    ).flags.map((f) => f.key);
    for (const k of [
      'core_auth',
      'core_billing',
      'core_feature_flags',
      'mcp_server',
      'public_api',
      'abuse_takedown',
    ]) {
      expect(keys).toContain(k);
    }
  });

  it('EXCLUDES the 2026-06-07 removed flags (trim holds)', async () => {
    const keys = (
      (await (await get('/api/feature-flags')).json()) as { flags: Array<{ key: string }> }
    ).flags.map((f) => f.key);
    for (const k of [
      'crm_engine',
      'cdp_engine',
      'lms_engine',
      'dunning_recovery',
      'stripe_meters',
      'ecommerce_engine',
      // NOTE: native_booking_engine was trimmed 2026-06-07 but legitimately
      // RE-ADDED as a real feature module by the platform-foundation wave
      // (P1 feature #3 in FEATURE_CATALOG). It is intentionally in the
      // registry now — not a trim violation.
      'membership_paywall',
      // NOTE: swarm_editor is NOT in this list — it is an INTENTIONAL deprecated
      // drift-shim flag that stays registered on purpose (Brian: never delete;
      // memory feedback_alias_modules_intentional). Asserting its removal was the
      // stale part of this guard.
      'public_api_v1',
    ]) {
      expect(keys).not.toContain(k);
    }
  });
});

describe('GET /api/feature-flags/:key', () => {
  it('200s with definition + resolved state for a known flag', async () => {
    const res = await get('/api/feature-flags/core_auth');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      definition: { key: string };
      resolved: { enabled: boolean };
    };
    expect(json.definition.key).toBe('core_auth');
    expect(typeof json.resolved.enabled).toBe('boolean');
  });

  it('404s for an unknown flag', async () => {
    expect((await get('/api/feature-flags/totally_unknown_flag')).status).toBe(404);
  });
});

describe('GET /api/site-features (owner catalog, plan-aware)', () => {
  it('returns the owner feature catalog with a fallback free plan', async () => {
    const res = await get('/api/site-features');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      features: Array<{ key: string; entitled: string }>;
      plan: string;
    };
    expect(json.plan).toBe('free');
    // The SITE_FEATURE_CATALOG (child-site features) was fully removed 2026-08-13
    // per Brian's directive; the endpoint still returns a well-formed empty catalog.
    expect(Array.isArray(json.features)).toBe(true);
  });
});

describe('POST /api/site-features/:key', () => {
  const post = (path: string, body: unknown) =>
    features.request(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      env,
    );

  it('404s for a key not in the catalog', async () => {
    expect((await post('/api/site-features/not_a_feature', { site_id: 's1' })).status).toBe(404);
  });

  // The 400-on-invalid-body-for-a-real-key case was dropped when the child-site
  // SITE_FEATURE_CATALOG was fully removed (2026-08-13) — no catalog keys remain,
  // so every key now takes the not-in-catalog 404 path covered above.
});
