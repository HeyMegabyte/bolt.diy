import {
  buildSmokeSpec,
  validateSmokeResult,
  summarizeSmoke,
  type SmokeEndpoint,
} from '../services/smoke_matrix.js';

describe('buildSmokeSpec (AP16 smoke_matrix)', () => {
  it('derives host + label from endpoints', () => {
    const specs = buildSmokeSpec([
      { path: '/health', label: 'Health check' },
      { path: '/api/feature-flags', subdomain: 'app', method: 'POST', expectStatus: 201 },
    ]);
    expect(specs[0].method).toBe('GET');
    expect(specs[1].path).toBe('/api/feature-flags');
    expect(specs[1].expectStatus).toBe(201);
    expect(specs[1].method).toBe('POST');
  });

  it('treats subdomain "*" as a wildcard placeholder in the derived label', () => {
    const specs = buildSmokeSpec([{ path: '/', subdomain: '*' }]);
    expect(specs[0].label).toBe('GET {site}.projectsites.dev/');
  });
});

describe('validateSmokeResult (AP16)', () => {
  const base: SmokeEndpoint = { path: '/', method: 'GET', expectStatus: 200, label: 'Home' };

  it('passes when everything matches', () => {
    const r = validateSmokeResult(base, 200, '<html lang="en"><head>', 42);
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.durationMs).toBe(42);
  });

  it('flags a status mismatch', () => {
    const r = validateSmokeResult(base, 500, '', 10);
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('expected status 200, got 500');
  });

  it('flags a missing required body substring', () => {
    const ep: SmokeEndpoint = { ...base, bodyContains: 'dashboard' };
    const r = validateSmokeResult(ep, 200, 'no match here', 5);
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('should contain'))).toBe(true);
  });

  it('flags a banned body substring', () => {
    const ep: SmokeEndpoint = { ...base, bodyNotContains: 'error' };
    const r = validateSmokeResult(ep, 200, 'there was an error', 5);
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('contains banned'))).toBe(true);
  });

  it('checks header assertions (equals + present)', () => {
    const ep: SmokeEndpoint = {
      ...base,
      headerEquals: { key: 'strict-transport-security', value: 'max-age=31536000' },
      headerPresent: 'content-security-policy',
    };
    const r = validateSmokeResult(ep, 200, '', 8, {
      'strict-transport-security': 'max-age=31536000',
      'content-security-policy': "default-src 'self'",
    });
    expect(r.pass).toBe(true);
  });

  it('flags a header mismatch + missing header', () => {
    const ep: SmokeEndpoint = {
      ...base,
      headerEquals: { key: 'x-frame-options', value: 'DENY' },
      headerPresent: 'x-missing',
    };
    const r = validateSmokeResult(ep, 200, '', 8, { 'x-frame-options': 'SAMEORIGIN' });
    expect(r.failures).toHaveLength(2);
  });
});

describe('summarizeSmoke (AP16)', () => {
  it('all-passing → pass:true', () => {
    const r = validateSmokeResult({ path: '/', label: 'x' }, 200, '', 1);
    const s = summarizeSmoke([r]);
    expect(s.pass).toBe(true);
    expect(s.passCount).toBe(1);
  });

  it('any failure → pass:false; empty list → pass:false', () => {
    const r = validateSmokeResult({ path: '/', expectStatus: 201, label: 'x' }, 200, '', 1);
    expect(summarizeSmoke([r]).pass).toBe(false);
    expect(summarizeSmoke([]).pass).toBe(false);
  });
});
