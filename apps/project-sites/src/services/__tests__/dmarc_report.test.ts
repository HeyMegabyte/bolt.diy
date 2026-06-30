import { parseDmarcReport, dmarcCompliance, dmarcSummary } from '../dmarc_report';

// ── Fixtures ───────────────────────────────────────────────────────────

/** Full DMARC aggregate XML — passes DKIM, passes SPF, strict policy. */
const PASSING_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>google.com</org_name>
    <email>noreply@dmarc.google.com</email>
    <extra_contact_info>https://support.google.com</extra_contact_info>
    <report_id>1234567890.12345</report_id>
    <date_range>
      <begin>1719792000</begin>
      <end>1719878399</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>example.org</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>reject</p>
    <sp>reject</sp>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>192.0.2.1</source_ip>
      <count>5</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>example.org</header_from>
    </identifiers>
    <auth_results>
      <dkim>
        <domain>example.org</domain>
        <result>pass</result>
        <selector>google</selector>
      </dkim>
      <spf>
        <domain>example.org</domain>
        <result>pass</result>
      </spf>
    </auth_results>
  </record>
  <record>
    <row>
      <source_ip>198.51.100.1</source_ip>
      <count>3</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>fail</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>example.org</header_from>
    </identifiers>
    <auth_results>
      <dkim>
        <domain>example.org</domain>
        <result>pass</result>
        <selector>google</selector>
      </dkim>
      <spf>
        <domain>spoof.example</domain>
        <result>fail</result>
      </spf>
    </auth_results>
  </record>
</feedback>`;

/** DMARC XML with failing auth and lenient policy. */
const FAILING_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>proofpoint.com</org_name>
    <email>dmarc@proofpoint.com</email>
    <report_id>abc-def-ghi</report_id>
    <date_range>
      <begin>1719705600</begin>
      <end>1719791999</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>example.org</domain>
    <adkim>s</adkim>
    <aspf>s</aspf>
    <p>none</p>
    <pct>50</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>203.0.113.1</source_ip>
      <count>10</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>fail</dkim>
        <spf>fail</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>spoof.example.org</header_from>
    </identifiers>
    <auth_results>
      <dkim>
        <domain>spoof.example.org</domain>
        <result>fail</result>
      </dkim>
      <spf>
        <domain>spoof.example.org</domain>
        <result>fail</result>
      </spf>
    </auth_results>
  </record>
</feedback>`;

/** Minimal DMARC XML with no records. */
const MINIMAL_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>minimal-isp.com</org_name>
    <email>dmarc@minimal-isp.com</email>
    <report_id>min-001</report_id>
    <date_range>
      <begin>1719619200</begin>
      <end>1719705599</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>example.org</domain>
    <p>quarantine</p>
    <pct>100</pct>
  </policy_published>
