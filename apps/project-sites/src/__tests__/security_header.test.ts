import { buildHeaders, validateHeaders, DEFAULT_CSP } from '../services/security_header.js';
import type { SecurityHeaders } from '../services/security_header.js';

describe('DEFAULT_CSP', () => {
  it('includes essential directives', () => {
    expect(DEFAULT_CSP).toContain("default-src 'self'");
    expect(DEFAULT_CSP).toContain("script-src 'self'");
    expect(DEFAULT_CSP).toContain("style-src 'self'");
    expect(DEFAULT_CSP).toContain('img-src');
    expect(DEFAULT_CSP).toContain('connect-src');
    expect(DEFAULT_CSP).toContain('frame-ancestors');
    expect(DEFAULT_CSP).toContain('base-uri');
    expect(DEFAULT_CSP).toContain('form-action');
  });

  it('blocks framing from unknown origins', () => {
    expect(DEFAULT_CSP).toContain("frame-ancestors 'none'");
  });
});

describe('buildHeaders', () => {
  it('returns all six security headers with no args', () => {
    const h = buildHeaders();
    expect(h['strict-transport-security']).toBeTruthy();
    expect(h['content-security-policy']).toBeTruthy();
    expect(h['x-frame-options']).toBeTruthy();
    expect(h['x-content-type-options']).toBeTruthy();
    expect(h['referrer-policy']).toBeTruthy();
    expect(h['permissions-policy']).toBeTruthy();
  });

  it('uses the default CSP when no opts given', () => {
    const h = buildHeaders();
    expect(h['content-security-policy']).toBe(DEFAULT_CSP);
  });

  it('overrides the full CSP when csp is passed', () => {
    const custom = "default-src 'none'";
    const h = buildHeaders({ csp: custom });
    expect(h['content-security-policy']).toBe(custom);
  });

  it('overrides HSTS when hsts is passed', () => {
    const custom = 'max-age=3600';
    const h = buildHeaders({ hsts: custom });
    expect(h['strict-transport-security']).toBe(custom);
  });

  it('replaces frame-ancestors in the default CSP', () => {
    const h = buildHeaders({
      frameAncestors: "'self' https://example.com",
    });
    expect(h['content-security-policy']).toContain("frame-ancestors 'self' https://example.com");
  });

  it('replaces frame-ancestors in a custom CSP', () => {
    const h = buildHeaders({
      csp: "default-src 'self'; frame-ancestors 'none'; base-uri 'self'",
      frameAncestors: "'self'",
    });
    expect(h['content-security-policy']).toContain("frame-ancestors 'self'");
  });

  it('returns SAMEORIGIN for x-frame-options by default', () => {
    const h = buildHeaders();
    expect(h['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('returns nosniff for x-content-type-options', () => {
    const h = buildHeaders();
    expect(h['x-content-type-options']).toBe('nosniff');
  });

  it('returns strict-origin-when-cross-origin referrer-policy', () => {
    const h = buildHeaders();
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('returns a non-empty permissions-policy', () => {
    const h = buildHeaders();
    expect(h['permissions-policy'].length).toBeGreaterThan(0);
    expect(h['permissions-policy']).toContain('geolocation=()');
    expect(h['permissions-policy']).toContain('microphone=()');
    expect(h['permissions-policy']).toContain('camera=()');
  });
});

describe('validateHeaders', () => {
  it('passes a well-formed SecurityHeaders', () => {
    const result = validateHeaders(buildHeaders());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('reports missing headers', () => {
    const result = validateHeaders({} as SecurityHeaders);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(6);
    expect(result.issues[0]).toContain('missing header:');
  });

  it('reports empty header values', () => {
    const result = validateHeaders({
      'strict-transport-security': '',
      'content-security-policy': '',
      'x-frame-options': '',
      'x-content-type-options': '',
      'referrer-policy': '',
      'permissions-policy': '',
    });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(6);
  });

  it('flags an HSTS lacking max-age', () => {
    const h = buildHeaders({ hsts: 'includeSubDomains' });
    const result = validateHeaders(h);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('strict-transport-security: missing max-age directive');
  });

  it('flags a CSP lacking frame-ancestors', () => {
    const h = buildHeaders({ csp: "default-src 'self'" });
    const result = validateHeaders(h);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('content-security-policy: missing frame-ancestors directive');
  });

  it('flags a CSP lacking default-src', () => {
    const h = buildHeaders({ csp: "frame-ancestors 'none'" });
    const result = validateHeaders(h);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('content-security-policy: missing default-src directive');
  });

  it('flags an invalid x-frame-options value', () => {
    const h = buildHeaders();
    (h as Record<string, string>)['x-frame-options'] = 'ALLOWALL';
    const result = validateHeaders(h);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('x-frame-options: expected DENY or SAMEORIGIN, got ALLOWALL');
  });

  it('accepts DENY and SAMEORIGIN for x-frame-options', () => {
    const hDeny = buildHeaders();
    (hDeny as Record<string, string>)['x-frame-options'] = 'DENY';
    expect(validateHeaders(hDeny).valid).toBe(true);

    const hSame = buildHeaders(); // default is SAMEORIGIN
    expect(validateHeaders(hSame).valid).toBe(true);
  });

  it('flags a wrong x-content-type-options value', () => {
    const h = buildHeaders();
    (h as Record<string, string>)['x-content-type-options'] = 'sniff';
    const result = validateHeaders(h);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('x-content-type-options: expected nosniff, got sniff');
  });
});
