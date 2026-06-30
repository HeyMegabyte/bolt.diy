/**
 * @module services/dmarc_report
 * @description DMARC aggregate report parser, compliance assessor, and summary
 * generator. Pure functions — no I/O, no external dependencies. Parses XML DMARC
 * aggregate reports (RFC 7489), scores domain alignment compliance, and produces
 * rollup summaries for monitoring and alerting.
 *
 * @packageDocumentation
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface DmarcDateRange {
  begin: Date;
  end: Date;
}

export interface DmarcReportMetadata {
  dateRange: DmarcDateRange;
  email: string;
  extraContactInfo?: string;
  orgName: string;
  reportId: string;
}

export interface DmarcPolicyPublished {
  adkim: string;
  aspf: string;
  domain: string;
  p: string;
  pct: number;
  sp: string;
}

export interface DmarcAuthResult {
  domain: string;
  result: string;
  selector?: string;
}

export interface DmarcRecord {
  count: number;
  disposition: string;
  dkim: string;
  dkimAuth: DmarcAuthResult | null;
  headerFrom: string;
  sourceIp: string;
  spf: string;
  spfAuth: DmarcAuthResult | null;
}

export interface DmarcReport {
  metadata: DmarcReportMetadata;
  policy: DmarcPolicyPublished;
  records: DmarcRecord[];
}

export interface DmarcCompliance {
  compliant: boolean;
  failedMessages: number;
  passRate: number;
  passedMessages: number;
  reasons: string[];
  totalMessages: number;
}

export interface DmarcSummary {
  compliantReports: number;
  domainBreakdown: Record<string, { passRate: number; total: number }>;
  nonCompliantReports: number;
  overallPassRate: number;
  reportCount: number;
  topIssues: string[];
  totalMessages: number;
}

// ── Constants ──────────────────────────────────────────────────────────

/** Default pass-rate threshold for compliance. */
const COMPLIANCE_THRESHOLD = 0.95;

// ── Helpers ────────────────────────────────────────────────────────────

/** Extract text content from the first occurrence of an XML tag. */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'i');
  const m = re.exec(xml);
  return m ? m[1].trim() : '';
}

