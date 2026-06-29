import {
  checkPropagation,
  type DnsVerificationResult,
  type PropagationCheck,
  propagationStatus,
  valuesMatch,
  verifyDnsRecord,
} from '../domain_verify';

// ---------------------------------------------------------------------------
// valuesMatch
// ---------------------------------------------------------------------------

describe('valuesMatch', () => {
  it('returns true for exact A record match', () => {
    expect(valuesMatch('A', '104.16.0.1', '104.16.0.1')).toBe(true);
  });

  it('returns false for mismatched A record', () => {
    expect(valuesMatch('A', '104.16.0.1', '104.16.0.2')).toBe(false);
  });

  it('returns true for case-insensitive CNAME match', () => {
    expect(valuesMatch('CNAME', 'example.com', 'Example.Com.')).toBe(true);
  });

  it('strips trailing dots for CNAME comparison', () => {
    expect(valuesMatch('CNAME', 'example.com.', 'example.com')).toBe(true);
  });

  it('returns true for MX hostname match ignoring priority', () => {
    expect(valuesMatch('MX', 'mail.example.com', '10 mail.example.com')).toBe(true);
  });

  it('returns true for MX hostname with trailing dot', () => {
    expect(valuesMatch('MX', 'mail.example.com', '10 mail.example.com.')).toBe(true);
  });

  it('returns false for MX hostname mismatch', () => {
    expect(valuesMatch('MX', 'mail.example.com', '10 mail.other.com')).toBe(false);
  });

  it('returns true for TXT substring match', () => {
    expect(valuesMatch('TXT', 'v=spf1', 'v=spf1 include:amazonses.com ~all')).toBe(true);
  });

  it('returns false for TXT when expected not in actual', () => {
    expect(valuesMatch('TXT', 'v=spf2', 'v=spf1 include:amazonses.com ~all')).toBe(false);
  });

  it('matches AAAA records exactly', () => {
    expect(valuesMatch('AAAA', '2001:db8::1', '2001:db8::1')).toBe(true);
    expect(valuesMatch('AAAA', '2001:db8::1', '2001:db8::2')).toBe(false);
  });

  it('falls back to exact match for unknown record types', () => {
    expect(valuesMatch('SRV', 'target.example.com', 'target.example.com')).toBe(true);
    expect(valuesMatch('SRV', 'target.example.com', 'other.example.com')).toBe(false);
  });

  it('handles type case-insensitively', () => {
    expect(valuesMatch('a', '104.16.0.1', '104.16.0.1')).toBe(true);
    expect(valuesMatch('txt', 'v=spf1', 'v=spf1 ~all')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyDnsRecord
// ---------------------------------------------------------------------------

describe('verifyDnsRecord', () => {
  it('returns matched=true when A record matches exactly', () => {
    const result = verifyDnsRecord('example.com', 'A', '104.16.0.1', '104.16.0.1');
    expect(result).toEqual({
      actual: '104.16.0.1',
      domain: 'example.com',
      expected: '104.16.0.1',
      matched: true,
      type: 'A',
    } satisfies DnsVerificationResult);
  });

  it('returns matched=false for A record mismatch', () => {
    const result = verifyDnsRecord('example.com', 'A', '104.16.0.1', '104.16.0.2');
    expect(result.matched).toBe(false);
    expect(result.actual).toBe('104.16.0.2');
  });

  it('returns matched=false with null actual when record not found', () => {
    const result = verifyDnsRecord('example.com', 'A', '104.16.0.1', null);
    expect(result.matched).toBe(false);
    expect(result.actual).toBeNull();
  });

  it('matches TXT via substring', () => {
    const result = verifyDnsRecord(
      'example.com',
      'TXT',
      'v=spf1',
      'v=spf1 include:amazonses.com ~all',
    );
    expect(result.matched).toBe(true);
  });

  it('matches MX ignoring priority', () => {
    const result = verifyDnsRecord(
      'example.com',
      'MX',
      'inbound-smtp.us-east-1.amazonaws.com',
      '10 inbound-smtp.us-east-1.amazonaws.com',
    );
    expect(result.matched).toBe(true);
  });

  it('preserves all fields in the result', () => {
    const result = verifyDnsRecord('mysite.org', 'CNAME', 'example.com', 'example.com');
    expect(result.domain).toBe('mysite.org');
    expect(result.type).toBe('CNAME');
    expect(result.expected).toBe('example.com');
    expect(result.actual).toBe('example.com');
    expect(result.matched).toBe(true);
  });

  it('handles empty strings for domain', () => {
    const result = verifyDnsRecord('', 'A', '1.2.3.4', '1.2.3.4');
    expect(result.matched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkPropagation
// ---------------------------------------------------------------------------

describe('checkPropagation', () => {
  it('returns allPropagated=true when all checks are propagated', () => {
    const checks: PropagationCheck[] = [
      {
        actualValue: '104.16.0.1',
        domain: 'example.com',
        expectedValue: '104.16.0.1',
        name: 'example.com',
        propagated: true,
        type: 'A',
      },
      {
        actualValue: '10 mail.example.com',
        domain: 'example.com',
        expectedValue: 'mail.example.com',
        name: 'example.com',
        propagated: true,
        type: 'MX',
      },
    ];

    const summary = checkPropagation(checks);
    expect(summary).toEqual({
      allPropagated: true,
      pending: 0,
      propagated: 2,
      total: 2,
    });
  });

  it('returns allPropagated=false when any check is pending', () => {
    const checks: PropagationCheck[] = [
      {
        actualValue: '104.16.0.1',
        domain: 'example.com',
        expectedValue: '104.16.0.1',
        name: 'example.com',
        propagated: true,
        type: 'A',
      },
      {
        actualValue: null,
        domain: 'example.com',
        expectedValue: 'mail.example.com',
        name: 'example.com',
        propagated: false,
        type: 'MX',
      },
    ];

    const summary = checkPropagation(checks);
    expect(summary).toEqual({
      allPropagated: false,
      pending: 1,
      propagated: 1,
      total: 2,
    });
  });

  it('handles empty array gracefully', () => {
    const summary = checkPropagation([]);
    expect(summary).toEqual({
      allPropagated: true,
      pending: 0,
      propagated: 0,
      total: 0,
    });
  });

  it('returns allPropagated=false when all checks are pending', () => {
    const checks: PropagationCheck[] = [
      {
        actualValue: null,
        domain: 'example.com',
        expectedValue: '104.16.0.1',
        name: 'example.com',
        propagated: false,
        type: 'A',
      },
      {
        actualValue: null,
        domain: 'example.com',
        expectedValue: 'mail.example.com',
        name: 'example.com',
        propagated: false,
        type: 'MX',
      },
    ];

    const summary = checkPropagation(checks);
    expect(summary.allPropagated).toBe(false);
    expect(summary.propagated).toBe(0);
    expect(summary.pending).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// propagationStatus
// ---------------------------------------------------------------------------

describe('propagationStatus', () => {
  it('formats a mix of propagated and pending checks', () => {
    const checks: PropagationCheck[] = [
      {
        actualValue: '104.16.0.1',
        domain: 'example.com',
        expectedValue: '104.16.0.1',
        name: 'example.com',
        propagated: true,
        type: 'A',
      },
      {
        actualValue: null,
        domain: 'example.com',
        expectedValue: 'mail.example.com',
        name: 'example.com',
        propagated: false,
        type: 'MX',
      },
    ];

    const output = propagationStatus(checks);
    expect(output).toContain('✓');
    expect(output).toContain('✗');
    expect(output).toContain('→ propagated');
    expect(output).toContain('→ pending (not found in DNS)');
    expect(output).toContain('Propagation: 1 propagated, 1 pending — 2 total');
  });

  it('formats a pending mismatch with expected value shown', () => {
    const checks: PropagationCheck[] = [
      {
        actualValue: '1.2.3.4',
        domain: 'example.com',
        expectedValue: '104.16.0.1',
        name: 'example.com',
        propagated: false,
        type: 'A',
      },
    ];

    const output = propagationStatus(checks);
    expect(output).toContain('→ pending (expected: 104.16.0.1)');
    expect(output).toContain('Propagation: 0 propagated, 1 pending — 1 total');
  });

  it('returns zero summary for empty array', () => {
    const output = propagationStatus([]);
    expect(output).toBe('Propagation: 0 propagated, 0 pending — 0 total');
  });

  it('shows all propagated for a complete set', () => {
    const checks: PropagationCheck[] = [
      {
        actualValue: '104.16.0.1',
        domain: 'example.com',
        expectedValue: '104.16.0.1',
        name: 'example.com',
        propagated: true,
        type: 'A',
      },
      {
        actualValue: 'v=DMARC1; p=none',
        domain: 'example.com',
        expectedValue: 'v=DMARC1; p=none',
        name: '_dmarc.example.com',
        propagated: true,
        type: 'TXT',
      },
    ];

    const output = propagationStatus(checks);
    expect(output).toContain('✓');
    expect(output).not.toContain('✗');
    expect(output).toContain('Propagation: 2 propagated, 0 pending — 2 total');
  });

  it('includes all record types in output', () => {
    const checks: PropagationCheck[] = [
      {
        actualValue: '1.2.3.4',
        domain: 'example.com',
        expectedValue: '1.2.3.4',
        name: 'example.com',
        propagated: true,
        type: 'A',
      },
      {
        actualValue: 'example.com',
        domain: 'example.com',
        expectedValue: 'example.com',
        name: 'www.example.com',
        propagated: true,
        type: 'CNAME',
      },
    ];

    const output = propagationStatus(checks);
    expect(output).toContain('CNAME');
    expect(output).toContain('www.example.com');
  });
});
