import { checkDomainHealth, expiryWarning, RENEWAL_WINDOWS } from '../services/domain_monitor.js';

describe('expiryWarning', () => {
  it('returns ok for >30 days', () => {
    const r = expiryWarning(45);
    expect(r.level).toBe('ok');
    expect(r.message).toContain('45 days');
  });

  it('returns ok for exactly 31 days', () => {
    const r = expiryWarning(31);
    expect(r.level).toBe('ok');
  });

  it('returns warning for 7–30 days', () => {
    const r = expiryWarning(14);
    expect(r.level).toBe('warning');
    expect(r.message).toContain('14 days');
    expect(r.message).toContain('renew soon');
  });

  it('returns warning at exactly 30 days', () => {
    const r = expiryWarning(30);
    expect(r.level).toBe('warning');
  });

  it('returns warning at exactly 7 days', () => {
    const r = expiryWarning(7);
    expect(r.level).toBe('warning');
  });

  it('returns critical for <7 days', () => {
    const r = expiryWarning(3);
    expect(r.level).toBe('critical');
    expect(r.message).toContain('3 days');
    expect(r.message).toContain('renew immediately');
  });

  it('returns critical for 0 days (expires today)', () => {
    const r = expiryWarning(0);
    expect(r.level).toBe('critical');
    expect(r.message).toContain('0 days');
    expect(r.message).toContain('renew immediately');
  });

  it('returns critical with past-tense for negative values', () => {
    const r = expiryWarning(-5);
    expect(r.level).toBe('critical');
    expect(r.message).toContain('expired 5 days ago');
  });

  it('handles singular day', () => {
    expect(expiryWarning(1).message).toContain('1 day');
    expect(expiryWarning(-1).message).toContain('1 day');
  });

  it('returns ok for null (unknown)', () => {
    const r = expiryWarning(null);
    expect(r.level).toBe('ok');
    expect(r.message).toBe('Expiry date unknown');
  });

  it('exposes RENEWAL_WINDOWS', () => {
    expect(RENEWAL_WINDOWS).toEqual({ warning: 30, critical: 7 });
  });
});

describe('checkDomainHealth', () => {
  it('returns fully healthy when no opts provided (no data = no issues found)', () => {
    const r = checkDomainHealth('example.com');
    expect(r.domain).toBe('example.com');
    expect(r.expiresAt).toBeNull();
    expect(r.daysUntilExpiry).toBeNull();
    expect(r.sslValid).toBe(true); // no cert data = assumed fine
    expect(r.dnsOk).toBe(false); // no records = not ok
    expect(r.issues).toContain('no DNS records found');
  });

  it('reports sslValid=false when SSL cert has expired', () => {
    const past = new Date(Date.now() - 86_400_000 * 10).toISOString(); // 10 days ago
    const r = checkDomainHealth('example.com', { sslExpiry: past, dnsRecords: ['A 1.2.3.4'] });
    expect(r.sslValid).toBe(false);
    expect(r.issues).toContain('SSL certificate has expired');
  });

  it('reports sslValid=true when SSL cert is still valid', () => {
    const future = new Date(Date.now() + 86_400_000 * 60).toISOString(); // 60 days
    const r = checkDomainHealth('example.com', { sslExpiry: future, dnsRecords: ['A 1.2.3.4'] });
    expect(r.sslValid).toBe(true);
    expect(r.issues).not.toContain('SSL certificate has expired');
  });

  it('warns on SSL cert within 30 days', () => {
    const ssl = new Date(Date.now() + 86_400_000 * 14).toISOString();
    const r = checkDomainHealth('example.com', { sslExpiry: ssl, dnsRecords: ['A 1.2.3.4'] });
    expect(r.sslValid).toBe(true);
    expect(r.issues).toContain('SSL certificate expires within 30 days');
  });

  it('warns on SSL cert within 7 days (critical)', () => {
    const ssl = new Date(Date.now() + 86_400_000 * 3).toISOString();
    const r = checkDomainHealth('example.com', { sslExpiry: ssl, dnsRecords: ['A 1.2.3.4'] });
    expect(r.sslValid).toBe(true);
    expect(r.issues).toContain('SSL certificate expires within 7 days');
  });

  it('reports dnsOk=false when dnsRecords is empty', () => {
    const r = checkDomainHealth('example.com', { dnsRecords: [] });
    expect(r.dnsOk).toBe(false);
    expect(r.issues).toContain('no DNS records found');
  });

  it('reports dnsOk=true when dnsRecords is non-empty', () => {
    const r = checkDomainHealth('example.com', {
      dnsRecords: ['A 93.184.216.34', 'MX 10 mail.example.com'],
    });
    expect(r.dnsOk).toBe(true);
    expect(r.issues).not.toContain('no DNS records found');
  });

  it('uses the earlier of whoisExpiry and sslExpiry as expiresAt', () => {
    const wh = new Date(Date.now() + 86_400_000 * 20).toISOString(); // 20 days → sooner
    const ssl = new Date(Date.now() + 86_400_000 * 60).toISOString(); // 60 days
    const r = checkDomainHealth('example.com', {
      whoisExpiry: wh,
      sslExpiry: ssl,
      dnsRecords: ['A 1.2.3.4'],
    });
    expect(r.daysUntilExpiry).toBeGreaterThanOrEqual(18);
    expect(r.daysUntilExpiry).toBeLessThanOrEqual(22);
    // 20 days is still positive — no expiry flag
    expect(r.issues).not.toContain('domain registration has expired');
    expect(r.issues).not.toContain('SSL certificate has expired');
  });

  it('flags expired whois expiry', () => {
    const wh = new Date(Date.now() - 86_400_000 * 5).toISOString(); // 5 days ago
    const r = checkDomainHealth('example.com', { whoisExpiry: wh, dnsRecords: ['A 1.2.3.4'] });
    expect(r.issues).toContain('domain registration has expired');
    expect(r.daysUntilExpiry).toBeLessThan(0);
  });

  it('handles empty domain gracefully', () => {
    const r = checkDomainHealth('');
    expect(r.dnsOk).toBe(false);
    expect(r.sslValid).toBe(false);
    expect(r.issues).toContain('domain name is empty');
  });

  it('normalizes domain to lowercase', () => {
    const r = checkDomainHealth('Example.COM');
    expect(r.domain).toBe('example.com');
  });

  it('accepts Date objects for expiry params', () => {
    const ssl = new Date(Date.now() + 86_400_000 * 100);
    const r = checkDomainHealth('example.com', { sslExpiry: ssl, dnsRecords: ['A 1.2.3.4'] });
    expect(r.sslValid).toBe(true);
    expect(r.daysUntilExpiry).toBeGreaterThan(90);
  });

  it('ignores null/undefined opts', () => {
    const r = checkDomainHealth('example.com', {
      sslExpiry: null,
      dnsRecords: null,
      whoisExpiry: undefined,
    });
    expect(r.sslValid).toBe(true);
    expect(r.dnsOk).toBe(false);
    expect(r.daysUntilExpiry).toBeNull();
  });

  it('returns no issues for a fully healthy domain', () => {
    const ssl = new Date(Date.now() + 86_400_000 * 90).toISOString();
    const r = checkDomainHealth('example.com', {
      sslExpiry: ssl,
      dnsRecords: ['A 1.2.3.4'],
      whoisExpiry: new Date(Date.now() + 86_400_000 * 120).toISOString(),
    });
    expect(r.issues).toEqual([]);
    expect(r.sslValid).toBe(true);
    expect(r.dnsOk).toBe(true);
    expect(r.daysUntilExpiry).toBeGreaterThan(85);
  });
});
