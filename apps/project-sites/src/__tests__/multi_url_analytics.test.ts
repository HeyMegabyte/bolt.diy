import { parseRange, apexDomain } from '../services/multi_url_analytics';

/**
 * Guards the two pure helpers the admin Analytics surface depends on:
 *  - parseRange: coerces the `?range=` query value to a known range (drives the
 *    CF GraphQL window); anything unknown → '7d' default.
 *  - apexDomain: hostname → registrable apex for CF zone resolution; a wrong
 *    apex resolves the WRONG zone → wrong analytics. Locks www/wildcard strip,
 *    projectsites.dev short-circuit, last-2-labels fallback, and the DOCUMENTED
 *    multi-label-TLD limitation (.co.uk → 'co.uk') so a future fix updates this
 *    test deliberately rather than silently.
 */
describe('parseRange', () => {
  it('maps known ranges', () => {
    expect(parseRange('24h')).toBe('24h');
    expect(parseRange('1d')).toBe('24h'); // legacy alias
    expect(parseRange('30d')).toBe('30d');
    expect(parseRange('90d')).toBe('90d');
    expect(parseRange('7d')).toBe('7d');
  });

  it('defaults unknown / null / undefined to 7d', () => {
    expect(parseRange('garbage')).toBe('7d');
    expect(parseRange('')).toBe('7d');
    expect(parseRange(null)).toBe('7d');
    expect(parseRange(undefined)).toBe('7d');
  });
});

describe('apexDomain', () => {
  it('returns the apex for a plain subdomain (last two labels)', () => {
    expect(apexDomain('shop.example.com')).toBe('example.com');
    expect(apexDomain('a.b.c.example.com')).toBe('example.com');
  });

  it('strips a leading www. and wildcard *.', () => {
    expect(apexDomain('www.example.com')).toBe('example.com');
    expect(apexDomain('*.example.com')).toBe('example.com');
    expect(apexDomain('*.www.example.com')).toBe('example.com');
  });

  it('lowercases the host', () => {
    expect(apexDomain('Shop.EXAMPLE.com')).toBe('example.com');
  });

  it('returns the apex itself when already 2 labels or a single label', () => {
    expect(apexDomain('example.com')).toBe('example.com');
    expect(apexDomain('localhost')).toBe('localhost');
  });

  it('short-circuits projectsites.dev subdomains to the apex', () => {
    expect(apexDomain('mysite.projectsites.dev')).toBe('projectsites.dev');
    expect(apexDomain('a.b.projectsites.dev')).toBe('projectsites.dev');
    expect(apexDomain('projectsites.dev')).toBe('projectsites.dev');
  });

  it('DOCUMENTED LIMITATION: multi-label TLDs resolve to the wrong apex', () => {
    // .co.uk is out of scope (see service JSDoc) — last-two-labels gives 'co.uk'.
    // If this ever gets fixed, update this expectation intentionally.
    expect(apexDomain('shop.example.co.uk')).toBe('co.uk');
  });
});
