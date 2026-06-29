import {
  buildRule,
  configSummary,
  DEFAULT_RULES,
  matchesRule,
} from '../services/rate_limit_config.js';

describe('buildRule', () => {
  it('returns a fully populated rule with explicit params', () => {
    const rule = buildRule('/api/*', ['GET'], 100, 30_000, 'user');
    expect(rule).toEqual({
      path: '/api/*',
      methods: ['GET'],
      maxRequests: 100,
      windowMs: 30_000,
      scope: 'user',
    });
  });

  it('applies defaults for windowMs and scope', () => {
    const rule = buildRule('/health', ['GET'], 60);
    expect(rule.windowMs).toBe(60_000);
    expect(rule.scope).toBe('ip');
  });

  it('accepts every scope variant without error', () => {
    for (const scope of ['global', 'ip', 'user', 'org'] as const) {
      const rule = buildRule('/x', ['GET'], 10, 60_000, scope);
      expect(rule.scope).toBe(scope);
    }
  });

  it('accepts multiple methods', () => {
    const rule = buildRule('/api/*', ['GET', 'POST', 'PUT'], 300);
    expect(rule.methods).toEqual(['GET', 'POST', 'PUT']);
  });

  it('accepts zero maxRequests (disable)', () => {
    const rule = buildRule('/debug', ['GET'], 0);
    expect(rule.maxRequests).toBe(0);
  });
});

describe('matchesRule', () => {
  const rule = buildRule('/api/*', ['GET', 'POST'], 100, 60_000, 'ip');

  it('matches a path within the wildcard scope', () => {
    expect(matchesRule(rule, '/api/sites', 'GET')).toBe(true);
    expect(matchesRule(rule, '/api/billing/checkout', 'POST')).toBe(true);
    expect(matchesRule(rule, '/api/auth/login', 'GET')).toBe(true);
  });

  it('rejects a path outside the wildcard scope', () => {
    expect(matchesRule(rule, '/health', 'GET')).toBe(false);
    expect(matchesRule(rule, '/admin/users', 'GET')).toBe(false);
    expect(matchesRule(rule, '/api', 'GET')).toBe(false);
  });

  it('rejects a method not in the rule', () => {
    expect(matchesRule(rule, '/api/sites', 'DELETE')).toBe(false);
    expect(matchesRule(rule, '/api/sites', 'PATCH')).toBe(false);
  });

  it('exact-match rule (no wildcard) matches only the exact path', () => {
    const exact = buildRule('/health', ['GET'], 60);
    expect(matchesRule(exact, '/health', 'GET')).toBe(true);
    expect(matchesRule(exact, '/healthcare', 'GET')).toBe(false);
    expect(matchesRule(exact, '/health/details', 'GET')).toBe(false);
  });

  it('matches a single-method rule correctly', () => {
    const getOnly = buildRule('/reports', ['GET'], 10);
    expect(matchesRule(getOnly, '/reports', 'GET')).toBe(true);
    expect(matchesRule(getOnly, '/reports', 'POST')).toBe(false);
  });

  it('wildcard-rule without extra path segments matches root of pattern', () => {
    const star = buildRule('/*', ['GET'], 50);
    expect(matchesRule(star, '/', 'GET')).toBe(true);
    expect(matchesRule(star, '/health', 'GET')).toBe(true);
    expect(matchesRule(star, '/api/sites', 'GET')).toBe(true);
  });
});

describe('configSummary', () => {
  it('returns zeros for an empty list', () => {
    const s = configSummary([]);
    expect(s.total).toBe(0);
    expect(s.byMethod).toEqual({});
    expect(s.strictest).toBeNull();
  });

  it('reports total count', () => {
    const s = configSummary(DEFAULT_RULES);
    expect(s.total).toBe(5);
  });

  it('reports the minimum maxRequests per method across all rules', () => {
    const s = configSummary(DEFAULT_RULES);
    // GET: auth/*=5 is the minimum
    expect(s.byMethod['GET']).toBe(5);
    // POST: auth/*=5 captures POST too (it has ['GET','POST'])
    expect(s.byMethod['POST']).toBe(5);
  });

  it('identifies the strictest rule (lowest maxRequests)', () => {
    const s = configSummary(DEFAULT_RULES);
    expect(s.strictest?.path).toBe('/api/auth/*');
    expect(s.strictest?.maxRequests).toBe(5);
  });

  it('breaks ties by shortest window when maxRequests are equal', () => {
    const rules = [buildRule('/a', ['GET'], 10, 120_000), buildRule('/b', ['GET'], 10, 60_000)];
    const s = configSummary(rules);
    expect(s.strictest?.path).toBe('/b');
    expect(s.strictest?.windowMs).toBe(60_000);
  });
});

describe('DEFAULT_RULES', () => {
  it('is frozen and cannot be mutated', () => {
    expect(Object.isFrozen(DEFAULT_RULES)).toBe(true);
    // Object.freeze is shallow — individual rule objects are not frozen
    // but the array ref itself cannot be reassigned/reordered
  });

  it('contains exactly 5 rules', () => {
    expect(DEFAULT_RULES).toHaveLength(5);
  });

  it.each([
    { idx: 0, path: '/health', methods: ['GET'], max: 60, scope: 'global' },
    {
      idx: 1,
      path: '/api/*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      max: 300,
      scope: 'ip',
    },
    { idx: 2, path: '/api/auth/*', methods: ['GET', 'POST'], max: 5, scope: 'ip' },
    { idx: 3, path: '/webhooks/*', methods: ['POST'], max: 100, scope: 'ip' },
    {
      idx: 4,
      path: '/admin/*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      max: 1000,
      scope: 'user',
    },
  ])(
    'rule[$idx] matches expected values ($path $max/min)',
    ({ idx, path, methods, max, scope }) => {
      const rule = DEFAULT_RULES[idx];
      expect(rule.path).toBe(path);
      expect(rule.methods).toEqual(methods);
      expect(rule.maxRequests).toBe(max);
      expect(rule.scope).toBe(scope);
    },
  );
});
