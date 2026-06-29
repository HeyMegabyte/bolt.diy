import {
  parseDkimRecord,
  parseSpfRecord,
  parseDmarcRecord,
  isValidDkimKey,
  buildDnsInstructions,
} from '../services/email_signing.js';

describe('parseDkimRecord', () => {
  it('parses a valid DKIM record with rsa-sha256', () => {
    const r = parseDkimRecord(
      'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb4DQEBAQUAA4GNADCBiQKBgQC4fQ==',
      'google',
      'example.com',
    );
    expect(r).not.toBeNull();
    expect(r!.version).toBe('DKIM1');
    expect(r!.algorithm).toBe('rsa-sha256');
    expect(r!.selector).toBe('google');
    expect(r!.domain).toBe('example.com');
    expect(r!.publicKeyB64).toBe('MIGfMA0GCSqGSIb4DQEBAQUAA4GNADCBiQKBgQC4fQ==');
  });

  it('parses a valid DKIM record with ed25519', () => {
    const r = parseDkimRecord(
      'v=DKIM1; k=ed25519; p=MIGfMA0GCSqGSIb4DQEBAQUAA4GNADCBiQKBgQC4fQ==',
      'default',
      'example.org',
    );
    expect(r).not.toBeNull();
    expect(r!.algorithm).toBe('ed25519');
  });

  it('parses a DKIM record with testing flags', () => {
    const r = parseDkimRecord(
      'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb4DQEBAQUAA4GNADCBiQKBgQC4fQ==; t=y:s',
      'sel',
      'x.com',
    );
    expect(r).not.toBeNull();
    expect(r!.flags).toContain('t=y');
    expect(r!.flags).toContain('t=s');
  });

  it('returns null for empty string', () => {
    expect(parseDkimRecord('')).toBeNull();
    expect(parseDkimRecord('   ')).toBeNull();
  });

  it('returns null for missing DKIM1 version', () => {
    expect(parseDkimRecord('v=SPF1; k=rsa; p=abc')).toBeNull();
  });

  it('returns null for missing public key', () => {
    expect(parseDkimRecord('v=DKIM1; k=rsa; p=')).toBeNull();
  });
});

describe('parseSpfRecord', () => {
  it('parses a valid SPF record with mechanisms', () => {
    const r = parseSpfRecord('v=spf1 include:_spf.google.com include:_spf.salesforce.com ~all');
    expect(r).not.toBeNull();
    expect(r!.version).toBe('spf1');
    expect(r!.mechanisms).toHaveLength(2);
    expect(r!.mechanisms[0]).toEqual({ qualifier: '+', mechanism: 'include:_spf.google.com' });
    expect(r!.mechanisms[1]).toEqual({ qualifier: '+', mechanism: 'include:_spf.salesforce.com' });
    expect(r!.allMechanism).toBe('~all');
    expect(r!.modifiers).toEqual({});
  });

  it('parses a hard-fail SPF record (-all)', () => {
    const r = parseSpfRecord('v=spf1 mx -all');
    expect(r).not.toBeNull();
    expect(r!.allMechanism).toBe('-all');
    expect(r!.mechanisms[0].mechanism).toBe('mx');
  });

  it('parses a redirect modifier', () => {
    const r = parseSpfRecord('v=spf1 redirect=_spf.example.com');
    expect(r!.modifiers).toEqual({ redirect: '_spf.example.com' });
    expect(r!.mechanisms).toHaveLength(0);
  });

  it('returns null for missing spf1 version', () => {
    expect(parseSpfRecord('v=DKIM1; k=rsa; p=abc')).toBeNull();
  });

  it('returns null for empty/junk input', () => {
    expect(parseSpfRecord('')).toBeNull();
    expect(parseSpfRecord(123 as unknown as string)).toBeNull();
  });
});

