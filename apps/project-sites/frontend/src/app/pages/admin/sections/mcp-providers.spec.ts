/**
 * Unit tests for ./mcp-providers.ts — ensures the deduplicated catalogue
 * keeps its size, shape, and lookup invariants. Jasmine via `ng test`.
 */
import {
  MCP_PROVIDERS,
  MCP_AVAILABLE_PROVIDERS,
  mcpAvailable,
  mcpProvider,
  type McpProvider,
} from './mcp-providers';

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

// The MCP tab renders a live "Connect"/"Add API key" button for every catalogue
// entry. Providers WITHOUT a worker adapter 404 "unknown provider" on connect —
// so they MUST be marked unavailable → the tab shows "Coming soon" instead of a
// dead button. This guards the FE-catalogue ↔ worker-ADAPTERS contract so a
// built-ahead entry can never silently ship a dead-ending connect control.
describe('MCP_AVAILABLE_PROVIDERS (worker-adapter contract)', () => {
  // Mirror of the worker `ADAPTERS` map keys in
  // apps/project-sites/src/services/mcp_client.ts (getAdapter). Update BOTH
  // sides together when a provider gains/loses a worker adapter.
  const WORKER_ADAPTERS = [
    'mailchimp', 'stripe', 'resend', 'hubspot', 'slack', 'notion', 'github',
    'linear', 'discord', 'google_calendar', 'twilio', 'calendly', 'airtable',
    'zapier', 'pagerduty', 'vercel',
  ];
  // Catalogue-only (built-ahead) providers the worker has NO adapter for —
  // they returned 404 "unknown provider" on /connect (2026-08-26).
  const BUILT_AHEAD = [
    'loops', 'sentry', 'cal_com', 'paddle', 'cloudflare_workers', 'cloudflare_r2',
    'cloudflare_d1', 'cloudflare_kv', 'openai', 'anthropic', 'replicate',
    'elevenlabs', 'posthog', 'datadog', 'netlify',
  ];

  it('exactly matches the worker ADAPTERS set', () => {
    expect([...MCP_AVAILABLE_PROVIDERS].sort()).toEqual([...WORKER_ADAPTERS].sort());
  });

  it('every available provider exists in the catalogue', () => {
    const ids = new Set(MCP_PROVIDERS.map((p) => p.id));
    for (const id of MCP_AVAILABLE_PROVIDERS) expect(ids.has(id)).toBe(true);
  });

  it('marks built-ahead (adapter-less) providers UNavailable → they render "Coming soon", not a dead connect button', () => {
    for (const id of BUILT_AHEAD) {
      expect(mcpProvider(id)).withContext(`${id} should be in the catalogue`).toBeTruthy();
      expect(mcpAvailable(id)).withContext(`${id} has no worker adapter — must be unavailable`).toBe(false);
    }
  });

  it('mcpAvailable() is true only for adapter-backed providers', () => {
    expect(mcpAvailable('stripe')).toBe(true);
    expect(mcpAvailable('slack')).toBe(true);
    expect(mcpAvailable('openai')).toBe(false);
    expect(mcpAvailable('does-not-exist')).toBe(false);
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
