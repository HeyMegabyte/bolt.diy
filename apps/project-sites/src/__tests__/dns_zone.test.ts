import { buildZoneFile, validateZone, DEFAULT_TTL, type DnsRecord } from '../services/dns_zone.js';

describe('buildZoneFile', () => {
  it('produces a valid-looking zone file preamble', () => {
    const out = buildZoneFile('example.com', [
      { type: 'A', name: '@', content: '192.0.2.1', ttl: 3600 },
    ]);
    expect(out).toContain('$ORIGIN example.com.');
    expect(out).toContain('$TTL 3600');
    expect(out).toContain('IN SOA');
    expect(out).toContain('IN NS');
    expect(out).toContain('IN A 192.0.2.1');
  });

  it('renders a CNAME with its target as FQDN', () => {
    const out = buildZoneFile('example.com', [
      { type: 'CNAME', name: 'www', content: 'example.com', ttl: 3600 },
    ]);
    expect(out).toContain('www 3600 IN CNAME example.com.');
  });

  it('renders an MX record with priority', () => {
    const out = buildZoneFile('example.com', [
      { type: 'MX', name: '@', content: 'mail.example.com', ttl: 3600, priority: 10 },
    ]);
    expect(out).toContain('@ 3600 IN MX 10');
    expect(out).toContain('mail.example.com.');
  });

  it('quotes TXT record content', () => {
    const out = buildZoneFile('example.com', [
      { type: 'TXT', name: '@', content: 'v=spf1 include:_spf.example.com ~all', ttl: 3600 },
    ]);
    expect(out).toContain('3600 IN TXT');
    expect(out).toContain('"v=spf1 include:_spf.example.com ~all"');
  });

  it('skips records with invalid fields gracefully', () => {
    const out = buildZoneFile('example.com', [
      null as unknown as DnsRecord,
      undefined as unknown as DnsRecord,
      { type: 'A', name: '@', content: '1.2.3.4', ttl: 3600 },
    ]);
    expect(out).toContain('IN A 1.2.3.4');
  });

  it('produces consistent output across multiple calls', () => {
    const a = buildZoneFile('example.com', [
      { type: 'A', name: '@', content: '5.6.7.8', ttl: DEFAULT_TTL },
    ]);
    const b = buildZoneFile('example.com', [
      { type: 'A', name: '@', content: '5.6.7.8', ttl: DEFAULT_TTL },
    ]);
    expect(a).toBe(b);
  });

  it('ends with a trailing newline', () => {
    const out = buildZoneFile('test.org', [
      { type: 'A', name: '@', content: '10.0.0.1', ttl: 300 },
    ]);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('handles empty records array by generating a skeleton zone', () => {
    const out = buildZoneFile('empty.test', []);
    expect(out).toContain('$ORIGIN empty.test.');
    expect(out).toContain('IN SOA');
    expect(out).toContain('IN NS');
  });
});

describe('validateZone', () => {
  it('passes a valid single-record zone', () => {
    const r = validateZone([{ type: 'A', name: '@', content: '1.2.3.4', ttl: 3600 }]);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('fails on an empty record list', () => {
    const r = validateZone([]);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('flags duplicate (type, name, content) triples', () => {
    const r = validateZone([
      { type: 'A', name: '@', content: '1.2.3.4', ttl: 300 },
      { type: 'A', name: '@', content: '1.2.3.4', ttl: 600 },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('passes a zone without NS records (Cloudflare auto-adds them)', () => {
    const r = validateZone([{ type: 'A', name: '@', content: '1.2.3.4', ttl: 3600 }]);
    expect(r.valid).toBe(true);
  });

  it('passes on a zone with NS + A records', () => {
    const r = validateZone([
      { type: 'NS', name: '@', content: 'ns1.example.com', ttl: 86400 },
      { type: 'A', name: '@', content: '1.2.3.4', ttl: 3600 },
    ]);
    expect(r.valid).toBe(true);
  });

  it('rejects TTL values outside 1-86400', () => {
    const r1 = validateZone([{ type: 'A', name: '@', content: '1.2.3.4', ttl: 0 }]);
    expect(r1.valid).toBe(false);
    expect(r1.errors.some((e) => e.includes('TTL'))).toBe(true);

    const r2 = validateZone([{ type: 'A', name: '@', content: '1.2.3.4', ttl: 90000 }]);
    expect(r2.valid).toBe(false);
  });

  it('flags at most one SOA record', () => {
    const r = validateZone([
      { type: 'SOA', name: '@', content: 'primary', ttl: 3600 },
      { type: 'SOA', name: '@', content: 'secondary', ttl: 3600 },
    ]);
    expect(r.errors.some((e) => e.includes('SOA'))).toBe(true);
  });

  it('never throws on null/undefined/malformed input', () => {
    expect(validateZone(null as unknown as []).valid).toBe(false);
    expect(validateZone(undefined as unknown as []).valid).toBe(false);
    const r = validateZone([
      null as unknown as DnsRecord,
      { type: 'A', name: '@', content: '1.2.3.4', ttl: 3600 },
    ]);
    expect(r.valid).toBe(true);
  });
});
