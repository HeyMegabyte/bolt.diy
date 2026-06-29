import {
  buildVerificationPlan,
  checkVerification,
  type DnsVerificationRecord,
  type DnsVerification,
  type DnsProvider,
} from '../services/dns_verify.js';

const DOMAIN = 'example.com';

describe('buildVerificationPlan', () => {
  it('returns empty plan for empty domain', () => {
    const plan = buildVerificationPlan('', 'cloudflare');
    expect(plan.domain).toBe('');
    expect(plan.records).toHaveLength(0);
    expect(plan.allPass).toBe(false);
  });

  it.each(['cloudflare', 'namecheap', 'godaddy'] as DnsProvider[])(
    'returns non-empty plan for provider %s',
    (provider) => {
      const plan = buildVerificationPlan(DOMAIN, provider);
      expect(plan.domain).toBe(DOMAIN);
      expect(plan.records.length).toBeGreaterThan(0);
      expect(plan.allPass).toBe(false);
    },
  );

  it('includes A records pointing to CF proxy IPs', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const aRecords = plan.records.filter((r) => r.type === 'A');
    expect(aRecords).toHaveLength(2);
    expect(aRecords.map((r) => r.expectedValue)).toEqual(['104.16.0.1', '104.16.0.2']);
  });

  it('includes www CNAME pointing to the bare domain', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const cname = plan.records.find((r) => r.type === 'CNAME' && r.name === `www.${DOMAIN}`);
    expect(cname).toBeDefined();
    expect(cname!.expectedValue).toBe(DOMAIN);
  });

  it('includes MX record for SES inbound', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const mx = plan.records.find((r) => r.type === 'MX');
    expect(mx).toBeDefined();
    expect(mx!.expectedValue).toBe('inbound-smtp.us-east-1.amazonaws.com');
  });

  it('includes SPF TXT record', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const spf = plan.records.find(
      (r) => r.type === 'TXT' && r.name === DOMAIN && r.expectedValue.includes('v=spf1'),
    );
    expect(spf).toBeDefined();
    expect(spf!.expectedValue).toContain('include:amazonses.com');
    expect(spf!.expectedValue).toContain('~all');
  });

  it('includes DKIM CNAME record', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const dkim = plan.records.find((r) => r.name.includes('_domainkey'));
    expect(dkim).toBeDefined();
    expect(dkim!.type).toBe('CNAME');
    expect(dkim!.name).toBe(`${DEFAULT_DKIM_SELECTOR}._domainkey.${DOMAIN}`);
    expect(dkim!.expectedValue).toBe('default.dkim.amazonses.com');
  });

  it('includes DMARC TXT record', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const dmarc = plan.records.find((r) => r.name.includes('_dmarc'));
    expect(dmarc).toBeDefined();
    expect(dmarc!.type).toBe('TXT');
    expect(dmarc!.expectedValue).toBe('v=DMARC1; p=none');
  });

  it('includes cloudflare-specific verification TXT', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const v = plan.records.find((r) => r.expectedValue.includes('cf-verify'));
    expect(v).toBeDefined();
    expect(v!.expectedValue).toBe(`cf-verify=${DOMAIN}`);
  });

  it('includes namecheap-specific verification TXT', () => {
    const plan = buildVerificationPlan(DOMAIN, 'namecheap');
    const v = plan.records.find((r) => r.expectedValue.includes('namecheap-verification'));
    expect(v).toBeDefined();
    expect(v!.expectedValue).toBe(`namecheap-verification=${DOMAIN}`);
  });

  it('includes godaddy-specific verification CNAME', () => {
    const plan = buildVerificationPlan(DOMAIN, 'godaddy');
    const v = plan.records.find((r) => r.type === 'CNAME' && r.name === `_verify.${DOMAIN}`);
    expect(v).toBeDefined();
    expect(v!.expectedValue).toBe('verify.godaddy.com');
  });
});

