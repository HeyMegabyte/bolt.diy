/**
 * @module services/dns_verify
 * @description DNS verification record builder and checker. Generates a set of
 * expected DNS records for a domain given a registrar/provider, then compares
 * actual DNS responses against those expectations. All exports are pure +
 * deterministic (no clock, no I/O), never throw.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One expected (or checked) DNS record within a verification plan. */
export interface DnsVerificationRecord {
  readonly type: string;
  readonly name: string;
  readonly expectedValue: string;
  readonly propagated: boolean;
}

/** The complete verification result for one domain. */
export interface DnsVerification {
  domain: string;
  records: DnsVerificationRecord[];
  allPass: boolean;
}

/** Supported DNS registrar/provider for verification plan generation. */
export type DnsProvider = 'cloudflare' | 'namecheap' | 'godaddy';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cloudflare anycast proxy IPs used for proxied DNS. */
const CF_PROXY_IPS: readonly string[] = ['104.16.0.1', '104.16.0.2'];

/** SES inbound SMTP endpoint for MX. */
const SES_INBOUND_MX = 'inbound-smtp.us-east-1.amazonaws.com';

/** Default DKIM selector. */
const DEFAULT_DKIM_SELECTOR = 'default';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the expected DNS verification plan for a domain given its DNS
 * provider/registrar. Returns a set of records the domain SHOULD have
 * pointing to the correct values — A (CF proxy), www CNAME, MX, SPF,
 * DKIM, DMARC, and a provider-specific ownership-verification record.
 * Pure + deterministic; empty/missing domain returns an empty plan.
 *
 * @param domain - The fully-qualified domain name (e.g. 'example.com').
 * @param provider - The DNS provider key.
 * @returns A {@link DnsVerification} with `propagated: false` and
 *   `allPass: false` — the caller passes the result to
 *   {@link checkVerification} with actual DNS records.
 *
 * @example
 * buildVerificationPlan('example.com', 'cloudflare');
 * // → { domain: 'example.com', records: [...], allPass: false }
 *
 * @example
 * buildVerificationPlan('example.org', 'namecheap');
 * // → Includes namecheap-specific verification TXT record
 */
export function buildVerificationPlan(domain: string, provider: DnsProvider): DnsVerification {
  const records: DnsVerificationRecord[] = [];

  if (!domain) {
    return { allPass: false, domain: '', records: [] };
  }

  // 1. Root A records — point to CF proxy IPs (common to all providers
  //    when Cloudflare is the DNS proxy, regardless of registrar)
  for (const ip of CF_PROXY_IPS) {
    records.push({
      expectedValue: ip,
      name: domain,
      propagated: false,
      type: 'A',
    });
  }

  // 2. www CNAME
  records.push({
    expectedValue: domain,
    name: `www.${domain}`,
    propagated: false,
    type: 'CNAME',
  });

  // 3. MX record for email
  records.push({
    expectedValue: SES_INBOUND_MX,
    name: domain,
    propagated: false,
    type: 'MX',
  });

  // 4. SPF TXT record
  records.push({
    expectedValue: 'v=spf1 include:amazonses.com ~all',
    name: domain,
    propagated: false,
    type: 'TXT',
  });

  // 5. DKIM CNAME record
  records.push({
    expectedValue: `${DEFAULT_DKIM_SELECTOR}.dkim.amazonses.com`,
    name: `${DEFAULT_DKIM_SELECTOR}._domainkey.${domain}`,
    propagated: false,
    type: 'CNAME',
  });

  // 6. DMARC TXT record
  records.push({
    expectedValue: 'v=DMARC1; p=none',
    name: `_dmarc.${domain}`,
    propagated: false,
    type: 'TXT',
  });

  // 7. Provider-specific verification record
  records.push(buildProviderVerification(domain, provider));

  return { allPass: false, domain, records };
}