/** Extract the block of XML between opening and closing tags. */
function extractBlock(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

// ── parseDmarcReport ───────────────────────────────────────────────────

/**
 * Parse a DMARC aggregate report XML string into a typed {@link DmarcReport}.
 * Pure function — never throws, never performs I/O. Returns `null` on
 * unparseable input (empty string, missing `<feedback>` root).
 *
 * @param xml - Raw DMARC aggregate report XML (RFC 7489).
 * @returns The parsed report, or `null` if input lacks a `<feedback>` root.
 *
 * @example
 * const report = parseDmarcReport(rawXml);
 * if (report) console.log(report.metadata.orgName);
 */
export function parseDmarcReport(xml: string): DmarcReport | null {
  const cleaned = xml.trim();
  if (!cleaned || !/<feedback>/i.test(cleaned)) return null;

  // Extract metadata
  const metaBlock = extractBlock(cleaned, 'report_metadata')[0] ?? '';
  const beginTs = Number(extractTag(metaBlock, 'begin')) * 1000;
  const endTs = Number(extractTag(metaBlock, 'end')) * 1000;

  const metadata: DmarcReportMetadata = {
    dateRange: {
      begin: new Date(beginTs),
      end: new Date(endTs),
    },
    email: extractTag(metaBlock, 'email'),
    extraContactInfo: extractTag(metaBlock, 'extra_contact_info') || undefined,
    orgName: extractTag(metaBlock, 'org_name'),
    reportId: extractTag(metaBlock, 'report_id'),
  };

  // Policy published
  const policyBlock = extractBlock(cleaned, 'policy_published')[0] ?? '';
  const policy: DmarcPolicyPublished = {
    adkim: extractTag(policyBlock, 'adkim') || 'r',
    aspf: extractTag(policyBlock, 'aspf') || 'r',
    domain: extractTag(policyBlock, 'domain'),
    p: extractTag(policyBlock, 'p') || 'none',
    pct: Number(extractTag(policyBlock, 'pct')) || 100,
    sp: extractTag(policyBlock, 'sp') || extractTag(policyBlock, 'p') || 'none',
  };

  // Records
  const recordBlocks = extractBlock(cleaned, 'record');
  const records: DmarcRecord[] = recordBlocks.map((rb) => {
    const rowBlock = extractBlock(rb, 'row')[0] ?? '';
    const idBlock = extractBlock(rb, 'identifiers')[0] ?? '';
    const authBlock = extractBlock(rb, 'auth_results')[0] ?? '';
    const peBlock = extractBlock(rowBlock, 'policy_evaluated')[0] ?? '';

    const dkimResult = extractTag(peBlock, 'dkim') || 'none';
    const spfResult = extractTag(peBlock, 'spf') || 'none';

    // Auth results detail
    const dkimBlocks = extractBlock(authBlock, 'dkim');
    const spfBlocks = extractBlock(authBlock, 'spf');

    const dkimAuth: DmarcAuthResult | null =
      dkimBlocks.length > 0
        ? {
            domain: extractTag(dkimBlocks[0], 'domain'),
            result: extractTag(dkimBlocks[0], 'result'),
            selector: extractTag(dkimBlocks[0], 'selector') || undefined,
          }
        : null;

    const spfAuth: DmarcAuthResult | null =
      spfBlocks.length > 0
        ? {
            domain: extractTag(spfBlocks[0], 'domain'),
            result: extractTag(spfBlocks[0], 'result'),
            selector: undefined,
          }
        : null;

    return {
      count: Number(extractTag(rowBlock, 'count')) || 1,
      disposition: extractTag(peBlock, 'disposition') || 'none',
      dkim: dkimResult,
      dkimAuth,
      headerFrom: extractTag(idBlock, 'header_from'),
      sourceIp: extractTag(rowBlock, 'source_ip'),
      spf: spfResult,
      spfAuth,
    };
  });

  return { metadata, policy, records };
}

// ── dmarcCompliance ────────────────────────────────────────────────────

/**
 * Assess whether a parsed DMARC report passes compliance. A report is
 * compliant when ≥95% of messages pass either SPF or DKIM authentication
 * with domain alignment.
 *
 * @param report - A parsed {@link DmarcReport}.
 * @param threshold - Minimum pass rate to be compliant (default 0.95).
 * @returns The {@link DmarcCompliance} assessment.
 *
 * @example
 * const c = dmarcCompliance(report);
 * c.compliant // true if ≥95% pass
 */
export function dmarcCompliance(
  report: DmarcReport,
  threshold = COMPLIANCE_THRESHOLD,
): DmarcCompliance {
  const totalMessages = report.records.reduce((sum, r) => sum + r.count, 0);
  const passedMessages = report.records
    .filter((r) => r.dkim === 'pass' || r.spf === 'pass')
    .reduce((sum, r) => sum + r.count, 0);
  const failedMessages = totalMessages - passedMessages;
  const passRate = totalMessages > 0 ? passedMessages / totalMessages : 0;

  const reasons: string[] = [];
  if (passRate < threshold) {
    reasons.push(
      `pass rate ${(passRate * 100).toFixed(1)}% below ${(threshold * 100).toFixed(0)}% threshold`,
    );
  }
  if (report.policy.p !== 'reject' && report.policy.p !== 'quarantine') {
    reasons.push(`policy is "${report.policy.p}" — should be "reject" or "quarantine"`);
  }
  if (report.policy.pct < 100) {
    reasons.push(`pct is ${report.policy.pct}% — not all mail is subject to policy`);
  }
  if (!report.records.some((r) => r.dkim === 'pass')) {
    reasons.push('no DKIM-passing records found');
  }

  return {
    compliant: passRate >= threshold,
    failedMessages,
    passedMessages,
    passRate,
    reasons,
    totalMessages,
  };
}

// ── dmarcSummary ───────────────────────────────────────────────────────

/**
 * Summarize an array of DMARC reports into a rollup overview. Useful for
 * dashboards, weekly digests, and alerting on aggregate trends.
 *
 * @param reports - An array of parsed {@link DmarcReport} objects.
 * @returns The {@link DmarcSummary} rollup.
 *
 * @example
 * const s = dmarcSummary([reportA, reportB]);
 * console.log(s.overallPassRate, s.topIssues);
 */
export function dmarcSummary(reports: DmarcReport[]): DmarcSummary {
  if (reports.length === 0) {
    return {
      compliantReports: 0,
      domainBreakdown: {},
      nonCompliantReports: 0,
      overallPassRate: 0,
      reportCount: 0,
      topIssues: [],
      totalMessages: 0,
    };
  }

  const complianceResults = reports.map((r) => dmarcCompliance(r));
  const totalMessages = complianceResults.reduce((s, c) => s + c.totalMessages, 0);
  const totalPassed = complianceResults.reduce((s, c) => s + c.passedMessages, 0);
  const overallPassRate = totalMessages > 0 ? totalPassed / totalMessages : 0;
  const compliantReports = complianceResults.filter((c) => c.compliant).length;
  const nonCompliantReports = complianceResults.filter((c) => !c.compliant).length;

  // Domain breakdown — tally totals per domain
  const domainBreakdown: Record<string, { passRate: number; total: number }> = {};
  const domainPassed: Record<string, number> = {};
  for (const report of reports) {
    const domain = report.policy.domain;
    if (!domainBreakdown[domain]) {
      domainBreakdown[domain] = { passRate: 0, total: 0 };
    }
    if (!domainPassed[domain]) {
      domainPassed[domain] = 0;
    }
    const domainTotal = report.records.reduce((s, r) => s + r.count, 0);
    domainBreakdown[domain].total += domainTotal;
    domainPassed[domain] += report.records
      .filter((r) => r.dkim === 'pass' || r.spf === 'pass')
      .reduce((s, r) => s + r.count, 0);
  }
  for (const domain of Object.keys(domainBreakdown)) {
    domainBreakdown[domain].passRate =
      domainBreakdown[domain].total > 0
        ? (domainPassed[domain] ?? 0) / domainBreakdown[domain].total
        : 0;
  }

  // Collect top issues (aggregated)
  const allReasons = complianceResults.flatMap((c) => c.reasons);
  const issueCounts = new Map<string, number>();
  for (const reason of allReasons) {
    issueCounts.set(reason, (issueCounts.get(reason) ?? 0) + 1);
  }
  const topIssues = [...issueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([issue]) => issue);

  return {
    compliantReports,
    domainBreakdown,
    nonCompliantReports,
    overallPassRate,
    reportCount: reports.length,
    topIssues,
    totalMessages,
  };
}
