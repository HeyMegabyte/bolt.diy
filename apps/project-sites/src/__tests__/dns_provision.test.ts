import {
  buildDnsPlan,
  generateDkimRecord,
  generateSpfRecord,
  generateDmarcRecord,
  DEFAULT_TTL,
  CF_PROXY_IPS,
  DEFAULT_NAMESERVERS,
} from '../services/dns_provision.js';

describe('buildDnsPlan', () => {
  it('builds a minimal plan with A + www CNAME when email and verification are off', () => {
    const plan = buildDnsPlan({
      domain: 'example.com',
      workerHostname: 'project-sites.workers.dev',
      includeEmail: false,
      includeVerification: false,
    });

    expect(plan.domain).toBe('example.com');
    // 2 A records + 1 www CNAME
    expect(plan.records).toHaveLength(3);
    expect(plan.nameservers).toEqual(DEFAULT_NAMESERVERS);
    expect(plan.verification).toBeNull();
  });

  it('builds a full plan with email and verification records (defaults)', () => {
    const plan = buildDnsPlan({
      domain: 'example.com',
      workerHostname: 'project-sites.workers.dev',
    });

    // includeEmail defaults true, includeVerification defaults true
    // Records: 2 A, 1 www CNAME, 1 MX, 1 SPF, 1 DKIM, 1 DMARC = 7
    expect(plan.records).toHaveLength(7);

    // Check A records
    const aRecords = plan.records.filter((r) => r.type === 'A');
    expect(aRecords).toHaveLength(2);
    expect(aRecords[0]?.name).toBe('@');
    expect(aRecords[0]?.value).toBe(CF_PROXY_IPS[0]);
    expect(aRecords[0]?.ttl).toBe(DEFAULT_TTL);

    // Check www CNAME points to worker hostname
    const wwwCname = plan.records.find((r) => r.type === 'CNAME' && r.name === 'www');
    expect(wwwCname).toBeDefined();
    expect(wwwCname?.value).toBe('project-sites.workers.dev');

    // Check MX
    const mx = plan.records.find((r) => r.type === 'MX');
    expect(mx).toBeDefined();
    expect(mx?.name).toBe('@');
    expect(mx?.priority).toBe(10);

    // Check verification present
    expect(plan.verification).not.toBeNull();
    expect(plan.verification?.type).toBe('TXT');
    expect(plan.verification?.name).toBe('@');
    expect(plan.verification?.value).toBe('cf-verify=example.com');
  });

  it('honours a custom sending domain for DKIM/SPF/DMARC', () => {
    const plan = buildDnsPlan({
      domain: 'example.com',
      workerHostname: 'project-sites.workers.dev',
      sendingDomain: 'mail.example.com',
    });

    const dkim = plan.records.find((r) => r.name.includes('_domainkey'));
    expect(dkim).toBeDefined();
    expect(dkim?.name).toBe('default._domainkey.mail.example.com');

    const spf = plan.records.find((r) => r.type === 'TXT' && r.value.startsWith('v=spf1'));
    expect(spf).toBeDefined();
    expect(spf?.name).toBe('@');

    const dmarc = plan.records.find((r) => r.name === '_dmarc');
    expect(dmarc).toBeDefined();
  });

  it('handles empty/missing inputs with defaults', () => {
    const plan = buildDnsPlan({
      domain: '',
      workerHostname: '',
    });

    // Still produces records even with empty inputs
    expect(Array.isArray(plan.records)).toBe(true);
    expect(plan.records.length).toBeGreaterThanOrEqual(3);
    expect(plan.domain).toBe('');
    expect(plan.verification).not.toBeNull();
    expect(plan.verification?.value).toBe('cf-verify=');
  });

  it('returns frozen nameservers array', () => {
    const plan = buildDnsPlan({
      domain: 'test.com',
      workerHostname: 'w.workers.dev',
      includeEmail: false,
      includeVerification: false,
    });

    expect(Object.isFrozen(plan.nameservers)).toBe(true);
  });

  it('returns frozen records array', () => {
    const plan = buildDnsPlan({
      domain: 'test.com',
      workerHostname: 'w.workers.dev',
      includeEmail: false,
      includeVerification: false,
    });

    expect(Object.isFrozen(plan.records)).toBe(true);
  });

  it('produces a stable plan for the same inputs', () => {
    const a = buildDnsPlan({
      domain: 'stable.io',
      workerHostname: 'w.workers.dev',
      includeEmail: false,
      includeVerification: false,
    });
    const b = buildDnsPlan({
      domain: 'stable.io',
      workerHostname: 'w.workers.dev',
      includeEmail: false,
      includeVerification: false,
    });

    expect(a.domain).toBe(b.domain);
    expect(a.records.map((r) => `${r.type}:${r.name}:${r.value}`)).toEqual(
      b.records.map((r) => `${r.type}:${r.name}:${r.value}`),
    );
  });
});

describe('generateDkimRecord', () => {
  it('creates a CNAME with the default selector', () => {
    const rec = generateDkimRecord('example.com');

    expect(rec.type).toBe('CNAME');
    expect(rec.name).toBe('default._domainkey.example.com');
    expect(rec.value).toBe('default.dkim.amazonses.com');
    expect(rec.ttl).toBe(DEFAULT_TTL);
  });

  it('uses a custom selector', () => {
    const rec = generateDkimRecord('example.com', 'ses2');

    expect(rec.name).toBe('ses2._domainkey.example.com');
    expect(rec.value).toBe('ses2.dkim.amazonses.com');
  });

  it('handles subdomain sending domains', () => {
    const rec = generateDkimRecord('mail.example.com');

    expect(rec.name).toBe('default._domainkey.mail.example.com');
  });

  it('handles empty domain', () => {
    const rec = generateDkimRecord('');

    expect(rec.name).toBe('default._domainkey.');
    expect(rec.value).toBe('default.dkim.amazonses.com');
  });
});

describe('generateSpfRecord', () => {
  it('creates a TXT record with default amazonses include', () => {
    const rec = generateSpfRecord();

    expect(rec.type).toBe('TXT');
    expect(rec.name).toBe('@');
    expect(rec.value).toBe('v=spf1 include:amazonses.com ~all');
    expect(rec.ttl).toBe(DEFAULT_TTL);
  });

  it('uses a custom include service', () => {
    const rec = generateSpfRecord('spf.google.com');

    expect(rec.value).toBe('v=spf1 include:spf.google.com ~all');
  });

  it('handles empty include', () => {
    const rec = generateSpfRecord('');

    expect(rec.value).toBe('v=spf1 include: ~all');
  });
});

describe('generateDmarcRecord', () => {
  it('creates a TXT record with default none policy', () => {
    const rec = generateDmarcRecord();

    expect(rec.type).toBe('TXT');
    expect(rec.name).toBe('_dmarc');
    expect(rec.value).toBe('v=DMARC1; p=none');
    expect(rec.ttl).toBe(DEFAULT_TTL);
  });

  it('accepts quarantine policy', () => {
    const rec = generateDmarcRecord('quarantine');
    expect(rec.value).toBe('v=DMARC1; p=quarantine');
  });

  it('accepts reject policy', () => {
    const rec = generateDmarcRecord('reject');
    expect(rec.value).toBe('v=DMARC1; p=reject');
  });
});