/**
 * Compare a verification plan against actual DNS records and return a new
 * {@link DnsVerification} with `propagated` and `allPass` populated.
 * Pure + deterministic; never throws. An empty or null actual array
 * produces the plan unchanged (all `propagated: false`).
 *
 * Matching rules:
 * - **A / AAAA** — exact IP match.
 * - **CNAME** — target hostname match (value compared case-insensitively).
 * - **MX** — exchange hostname match (ignoring priority).
 * - **TXT** — `expectedValue` substring-present in the actual value.
 *
 * @param plan - The verification plan from {@link buildVerificationPlan}.
 * @param actualRecords - The records as returned by a DNS lookup.
 * @returns A copy of the plan with `propagated` set per record and
 *   `allPass` true only when every record is propagated.
 *
 * @example
 * const plan = buildVerificationPlan('example.com', 'cloudflare');
 * const actual = [
 *   { type: 'A', name: 'example.com', value: '104.16.0.1' },
 * ];
 * checkVerification(plan, actual);
 * // → one A record propagated=true, rest false, allPass=false
 */
export function checkVerification(
  plan: DnsVerification,
  actualRecords: { type: string; name: string; value: string }[],
): DnsVerification {
  if (!actualRecords || actualRecords.length === 0) {
    return plan;
  }

  const checked = plan.records.map((expected) => {
    const match = findMatchingRecord(expected, actualRecords);
    return { ...expected, propagated: match !== null };
  });

  const allPass = checked.every((r) => r.propagated);

  return { allPass, domain: plan.domain, records: checked };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the provider-specific verification record.
 *
 * @param domain - The domain to verify.
 * @param provider - The DNS provider.
 * @returns A single {@link DnsVerificationRecord} for ownership verification.
 */
function buildProviderVerification(domain: string, provider: DnsProvider): DnsVerificationRecord {
  switch (provider) {
    case 'cloudflare':
      return {
        expectedValue: `cf-verify=${domain}`,
        name: domain,
        propagated: false,
        type: 'TXT',
      };
    case 'namecheap':
      return {
        expectedValue: `namecheap-verification=${domain}`,
        name: domain,
        propagated: false,
        type: 'TXT',
      };
    case 'godaddy':
      return {
        expectedValue: `verify.godaddy.com`,
        name: `_verify.${domain}`,
        propagated: false,
        type: 'CNAME',
      };
  }
}

/**
 * Try to find an actual DNS record that matches an expected record.
 *
 * @param expected - The expected record from the plan.
 * @param actuals - The actual DNS records from a lookup.
 * @returns The matching actual record, or null.
 */
function findMatchingRecord(
  expected: DnsVerificationRecord,
  actuals: { type: string; name: string; value: string }[],
): { type: string; name: string; value: string } | null {
  // Match by type + name first (case-insensitive name to handle DNS
  // normalization; strip trailing dots which some DNS servers append)
  const normalizeName = (n: string) => n.replace(/\.+$/, '').toLowerCase();
  const candidates = actuals.filter(
    (a) => a.type === expected.type && normalizeName(a.name) === normalizeName(expected.name),
  );

  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    switch (expected.type) {
      case 'A':
      case 'AAAA':
        // Exact IP match
        if (candidate.value === expected.expectedValue) return candidate;
        break;

      case 'CNAME': {
        // Target hostname match, case-insensitive, ignoring trailing dot
        const cv = candidate.value.replace(/\.$/, '').toLowerCase();
        const ev = expected.expectedValue.replace(/\.$/, '').toLowerCase();
        if (cv === ev) return candidate;
        break;
      }

      case 'MX': {
        // Compare the exchange hostname, ignore priority
        const mxValue = candidate.value.split(/\s+/).pop() ?? '';
        const mx = mxValue.replace(/\.$/, '').toLowerCase();
        const ev = expected.expectedValue.replace(/\.$/, '').toLowerCase();
        if (mx === ev) return candidate;
        break;
      }

      case 'TXT': {
        // Substring presence — SPF `/` DKIM `/` DMARC values often have
        // additional attributes appended
        if (candidate.value.includes(expected.expectedValue)) return candidate;
        break;
      }

      default: {
        // Fallback: exact value match
        if (candidate.value === expected.expectedValue) return candidate;
        break;
      }
    }
  }

  return null;
}
