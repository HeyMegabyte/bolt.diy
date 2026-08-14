import { checksFor, resolveCheckUrl, type E2eCheck } from '../routes/feature_e2e';

// Representative current registry flags spanning UI + backend + core surfaces.
const REGISTERED = [
  'token_burn_meter',
  'site_analytics',
  'mcp_server',
  'app_launcher',
  'outbound_webhooks',
  'core_feature_flags',
];

describe('feature_e2e check registry', () => {
  it('gives every registered flag a HANDFUL (>=3) of parallel, well-formed checks', () => {
    for (const key of REGISTERED) {
      const checks = checksFor(key);
      expect(checks.length).toBeGreaterThanOrEqual(3); // a handful that run concurrently
      for (const c of checks) {
        expect(typeof c.label).toBe('string');
        expect(c.label.length).toBeGreaterThan(0);
        expect(['http', 'browser']).toContain(c.kind);
        expect(c.url.startsWith('/') || c.url.startsWith('http')).toBe(true);
      }
    }
  });

  it('mcp_server exercises the platform MCP discovery + JSON-RPC surface', () => {
    const checks = checksFor('mcp_server');
    expect(checks.some((c) => c.url.includes('/.well-known/mcp') || c.url === '/api/mcp')).toBe(
      true,
    );
  });

  it('a UI flag carries a browser check with a selector', () => {
    const browserChecks = checksFor('core_feature_flags').filter((c) => c.kind === 'browser');
    expect(browserChecks.length).toBeGreaterThanOrEqual(1);
    expect(browserChecks[0].selector).toBeTruthy();
  });

  it('falls back to a homepage smoke check for unknown keys', () => {
    const checks = checksFor('totally_unknown_flag');
    expect(checks).toHaveLength(1);
    expect(checks[0].kind).toBe('http');
    expect(checks[0].url).toBe('/');
    expect(checks[0].label).toContain('totally_unknown_flag');
  });

  it('every registered check has an English (no curl/HTTP-verb) label', () => {
    for (const key of REGISTERED) {
      for (const c of checksFor(key)) {
        expect(c.label).not.toMatch(/\b(GET|POST|PUT|DELETE|curl)\b/);
      }
    }
  });

  describe('resolveCheckUrl', () => {
    it('prefixes a path with the prod origin', () => {
      expect(resolveCheckUrl({ label: 'x', kind: 'http', url: '/llms.txt' } as E2eCheck)).toBe(
        'https://projectsites.dev/llms.txt',
      );
    });
    it('leaves an absolute URL untouched', () => {
      const abs = 'https://example.com/x';
      expect(resolveCheckUrl({ label: 'x', kind: 'http', url: abs } as E2eCheck)).toBe(abs);
    });
  });
});