</feedback>`;

// ── parseDmarcReport ───────────────────────────────────────────────────

describe('parseDmarcReport', () => {
  it('parses a valid DMARC aggregate XML report', () => {
    const report = parseDmarcReport(PASSING_XML);
    expect(report).not.toBeNull();
    expect(report!.metadata.orgName).toBe('google.com');
    expect(report!.metadata.email).toBe('noreply@dmarc.google.com');
    expect(report!.metadata.extraContactInfo).toBe('https://support.google.com');
    expect(report!.metadata.reportId).toBe('1234567890.12345');
    expect(report!.metadata.dateRange.begin).toEqual(new Date(1719792000 * 1000));
    expect(report!.metadata.dateRange.end).toEqual(new Date(1719878399 * 1000));
  });

  it('parses policy_published fields', () => {
    const report = parseDmarcReport(PASSING_XML);
    expect(report!.policy.domain).toBe('example.org');
    expect(report!.policy.adkim).toBe('r');
    expect(report!.policy.aspf).toBe('r');
    expect(report!.policy.p).toBe('reject');
    expect(report!.policy.sp).toBe('reject');
    expect(report!.policy.pct).toBe(100);
  });

  it('parses record rows with auth results', () => {
    const report = parseDmarcReport(PASSING_XML);
    expect(report!.records).toHaveLength(2);

    const r0 = report!.records[0];
    expect(r0.sourceIp).toBe('192.0.2.1');
    expect(r0.count).toBe(5);
    expect(r0.dkim).toBe('pass');
    expect(r0.spf).toBe('pass');
    expect(r0.disposition).toBe('none');
    expect(r0.headerFrom).toBe('example.org');
    expect(r0.dkimAuth!.domain).toBe('example.org');
    expect(r0.dkimAuth!.result).toBe('pass');
    expect(r0.dkimAuth!.selector).toBe('google');
    expect(r0.spfAuth!.domain).toBe('example.org');
    expect(r0.spfAuth!.result).toBe('pass');

    const r1 = report!.records[1];
    expect(r1.sourceIp).toBe('198.51.100.1');
    expect(r1.count).toBe(3);
    expect(r1.dkim).toBe('pass');
    expect(r1.spf).toBe('fail');
    expect(r1.dkimAuth!.selector).toBe('google');
    expect(r1.spfAuth!.domain).toBe('spoof.example');
  });

  it('parses a failing report with lenient policy', () => {
    const report = parseDmarcReport(FAILING_XML);
    expect(report).not.toBeNull();
    expect(report!.metadata.orgName).toBe('proofpoint.com');
    expect(report!.policy.p).toBe('none');
    expect(report!.policy.pct).toBe(50);
    expect(report!.records).toHaveLength(1);
    expect(report!.records[0].dkim).toBe('fail');
    expect(report!.records[0].spf).toBe('fail');
    expect(report!.records[0].headerFrom).toBe('spoof.example.org');
  });

  it('handles a report with no records', () => {
    const report = parseDmarcReport(MINIMAL_XML);
    expect(report).not.toBeNull();
    expect(report!.metadata.orgName).toBe('minimal-isp.com');
    expect(report!.records).toHaveLength(0);
    expect(report!.policy.p).toBe('quarantine');
  });

  it('returns null for empty string', () => {
    expect(parseDmarcReport('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(parseDmarcReport('   \n  \t  ')).toBeNull();
  });

  it('returns null for non-DMARC XML', () => {
    expect(parseDmarcReport('<root><x>y</x></root>')).toBeNull();
  });

  it('fills defaults for missing policy fields', () => {
    const result = parseDmarcReport(MINIMAL_XML);
    expect(result!.policy.adkim).toBe('r');
    expect(result!.policy.aspf).toBe('r');
    expect(result!.policy.sp).toBe('quarantine'); // falls back to p value
    expect(result!.policy.pct).toBe(100);
  });

  it('defaults record count to 1 when not present', () => {
    const noCountXml = PASSING_XML.replace('<count>5</count>', '');
    const report = parseDmarcReport(noCountXml);
    expect(report!.records[0].count).toBe(1);
  });

  it('case-insensitively matches <feedback> root', () => {
    const weirdCase = PASSING_XML.replace('<feedback>', '<feedBack>');
    const report = parseDmarcReport(weirdCase);
    expect(report).not.toBeNull();
  });
});

// ── dmarcCompliance ────────────────────────────────────────────────────

describe('dmarcCompliance', () => {
  it('marks report compliant when pass rate meets threshold', () => {
    const report = parseDmarcReport(PASSING_XML)!;
    const c = dmarcCompliance(report);
    // 8 total, 8 passed (5 dkim+spf both pass, 3 dkim-only pass)
    expect(c.totalMessages).toBe(8);
    expect(c.passedMessages).toBe(8);
    expect(c.failedMessages).toBe(0);
    expect(c.passRate).toBe(1);
    expect(c.compliant).toBe(true);
    expect(c.reasons).toHaveLength(0);
  });

  it('marks report non-compliant when pass rate is below threshold', () => {
    const report = parseDmarcReport(FAILING_XML)!;
    const c = dmarcCompliance(report);
    expect(c.totalMessages).toBe(10);
    expect(c.passedMessages).toBe(0);
    expect(c.failedMessages).toBe(10);
    expect(c.passRate).toBe(0);
    expect(c.compliant).toBe(false);
    expect(c.reasons.length).toBeGreaterThan(0);
    expect(c.reasons[0]).toMatch(/pass rate/);
  });

  it('flags lenient policy as a reason', () => {
    const report = parseDmarcReport(FAILING_XML)!;
    const c = dmarcCompliance(report);
    expect(c.reasons.some((r) => r.includes('policy is "none"'))).toBe(true);
  });

  it('flags partial pct as a reason', () => {
    const report = parseDmarcReport(FAILING_XML)!;
    const c = dmarcCompliance(report);
    expect(c.reasons.some((r) => r.includes('pct is 50%'))).toBe(true);
  });

  it('flags missing DKIM-passing records', () => {
    const report = parseDmarcReport(FAILING_XML)!;
    const c = dmarcCompliance(report);
    expect(c.reasons.some((r) => r.includes('no DKIM-passing records'))).toBe(true);
  });

  it('handles empty records (no messages)', () => {
    const report = parseDmarcReport(MINIMAL_XML)!;
    const c = dmarcCompliance(report);
    expect(c.totalMessages).toBe(0);
    expect(c.passRate).toBe(0);
    expect(c.compliant).toBe(false);
    expect(c.reasons.length).toBeGreaterThan(0);
  });

  it('respects a custom threshold', () => {
    const report = parseDmarcReport(PASSING_XML)!;
    // With threshold 1.0, 8/8 = 1.0, still compliant
    expect(dmarcCompliance(report, 1.0).compliant).toBe(true);
    // With threshold 0.5, pass rate is 1.0, still compliant
    expect(dmarcCompliance(report, 0.5).compliant).toBe(true);
  });

  it('detects non-compliant with partial pass', () => {
    // Build a report with 7/10 passing (70% < 95%)
    const partialPassXml = PASSING_XML.replace('<count>5</count>', '<count>3</count>').replace(
      `<spf>fail</spf>`,
      `<spf>fail</spf>`,
    );
    // After the replacement, add a 3rd failing record
    const extended = partialPassXml.replace(
      '</feedback>',
      `  <record>
    <row>
      <source_ip>203.0.113.9</source_ip>
      <count>7</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>fail</dkim>
        <spf>fail</spf>
      </policy_evaluated>
    </row>
    <identifiers><header_from>evil.example</header_from></identifiers>
    <auth_results>
      <dkim><domain>evil.example</domain><result>fail</result></dkim>
      <spf><domain>evil.example</domain><result>fail</result></spf>
    </auth_results>
  </record>