describe('checkVerification', () => {
  it('returns plan as-is when actual records are empty', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const result = checkVerification(plan, []);
    expect(result.allPass).toBe(false);
    for (const record of result.records) {
      expect(record.propagated).toBe(false);
    }
  });

  it('returns plan as-is when actual records is null', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const result = checkVerification(plan, null as unknown as []);
    expect(result.allPass).toBe(false);
    for (const record of result.records) {
      expect(record.propagated).toBe(false);
    }
  });

  it('marks A records as propagated on exact IP match', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const actual = [
      { type: 'A', name: DOMAIN, value: '104.16.0.1' },
      { type: 'A', name: DOMAIN, value: '104.16.0.2' },
    ];
    const result = checkVerification(plan, actual);
    const aChecked = result.records.filter((r) => r.type === 'A');
    expect(aChecked.every((r) => r.propagated)).toBe(true);
  });

  it('marks www CNAME as propagated on matching target', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const actual = [{ type: 'CNAME', name: `www.${DOMAIN}`, value: `${DOMAIN}.` }];
    const result = checkVerification(plan, actual);
    const cname = result.records.find((r) => r.type === 'CNAME' && r.name === `www.${DOMAIN}`);
    expect(cname!.propagated).toBe(true);
  });

  it('matches CNAME ignoring trailing dot and case', () => {
    const plan = buildVerificationPlan('Example.Com', 'cloudflare');
    const actual = [{ type: 'CNAME', name: 'www.example.com.', value: 'Example.Com.' }];
    const result = checkVerification(plan, actual);
    const cname = result.records.find(
      (r) => r.type === 'CNAME' && r.name.toLowerCase() === 'www.example.com',
    );
    expect(cname!.propagated).toBe(true);
  });

  it('matches MX by exchange hostname ignoring priority', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const actual = [
      { type: 'MX', name: DOMAIN, value: '10 inbound-smtp.us-east-1.amazonaws.com.' },
    ];
    const result = checkVerification(plan, actual);
    const mx = result.records.find((r) => r.type === 'MX');
    expect(mx!.propagated).toBe(true);
  });

  it('matches TXT by substring presence', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    // Actual value includes extra comment but still contains the expected
    // substring
    const actual = [
      {
        type: 'TXT',
        name: DOMAIN,
        value: 'v=spf1 include:amazonses.com ~all  ; additional comment',
      },
    ];
    const result = checkVerification(plan, actual);
    const spf = result.records.find(
      (r) => r.type === 'TXT' && r.name === DOMAIN && r.expectedValue.includes('v=spf1'),
    );
    expect(spf!.propagated).toBe(true);
  });

  it('marks all propagated when all records match', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const actual = allPassingRecords(DOMAIN);
    const result = checkVerification(plan, actual);
    expect(result.allPass).toBe(true);
    expect(result.records.every((r) => r.propagated)).toBe(true);
  });

  it('returns false allPass when one record is missing', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    // Omit the DMARC record from actuals
    const actual = allPassingRecords(DOMAIN).filter((r) => !r.name.includes('_dmarc'));
    const result = checkVerification(plan, actual);
    expect(result.allPass).toBe(false);
    const dmarc = result.records.find((r) => r.name.includes('_dmarc'));
    expect(dmarc!.propagated).toBe(false);
  });

  it('does not modify the original plan', () => {
    const plan = buildVerificationPlan(DOMAIN, 'cloudflare');
    const originalRecords = plan.records.map((r) => ({ ...r }));
    const actual = allPassingRecords(DOMAIN);
    checkVerification(plan, actual);
    // Verify original plan records are untouched
    for (let i = 0; i < plan.records.length; i++) {
      expect(plan.records[i].propagated).toBe(originalRecords[i].propagated);
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a set of actual DNS records that pass all expectations. */
function allPassingRecords(domain: string) {
  return [
    { type: 'A', name: domain, value: '104.16.0.1' },
    { type: 'A', name: domain, value: '104.16.0.2' },
    { type: 'CNAME', name: `www.${domain}`, value: `${domain}.` },
    {
      type: 'MX',
      name: domain,
      value: '10 inbound-smtp.us-east-1.amazonaws.com.',
    },
    {
      type: 'TXT',
      name: domain,
      value: 'v=spf1 include:amazonses.com ~all',
    },
    {
      type: 'CNAME',
      name: `${DEFAULT_DKIM_SELECTOR}._domainkey.${domain}`,
      value: 'default.dkim.amazonses.com.',
    },
    {
      type: 'TXT',
      name: `_dmarc.${domain}`,
      value: 'v=DMARC1; p=none',
    },
    { type: 'TXT', name: domain, value: `cf-verify=${domain}` },
  ];
}

// Re-declare for the test module scope
const DEFAULT_DKIM_SELECTOR = 'default';
