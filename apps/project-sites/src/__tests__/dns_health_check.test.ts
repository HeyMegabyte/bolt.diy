import {
  checkRecord,
  aggregateChecks,
  formatCheckReport,
  type DnsRecordCheck,
} from '../services/dns_health_check.js';

// ---------------------------------------------------------------------------
// checkRecord
// ---------------------------------------------------------------------------

describe('checkRecord', () => {
  it('returns ok when actual matches expected', () => {
    const result = checkRecord('A', 'example.com', '104.16.0.1', '104.16.0.1');
    expect(result).toEqual<DnsRecordCheck>({
      type: 'A',
      name: 'example.com',
      expectedValue: '104.16.0.1',
      actualValue: '104.16.0.1',
      status: 'ok',
    });
  });

  it('returns missing when actual is null', () => {
    const result = checkRecord('A', 'example.com', '104.16.0.1', null);
    expect(result).toEqual<DnsRecordCheck>({
      type: 'A',
      name: 'example.com',
      expectedValue: '104.16.0.1',
      actualValue: null,
      status: 'missing',
    });
  });

  it('returns mismatch when actual differs from expected', () => {
    const result = checkRecord(
      'TXT',
      'example.com',
      'v=spf1 ~all',
      'v=spf1 include:amazonses.com ~all',
    );
    expect(result).toEqual<DnsRecordCheck>({
      type: 'TXT',
      name: 'example.com',
      expectedValue: 'v=spf1 ~all',
      actualValue: 'v=spf1 include:amazonses.com ~all',
      status: 'mismatch',
    });
  });

  it('handles CNAME records', () => {
    const result = checkRecord('CNAME', 'www.example.com', 'example.com.', 'example.com.');
    expect(result.status).toBe('ok');
    expect(result.actualValue).toBe('example.com.');
  });

  it('handles MX records with priority prefix in actual value', () => {
    // checkRecord does exact string comparison — MX priority differences
    // are a mismatch (intentionally; the caller normalizes before passing)
    const result = checkRecord(
      'MX',
      'example.com',
      'inbound-smtp.us-east-1.amazonaws.com',
      '10 inbound-smtp.us-east-1.amazonaws.com',
    );
    expect(result.status).toBe('mismatch');
  });

  it('preserves the expected and actual values unchanged', () => {
    const result = checkRecord('A', 'example.com', '10.0.0.1', '10.0.0.2');
    expect(result.expectedValue).toBe('10.0.0.1');
    expect(result.actualValue).toBe('10.0.0.2');
  });
});

// ---------------------------------------------------------------------------
// aggregateChecks
// ---------------------------------------------------------------------------