</feedback>`,
    );
    const report = parseDmarcReport(extended)!;
    const c = dmarcCompliance(report);
    // 3 + 3 + 7 = 13 total; 3 + 3 = 6 passed (dkim or spf)
    expect(c.totalMessages).toBe(13);
    expect(c.passedMessages).toBe(6);
    expect(c.passRate).toBeCloseTo(6 / 13, 5);
    expect(c.compliant).toBe(false);
  });
});

// ── dmarcSummary ───────────────────────────────────────────────────────

describe('dmarcSummary', () => {
  it('summarizes a single passing report', () => {
    const report = parseDmarcReport(PASSING_XML)!;
    const s = dmarcSummary([report]);
    expect(s.reportCount).toBe(1);
    expect(s.totalMessages).toBe(8);
    expect(s.overallPassRate).toBe(1);
    expect(s.compliantReports).toBe(1);
    expect(s.nonCompliantReports).toBe(0);
    expect(Object.keys(s.domainBreakdown)).toEqual(['example.org']);
    expect(s.domainBreakdown['example.org'].total).toBe(8);
    expect(s.domainBreakdown['example.org'].passRate).toBe(1);
    expect(s.topIssues).toHaveLength(0);
  });

  it('summarizes multiple reports across domains', () => {
    const passing = parseDmarcReport(PASSING_XML)!;
    const failing = parseDmarcReport(FAILING_XML)!;
    const s = dmarcSummary([passing, failing]);

    expect(s.reportCount).toBe(2);
    expect(s.totalMessages).toBe(18); // 8 + 10
    expect(s.overallPassRate).toBeCloseTo(8 / 18, 5); // 8 pass / 18 total
    expect(s.compliantReports).toBe(1);
    expect(s.nonCompliantReports).toBe(1);
  });

  it('aggregates domain breakdown across multiple reports', () => {
    const passing = parseDmarcReport(PASSING_XML)!;
    const failing = parseDmarcReport(FAILING_XML)!;
    const s = dmarcSummary([passing, failing]);

    expect(s.domainBreakdown['example.org']).toBeDefined();
    expect(s.domainBreakdown['example.org'].total).toBe(18);
    expect(s.domainBreakdown['example.org'].passRate).toBeCloseTo(8 / 18, 5);
  });

  it('returns top issues from non-compliant reports', () => {
    const passing = parseDmarcReport(PASSING_XML)!;
    const failing = parseDmarcReport(FAILING_XML)!;
    const s = dmarcSummary([passing, failing]);

    expect(s.topIssues.length).toBeGreaterThan(0);
    // "policy is none" and "no DKIM-passing" should appear
    const joined = s.topIssues.join(' ');
    expect(joined).toMatch(/policy/);
  });

  it('returns empty summary for empty array', () => {
    const s = dmarcSummary([]);
    expect(s.reportCount).toBe(0);
    expect(s.totalMessages).toBe(0);
    expect(s.overallPassRate).toBe(0);
    expect(s.compliantReports).toBe(0);
    expect(s.nonCompliantReports).toBe(0);
    expect(s.domainBreakdown).toEqual({});
    expect(s.topIssues).toHaveLength(0);
  });

  it('returns empty domain breakdown when no reports', () => {
    const s = dmarcSummary([]);
    expect(Object.keys(s.domainBreakdown)).toHaveLength(0);
  });
});