describe('parseDmarcRecord', () => {
  it('parses a valid reject-policy DMARC record', () => {
    const r = parseDmarcRecord(
      'v=DMARC1; p=reject; rua=mailto:dmarc@example.com; sp=none; pct=100',
    );
    expect(r).not.toBeNull();
    expect(r!.version).toBe('DMARC1');
    expect(r!.policy).toBe('reject');
    expect(r!.subdomainPolicy).toBe('none');
    expect(r!.pct).toBe(100);
    expect(r!.rua).toEqual(['mailto:dmarc@example.com']);
  });

  it('parses a quarantine-policy DMARC record', () => {
    const r = parseDmarcRecord('v=DMARC1; p=quarantine');
    expect(r!.policy).toBe('quarantine');
    expect(r!.subdomainPolicy).toBeUndefined();
    expect(r!.rua).toBeUndefined();
  });

  it('parses forensic reports (ruf)', () => {
    const r = parseDmarcRecord('v=DMARC1; p=none; ruf=mailto:forensic@example.com');
    expect(r!.ruf).toEqual(['mailto:forensic@example.com']);
  });

  it('returns null for missing DMARC1 version', () => {
    expect(parseDmarcRecord('v=SPF1; p=reject')).toBeNull();
  });

  it('returns null for invalid policy value', () => {
    expect(parseDmarcRecord('v=DMARC1; p=allow')).toBeNull();
    expect(parseDmarcRecord('v=DMARC1; p=reject')).not.toBeNull();
  });

  it('returns null for empty/junk input', () => {
    expect(parseDmarcRecord('')).toBeNull();
    expect(parseDmarcRecord('   ')).toBeNull();
  });
});

describe('isValidDkimKey', () => {
  it('accepts a well-formed base64 key of valid length', () => {
    const key = 'AAAA'.repeat(50); // 200 chars, valid base64
    expect(isValidDkimKey(key)).toBe(true);
    expect(isValidDkimKey(key)).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidDkimKey('')).toBe(false);
  });

  it('rejects non-base64 characters', () => {
    expect(isValidDkimKey('!!!invalid###')).toBe(false);
  });

  it('rejects a key that is too short', () => {
    expect(isValidDkimKey('abc')).toBe(false);
  });

  it('rejects a key that is too long', () => {
    expect(isValidDkimKey('A'.repeat(5000))).toBe(false);
  });

  it('handles non-string input gracefully', () => {
    expect(isValidDkimKey(null as unknown as string)).toBe(false);
    expect(isValidDkimKey(undefined as unknown as string)).toBe(false);
  });
});

describe('buildDnsInstructions', () => {
  it('returns all 4 fields non-empty', () => {
    const r = buildDnsInstructions({ domain: 'example.com' });
    expect(r.dkim.length).toBeGreaterThan(0);
    expect(r.spf.length).toBeGreaterThan(0);
    expect(r.dmarc.length).toBeGreaterThan(0);
    expect(r.verification.length).toBeGreaterThan(0);
  });

  it('includes the domain in all record strings', () => {
    const r = buildDnsInstructions({ domain: 'mysite.org' });
    expect(r.dkim).toContain('mysite.org');
    expect(r.spf).toContain('mysite.org');
    expect(r.dmarc).toContain('mysite.org');
  });

  it('uses SES template when service=ses', () => {
    const r = buildDnsInstructions({ domain: 'x.com', sendingService: 'ses' });
    expect(r.spf).toContain('amazonses.com');
    expect(r.dkim).toContain('ses._domainkey');
  });

  it('uses listmonk template when service=listmonk', () => {
    const r = buildDnsInstructions({ domain: 'x.com', sendingService: 'listmonk' });
    expect(r.spf).toContain('_spf.x.com');
    expect(r.dkim).toContain('dkim._domainkey');
  });

  it('uses customValues when provided', () => {
    const r = buildDnsInstructions({
      domain: 'example.com',
      customValues: {
        dkim: 'CUSTOM_DKIM',
        spf: 'CUSTOM_SPF',
        dmarc: 'CUSTOM_DMARC',
      },
    });
    expect(r.dkim).toBe('CUSTOM_DKIM');
    expect(r.spf).toBe('CUSTOM_SPF');
    expect(r.dmarc).toBe('CUSTOM_DMARC');
  });
});
