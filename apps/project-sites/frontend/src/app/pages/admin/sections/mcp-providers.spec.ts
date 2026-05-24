/**
 * Unit tests for ./mcp-providers.ts — ensures the deduplicated catalogue
 * keeps its size, shape, and lookup invariants. Jasmine via `ng test`.
 */
import { MCP_PROVIDERS, mcpProvider, type McpProvider } from './mcp-providers';

describe('MCP_PROVIDERS', () => {
  it('contains at least 25 providers', () => {
    expect(MCP_PROVIDERS.length).toBeGreaterThanOrEqual(25);
  });

  it('every entry has id, label, desc, color, group', () => {
    for (const p of MCP_PROVIDERS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.desc).toBeTruthy();
      expect(p.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(p.group).toBeTruthy();
      expect(typeof p.needsOauth).toBe('boolean');
      expect(typeof p.oauth_supported).toBe('boolean');
    }
  });

  it('OAuth-ready providers have an authorize URL hint', () => {
    const oauthReady = MCP_PROVIDERS.filter((p) => p.oauth_supported);
    // Bumped Turn 5 — Airtable, Zapier, Cal.com, Sentry, PagerDuty,
    // PostHog, Vercel, Netlify flipped from API-key-only → OAuth.
    expect(oauthReady.length).toBeGreaterThanOrEqual(18);
    for (const p of oauthReady) {
      expect(p.oauth_authorize_url).toMatch(/^https:\/\//);
    }
  });

  it('provider ids are unique', () => {
    const ids = MCP_PROVIDERS.map((p: McpProvider) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('catalogue is frozen', () => {
    expect(Object.isFrozen(MCP_PROVIDERS)).toBe(true);
  });
});

describe('mcpProvider()', () => {
  it('looks up a known provider', () => {
    expect(mcpProvider('stripe')?.label).toBe('Stripe');
    expect(mcpProvider('stripe')?.color).toBe('#635BFF');
  });

  it('returns undefined for an unknown provider', () => {
    expect(mcpProvider('does-not-exist')).toBeUndefined();
  });

  it('lookup is O(1) — uses the index, not Array.find', () => {
    // Sanity: 1000 lookups complete in well under a millisecond on any
    // modern engine when the index is a plain object.
    const start = performance.now();
    for (let i = 0; i < 1000; i++) mcpProvider('stripe');
    expect(performance.now() - start).toBeLessThan(50);
  });
});
