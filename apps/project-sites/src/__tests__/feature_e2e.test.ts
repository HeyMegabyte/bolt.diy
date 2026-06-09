import { checksFor, resolveCheckUrl, type E2eCheck } from '../routes/feature_e2e';

describe('feature_e2e check registry', () => {
  it('returns real HTTP checks for known platform flags', () => {
    const checks = checksFor('llms_txt');
    expect(checks.length).toBeGreaterThanOrEqual(1);
    expect(checks.every((c) => typeof c.label === 'string' && c.label.length > 0)).toBe(true);
    expect(checks.some((c) => c.url === '/llms.txt')).toBe(true);
  });

  it('mcp_server check asserts the tools list', () => {
    const c = checksFor('mcp_server')[0];
    expect(c.kind).toBe('http');
    expect(c.bodyIncludes).toBe('tools');
  });

  it('UI-only features use a browser check with a selector', () => {
    const c = checksFor('core_feature_flags')[0];
    expect(c.kind).toBe('browser');
    expect(c.selector).toContain('ff-layer-heading');
  });

  it('falls back to a homepage smoke check for unknown keys', () => {
    const checks = checksFor('totally_unknown_flag');
    expect(checks).toHaveLength(1);
    expect(checks[0].kind).toBe('http');
    expect(checks[0].url).toBe('/');
    expect(checks[0].label).toContain('totally_unknown_flag');
  });

  it('every registered check has an English (no curl/HTTP-verb) label', () => {
    for (const key of ['llms_txt', 'mcp_server', 'public_api', 'core_feature_flags']) {
      for (const c of checksFor(key)) {
        expect(c.label).not.toMatch(/\b(GET|POST|curl)\b/);
      }
    }
  });

  describe('resolveCheckUrl', () => {
    it('prefixes a path with the prod origin', () => {
      expect(resolveCheckUrl({ label: 'x', kind: 'http', url: '/llms.txt' } as E2eCheck)).toBe('https://projectsites.dev/llms.txt');
    });
    it('leaves an absolute URL untouched', () => {
      const abs = 'https://example.com/x';
      expect(resolveCheckUrl({ label: 'x', kind: 'http', url: abs } as E2eCheck)).toBe(abs);
    });
  });
});
