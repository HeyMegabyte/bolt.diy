/**
 * @module services/dns_provision
 * @description DNS provisioning record builder. Builds the complete DNS
 * provisioning plan for a custom domain on Cloudflare — A records (CF proxy
 * IPs), CNAME, MX, SPF, DKIM, DMARC, and domain-ownership verification TXT.
 * All exports are pure + deterministic (no clock, no I/O), never throw.
 *
 * @packageDocumentation
 */

/** DNS record types commonly used in zone files. */
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SRV';

/** A single DNS record within a provisioning plan. */
export interface DnsRecord {
  readonly type: DnsRecordType;
  /** '@' for the zone apex, or a subdomain label (e.g. 'www', '_dmarc'). */
  readonly name: string;
  readonly value: string;
  readonly ttl: number;
  /** MX/SRV priority (lower = higher precedence). */
  readonly priority?: number;
}

/** The complete DNS provisioning plan for one custom domain. */
export interface DnsProvisioning {
  readonly domain: string;
  readonly records: readonly DnsRecord[];
  /**
   * Cloudflare nameservers the registrar should be configured to use.
   * These are examples — every CF zone gets a unique pair on creation.
   */
  readonly nameservers: readonly string[];
  /**
   * The verification record the domain owner must add to prove ownership.
   * Null when `includeVerification` is false.
   */
  readonly verification: { type: 'TXT' | 'CNAME'; name: string; value: string } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default TTL for all generated records. */
export const DEFAULT_TTL = 3600;

/**
 * Representative Cloudflare proxy IP addresses (anycast).
 * Traffic to these IPs reaches Cloudflare's edge — the origin Worker is
 * connected via a route, not a direct DNS pointer.
 */
export const CF_PROXY_IPS: readonly string[] = ['104.16.0.1', '104.16.0.2'];

/**
 * Example Cloudflare nameservers. Every zone receives a unique pair on
 * creation (visible in the CF dashboard); the caller should substitute the
 * real values.
 */
export const DEFAULT_NAMESERVERS: readonly string[] = [
  'dave.ns.cloudflare.com',
  'dana.ns.cloudflare.com',
];

/** The email inbound gateway for SES. */
const SES_INBOUND_MX = 'inbound-smtp.us-east-1.amazonaws.com';

/** Default DKIM selector used by SES. */
const DEFAULT_DKIM_SELECTOR = 'default';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Options for {@link buildDnsPlan}.
 */
export interface BuildDnsPlanOptions {
  /** The custom domain being provisioned (e.g. 'example.com'). */
  domain: string;
  /**
   * The Worker's workers.dev hostname
   * (e.g. 'project-sites.workers.dev').
   */
  workerHostname: string;
  /** Whether to include MX + SPF + DKIM + DMARC records for email. */
  includeEmail?: boolean;
  /** Whether to include a TXT verification record for CF domain ownership. */
  includeVerification?: boolean;
  /**
   * The domain used for sending email (used in SPF/DKIM/DMARC).
   * Defaults to `opts.domain`.
   */
  sendingDomain?: string;
}

/**
 * Build the complete DNS provisioning plan for a custom domain on Cloudflare.
 * Pure + deterministic; never throws. Empty/missing inputs produce a minimal
 * plan with A + www CNAME only.
 *
 * @param opts - Configuration for the plan.
 * @returns The {@link DnsProvisioning} plan.
 *
 * @example
 * buildDnsPlan({
 *   domain: 'example.com',
 *   workerHostname: 'project-sites.workers.dev',
 * });
 * // → { domain: 'example.com', records: [...], nameservers: [...], ... }
 *
 * @example
 * buildDnsPlan({
 *   domain: 'example.com',
 *   workerHostname: 'project-sites.workers.dev',
 *   includeEmail: true,
 *   includeVerification: true,
 * });
 * // → Full plan with A, www CNAME, MX, SPF, DKIM, DMARC, verification TXT
 */
export function buildDnsPlan(opts: BuildDnsPlanOptions): DnsProvisioning {
  const domain = opts.domain ?? '';
  const workerHostname = opts.workerHostname ?? '';
  const includeEmail = opts.includeEmail ?? true;
  const includeVerification = opts.includeVerification ?? true;
  const sendingDomain = opts.sendingDomain ?? domain;

  const records: DnsRecord[] = [];

  // 1. Root A records pointing to CF proxy IPs
  for (const ip of CF_PROXY_IPS) {
    records.push({ name: '@', ttl: DEFAULT_TTL, type: 'A', value: ip });
  }

  // 2. www CNAME pointing to the Worker's workers.dev hostname
  if (workerHostname) {
    records.push({ name: 'www', ttl: DEFAULT_TTL, type: 'CNAME', value: workerHostname });
  }

  // 3. Email infrastructure (MX + SPF + DKIM + DMARC)
  if (includeEmail) {
    // MX
    records.push({
      name: '@',
      priority: 10,
      ttl: DEFAULT_TTL,
      type: 'MX',
      value: SES_INBOUND_MX,
    });

    // SPF
    records.push(generateSpfRecord());

    // DKIM
    records.push(generateDkimRecord(sendingDomain));

    // DMARC
    records.push(generateDmarcRecord());
  }

  // 4. Domain-ownership verification TXT
  let verification: { type: 'TXT' | 'CNAME'; name: string; value: string } | null = null;
  if (includeVerification) {
    verification = {
      name: '@',
      type: 'TXT',
      value: `cf-verify=${domain}`,
    };
  }

  return {
    domain,
    nameservers: Object.freeze([...DEFAULT_NAMESERVERS]),
    records: Object.freeze(records),
    verification,
  };
}

/**
 * Generate a DKIM DNS record for a sending domain.
 * SES uses CNAME records for DKIM — the actual token values are obtained
 * from the SES console after enabling DKIM signing.
 *
 * @param domain - The sending domain (e.g. 'example.com').
 * @param selector - The DKIM selector (defaults to 'default').
 * @returns A CNAME {@link DnsRecord} for the DKIM selector.
 *
 * @example
 * generateDkimRecord('example.com');
 * // → { type: 'CNAME', name: 'default._domainkey.example.com',
 * //     value: 'default.dkim.amazonses.com', ttl: 3600 }
 *
 * @example
 * generateDkimRecord('mail.example.com', 'ses2');
 * // → { type: 'CNAME', name: 'ses2._domainkey.mail.example.com',
 * //     value: 'ses2.dkim.amazonses.com', ttl: 3600 }
 */
export function generateDkimRecord(
  domain: string,
  selector: string = DEFAULT_DKIM_SELECTOR,
): DnsRecord {
  return {
    name: `${selector}._domainkey.${domain}`,
    ttl: DEFAULT_TTL,
    type: 'CNAME',
    value: `${selector}.dkim.amazonses.com`,
  };
}

/**
 * Generate the SPF (Sender Policy Framework) TXT record.
 *
 * @param includeService - The service to authorize in the SPF include
 *   (default 'amazonses.com').
 * @returns A TXT {@link DnsRecord} with a `~all` soft-fail policy.
 *
 * @example
 * generateSpfRecord();
 * // → { type: 'TXT', name: '@',
 * //     value: 'v=spf1 include:amazonses.com ~all', ttl: 3600 }
 */
export function generateSpfRecord(includeService = 'amazonses.com'): DnsRecord {
  return {
    name: '@',
    ttl: DEFAULT_TTL,
    type: 'TXT',
    value: `v=spf1 include:${includeService} ~all`,
  };
}

/**
 * Generate the DMARC (Domain-based Message Authentication, Reporting &
 * Conformance) TXT record.
 *
 * @param policy - The DMARC policy (default 'none').
 *   - `'none'`: monitoring only, no action on failures.
 *   - `'quarantine'`: mark failing mail as spam.
 *   - `'reject'`: reject failing mail outright.
 * @returns A TXT {@link DnsRecord} for `_dmarc`.
 *
 * @example
 * generateDmarcRecord('reject');
 * // → { type: 'TXT', name: '_dmarc',
 * //     value: 'v=DMARC1; p=reject', ttl: 3600 }
 */
export function generateDmarcRecord(policy: 'none' | 'quarantine' | 'reject' = 'none'): DnsRecord {
  return {
    name: '_dmarc',
    ttl: DEFAULT_TTL,
    type: 'TXT',
    value: `v=DMARC1; p=${policy}`,
  };
}