describe('aggregateChecks', () => {
  it('returns allOk=true when every check is ok', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'A',
        name: 'example.com',
        expectedValue: '1.1.1.1',
        actualValue: '1.1.1.1',
        status: 'ok',
      },
      {
        type: 'CNAME',
        name: 'www.example.com',
        expectedValue: 'example.com',
        actualValue: 'example.com',
        status: 'ok',
      },
    ];
    const result = aggregateChecks(checks);
    expect(result).toEqual({ pass: 2, fail: 0, total: 2, allOk: true });
  });

  it('returns allOk=false when a record is missing', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'A',
        name: 'example.com',
        expectedValue: '1.1.1.1',
        actualValue: '1.1.1.1',
        status: 'ok',
      },
      {
        type: 'CNAME',
        name: 'www.example.com',
        expectedValue: 'example.com',
        actualValue: null,
        status: 'missing',
      },
    ];
    const result = aggregateChecks(checks);
    expect(result).toEqual({ pass: 1, fail: 1, total: 2, allOk: false });
  });

  it('returns allOk=false when a record mismatches', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'A',
        name: 'example.com',
        expectedValue: '1.1.1.1',
        actualValue: '1.1.1.1',
        status: 'ok',
      },
      {
        type: 'TXT',
        name: 'example.com',
        expectedValue: 'v=spf1 ~all',
        actualValue: 'v=other ~all',
        status: 'mismatch',
      },
    ];
    const result = aggregateChecks(checks);
    expect(result).toEqual({ pass: 1, fail: 1, total: 2, allOk: false });
  });

  it('returns allOk=true for a single ok check', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'A',
        name: 'example.com',
        expectedValue: '1.1.1.1',
        actualValue: '1.1.1.1',
        status: 'ok',
      },
    ];
    const result = aggregateChecks(checks);
    expect(result).toEqual({ pass: 1, fail: 0, total: 1, allOk: true });
  });

  it('counts error status as fail', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'A',
        name: 'example.com',
        expectedValue: '1.1.1.1',
        actualValue: 'TIMEOUT',
        status: 'error',
      },
    ];
    const result = aggregateChecks(checks);
    expect(result).toEqual({ pass: 0, fail: 1, total: 1, allOk: false });
  });

  it('returns zero counts for empty input', () => {
    const result = aggregateChecks([]);
    expect(result).toEqual({ pass: 0, fail: 0, total: 0, allOk: true });
  });

  it('does not mutate the input array', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'A',
        name: 'example.com',
        expectedValue: '1.1.1.1',
        actualValue: '1.1.1.1',
        status: 'ok',
      },
    ];
    const frozen = Object.freeze(checks);
    expect(() => aggregateChecks(frozen)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatCheckReport
// ---------------------------------------------------------------------------

describe('formatCheckReport', () => {
  it('returns a summary line for empty input', () => {
    const report = formatCheckReport([]);
    expect(report).toBe('Pass: 0  Fail: 0  Total: 0');
  });

  it('includes checkmark for ok records', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'A',
        name: 'example.com',
        expectedValue: '104.16.0.1',
        actualValue: '104.16.0.1',
        status: 'ok',
      },
    ];
    const report = formatCheckReport(checks);
    expect(report).toContain('✓');
    expect(report).toContain('= 104.16.0.1');
    expect(report).toContain('Pass: 1  Fail: 0  Total: 1');
  });

  it('includes cross for mismatch records', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'A',
        name: 'example.com',
        expectedValue: '104.16.0.1',
        actualValue: '104.16.0.2',
        status: 'mismatch',
      },
    ];
    const report = formatCheckReport(checks);
    expect(report).toContain('✗');
    expect(report).toContain('≠ 104.16.0.2');
    expect(report).toContain('(expected: 104.16.0.1)');
  });

  it('includes dash for missing records', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'CNAME',
        name: 'www.example.com',
        expectedValue: 'example.com',
        actualValue: null,
        status: 'missing',
      },
    ];
    const report = formatCheckReport(checks);
    expect(report).toContain('-');
    expect(report).toContain('(missing)');
  });

  it('reports mixed results correctly', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'A',
        name: 'example.com',
        expectedValue: '1.1.1.1',
        actualValue: '1.1.1.1',
        status: 'ok',
      },
      {
        type: 'MX',
        name: 'example.com',
        expectedValue: 'mail.example.com',
        actualValue: null,
        status: 'missing',
      },
      {
        type: 'TXT',
        name: 'example.com',
        expectedValue: 'v=spf1 ~all',
        actualValue: 'v=other ~all',
        status: 'mismatch',
      },
    ];
    const report = formatCheckReport(checks);
    expect(report).toContain('✓');
    expect(report).toContain('-');
    expect(report).toContain('✗');
    expect(report).toContain('Pass: 1  Fail: 2  Total: 3');
  });

  it('returns one line per record plus a summary line', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'A',
        name: 'example.com',
        expectedValue: '1.1.1.1',
        actualValue: '1.1.1.1',
        status: 'ok',
      },
      {
        type: 'CNAME',
        name: 'www.example.com',
        expectedValue: 'example.com',
        actualValue: 'example.com',
        status: 'ok',
      },
    ];
    const report = formatCheckReport(checks);
    const lines = report.split('\n');
    expect(lines).toHaveLength(3); // 2 record lines + 1 summary
    expect(lines[2]).toBe('Pass: 2  Fail: 0  Total: 2');
  });

  it('handles error status records', () => {
    const checks: DnsRecordCheck[] = [
      {
        type: 'A',
        name: 'example.com',
        expectedValue: '1.1.1.1',
        actualValue: 'TIMEOUT',
        status: 'error',
      },
    ];
    const report = formatCheckReport(checks);
    expect(report).toContain('✗');
    expect(report).toContain('≠ TIMEOUT');
  });
});
