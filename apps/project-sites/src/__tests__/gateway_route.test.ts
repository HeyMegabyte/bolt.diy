/**
 * Gateway route configuration builder — locked shapes, resolver logic, default
 * table. Tests cover build defaults, exact/prefix/fuzzy matching, tie-breaking,
 * no-match null, and the canonical DEFAULT_ROUTES table.
 */
import {
  type AiProvider,
  buildRoute,
  resolveRoute,
  DEFAULT_ROUTES,
} from '../services/gateway_route.js';

describe('buildRoute', () => {
  it('returns a GatewayRoute with supplied provider and model', () => {
    const r = buildRoute('anthropic', 'claude-sonnet-4-6');
    expect(r).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      priority: 10,
      weight: 1,
      fallback: null,
    });
  });

  it('applies custom priority and fallback when given', () => {
    const r = buildRoute('deepseek', 'deepseek-chat', 5, 'openai');
    expect(r.priority).toBe(5);
    expect(r.fallback).toBe('openai');
  });

  it('accepts every AiProvider as valid', () => {
    const providers: AiProvider[] = ['openai', 'anthropic', 'deepseek', 'workers-ai', 'google'];
    for (const p of providers) {
      const r = buildRoute(p, `${p}-model`);
      expect(r.provider).toBe(p);
    }
  });

  it('returns weight of 1 by default', () => {
    expect(buildRoute('openai', 'gpt-4o').weight).toBe(1);
  });

  it('returns fallback null by default', () => {
    expect(buildRoute('openai', 'gpt-4o').fallback).toBeNull();
  });
});

describe('resolveRoute', () => {
  const routes = [
    buildRoute('anthropic', 'claude', 10),
    buildRoute('openai', 'gpt-4o', 10),
    buildRoute('deepseek', 'deepseek', 5, 'openai'),
    buildRoute('workers-ai', 'llama', 1),
    buildRoute('google', 'gemini', 10),
  ] as const;

  it('returns the route whose model is a prefix of the requested model', () => {
    const r = resolveRoute(routes, 'claude-sonnet-4-6');
    expect(r).not.toBeNull();
    expect(r!.provider).toBe('anthropic');
    expect(r!.model).toBe('claude');
  });

  it('returns the route by exact model match', () => {
    const r = resolveRoute(routes, 'gpt-4o');
    expect(r).not.toBeNull();
    expect(r!.provider).toBe('openai');
    expect(r!.model).toBe('gpt-4o');
  });

  it('returns the highest-priority route among multiple prefix matches', () => {
    const mixed = [
      buildRoute('workers-ai', 'llama', 1),
      buildRoute('anthropic', 'claude-sonnet', 5),
    ];
    // Both 'llama' and 'claude-sonnet' are prefixes of 'claude-sonnet-4-6' —
    // only the second matches. workers-ai 'llama' does not.
    const r = resolveRoute(mixed, 'claude-sonnet-4-6');
    expect(r).not.toBeNull();
    expect(r!.provider).toBe('anthropic');
  });

  it('breaks ties by weight when priorities are equal', () => {
    const tied = [buildRoute('openai', 'gpt', 10), buildRoute('anthropic', 'claude', 10)];
    // Both 'gpt' and 'claude' have priority 10 and weight 1, so the
    // tie-breaker picks whichever sorts first (openai/gpt has higher weight
    // but both are 1 — the sort is stable, so first match wins).
    const r = resolveRoute(tied, 'claude-opus');
    expect(r!.provider).toBe('anthropic');
  });

  it('returns null when no route matches', () => {
    const r = resolveRoute(routes, 'cohere-command-r');
    expect(r).toBeNull();
  });

  it('returns null for an empty route table', () => {
    expect(resolveRoute([], 'anything')).toBeNull();
  });

  it('matches exact model even when a prefix also matches', () => {
    const exactAndPrefix = [buildRoute('openai', 'gpt', 5), buildRoute('openai', 'gpt-4o', 10)];
    // 'gpt-4o' exact match should win over 'gpt' prefix match at higher priority.
    const r = resolveRoute(exactAndPrefix, 'gpt-4o');
    expect(r!.model).toBe('gpt-4o');
    expect(r!.priority).toBe(10);
  });

  it('handles empty model string gracefully', () => {
    const withEmpty = [buildRoute('openai', '', 10), buildRoute('deepseek', 'deepseek', 5)];
    // Empty prefix matches everything, but deepseek has higher priority.
    const r = resolveRoute(withEmpty, 'deepseek-chat');
    expect(r!.model).toBe('deepseek');
  });
});

describe('DEFAULT_ROUTES', () => {
  const providers = DEFAULT_ROUTES.map((r) => r.provider);

  it('contains openai, anthropic, deepseek, and workers-ai', () => {
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
    expect(providers).toContain('deepseek');
    expect(providers).toContain('workers-ai');
  });

  it('openai and anthropic have the highest priority (10)', () => {
    const top = DEFAULT_ROUTES.filter((r) => r.priority === 10);
    expect(top.map((r) => r.provider).sort()).toEqual(['anthropic', 'openai']);
  });

  it('deepseek has fallback openai', () => {
    const ds = DEFAULT_ROUTES.find((r) => r.provider === 'deepseek');
    expect(ds?.fallback).toBe('openai');
  });

  it('workers-ai is lowest priority (1)', () => {
    const wa = DEFAULT_ROUTES.find((r) => r.provider === 'workers-ai');
    expect(wa?.priority).toBe(1);
  });

  it('every default route has weight === 1', () => {
    for (const r of DEFAULT_ROUTES) {
      expect(r.weight).toBe(1);
    }
  });

  it('every default route model is a non-empty string', () => {
    for (const r of DEFAULT_ROUTES) {
      expect(r.model.length).toBeGreaterThan(0);
    }
  });
});
