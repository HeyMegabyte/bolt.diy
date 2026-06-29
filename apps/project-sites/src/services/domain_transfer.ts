/**
 * @module services/domain_transfer
 * @description Domain transfer orchestration — pure zero-I/O transfer planner and
 * validation checker for the four supported registrars (Cloudflare, Namecheap,
 * GoDaddy, Route53). The transfer planning function returns provider-specific steps
 * plus the target nameserver set; the validation function checks domain syntax and
 * transfer-readiness heuristics. Neither function fetches external state.
 *
 * ## Provider steps
 *
 * Each from-provider has a distinctive unlock + auth-code flow:
 * - **Cloudflare**: disable registrar lock via PUT, then POST /transfer_out for EPP code.
 * - **Namecheap**: unlock via control panel or API, retrieve EPP code.
 * - **GoDaddy**: unlock via control panel, request authorization code.
 * - **Route53**: disable transfer lock via console/CLI, retrieve auth code.
 *
 * @packageDocumentation
 */

/** Supported registrars for domain transfer operations. */
export const PROVIDERS: readonly ['cloudflare', 'namecheap', 'godaddy', 'route53'] = Object.freeze([
  'cloudflare',
  'namecheap',
  'godaddy',
  'route53',
]);

/** Single registrar provider key. */
export type Provider = (typeof PROVIDERS)[number];

/** A single actionable transfer step. */
export interface TransferStep {
  /** Ordinal step number (1-based). */
  readonly step: number;
  /** Short imperative action label, e.g. "Unlock domain". */
  readonly action: string;
  /** Longer description of what to do and any provider-specific nuance. */
  readonly detail: string;
}

/** The full transfer plan returned by {@link transferDomain}. */
export interface TransferPlan {
  /** Ordered list of steps to execute. */
  readonly steps: TransferStep[];
  /** Nameservers the domain should point to for the target registrar. */
  readonly nameservers: string[];
}

/** A single validation finding for {@link validateTransfer}. */
export interface ValidationIssue {
  /** The aspect of the domain being checked. */
  readonly field: string;
  /** Human-readable description of the issue. */
  readonly message: string;
  /** Whether this blocks the transfer (`error`) or is advisory (`warning`). */
  readonly severity: 'error' | 'warning';
}

/** Result of {@link validateTransfer}. */
export interface ValidationResult {
  /** `true` when there are zero `error`-severity issues. */
  readonly valid: boolean;
  /** All findings, both errors and warnings. */
  readonly issues: ValidationIssue[];
}

/**
 * Registrar-specific unlock and auth-code steps keyed by from-provider. Used by
 * {@link transferDomain} to build the steps array for the source registrar.
 */
const FROM_STEPS: Record<Provider, ReadonlyArray<{ action: string; detail: string }>> = {
  cloudflare: [
    {
      action: 'Disable registrar lock',
      detail:
        'In the Cloudflare Dashboard, navigate to Registrar → Manage → domain → ' +
        'Configuration → toggle "Registrar lock" off, or call the API: ' +
        'PUT /accounts/{id}/registrar/domains/{name} with { "locked": false }.',
    },
    {
      action: 'Request EPP auth code',
      detail:
        'After unlocking, POST /accounts/{id}/registrar/domains/{name}/transfer_out. ' +
        'The EPP code appears in the response. It is valid for a limited window; copy it immediately.',
    },
  ],
  namecheap: [
    {
      action: 'Unlock domain',
      detail:
        'Log into the Namecheap Dashboard, go to Domain List → select the domain → ' +
        'toggle "REGISTRAR LOCK" to OFF under the Nameservers tab.',
    },
    {
      action: 'Retrieve EPP auth code',
      detail:
        'In the same domain detail view, click "Get EPP Code" or navigate to the ' +
        'Transfer tab. The code is emailed to the registrant email on file.',
    },
  ],
  godaddy: [
    {
      action: 'Unlock domain',
      detail:
        'In the GoDaddy Dashboard, go to My Products → Domains → Manage → ' +
        'toggle "Domain Lock" to OFF under the Settings tab.',
    },
    {
      action: 'Request authorization code',
      detail:
        'After unlocking, return to Settings → "Get Authorization Code". ' +
        'The code is emailed to the registrant contact email.',
    },
  ],
  route53: [
    {
      action: 'Disable transfer lock',
      detail:
        'In the AWS Route53 Console, go to Registered Domains → select the domain → ' +
        'disable "Transfer Lock" under the Actions menu, or use the CLI: ' +
        'aws route53domains disable-domain-transfer-lock --domain-name {name}.',
    },
    {
      action: 'Retrieve auth code',
      detail:
        'Run `aws route53domains get-domain-detail --domain-name {name}` and read ' +
        'the `AuthCode` field from the response.',
    },
  ],
};

/**
 * Known target-registrar nameserver addresses. Used by {@link transferDomain} to
 * populate the nameservers field of the returned plan.
 */
const TARGET_NS: Record<Provider, readonly string[]> = {
  cloudflare: ['melissa.ns.cloudflare.com', 'roan.ns.cloudflare.com'],
  namecheap: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'],
  godaddy: [
    'ns1.domaincontrol.com',
    'ns2.domaincontrol.com',
    'ns3.domaincontrol.com',
    'ns4.domaincontrol.com',
  ],
  route53: ['ns-1.awsdns-1.org', 'ns-2.awsdns-2.co.uk', 'ns-3.awsdns-3.com', 'ns-4.awsdns-4.net'],
};

/**
 * Build a transfer plan for moving a domain from one registrar to another.
 *
 * Returns an ordered list of steps for the source registrar and the
 * nameservers the target registrar will assign once the transfer completes.
 * This is purely informational — no API calls are made.
 *
 * @param domain       - The fully-qualified domain name (e.g. `example.com`).
 * @param fromProvider - The current registrar.
 * @param toProvider   - The destination registrar.
 * @returns A transfer plan with steps and target nameservers.
 *
 * @example
 * ```ts
 * const plan = transferDomain('example.com', 'godaddy', 'cloudflare');
 * // plan.steps.length === 3
 * // plan.nameservers === ['melissa.ns.cloudflare.com', 'roan.ns.cloudflare.com']
 * ```
 */
export function transferDomain(
  domain: string,
  fromProvider: Provider,
  toProvider: Provider,
): TransferPlan {
  const unlockSteps = FROM_STEPS[fromProvider];
  const nameservers = [...TARGET_NS[toProvider]];

  const steps: TransferStep[] = [
    ...unlockSteps.map((s, i) => ({
      step: i + 1,
      action: s.action,
      detail: s.detail,
    })),
    {
      step: unlockSteps.length + 1,
      action: 'Initiate transfer at target registrar',
      detail:
        `At ${toProvider}, begin the domain transfer process by providing the domain name ` +
        `and the EPP/auth code obtained above. Approve the transfer via email when prompted. ` +
        `Transfer typically completes in 5–7 days.`,
    },
  ];

  return { steps, nameservers };
}

/**
 * Validate that a domain string looks syntactically ready for transfer.
 *
 * Checks domain length, character rules, TLD presence, and common mistakes.
 * Does NOT query any external registry — only local heuristics.
 *
 * @param domain - The domain name to validate.
 * @returns A validation result with issues (if any) and a pass/fail flag.
 *
 * @example
 * ```ts
 * const r = validateTransfer('example.com');
 * // r.valid === true
 *
 * const r2 = validateTransfer('not-a-domain');
 * // r2.valid === false
 * // r2.issues[0].field === 'tld'
 * ```
 */
export function validateTransfer(domain: string): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!domain || domain.trim().length === 0) {
    issues.push({
      field: 'domain',
      message: 'Domain name is empty.',
      severity: 'error',
    });
    return { valid: false, issues };
  }

  const trimmed = domain.trim().toLowerCase();

  // Length check (max 253 chars for full domain, each label max 63)
  if (trimmed.length > 253) {
    issues.push({
      field: 'length',
      message: `Domain is ${trimmed.length} characters; the maximum for a fully-qualified domain is 253.`,
      severity: 'error',
    });
  }

  // TLD extraction and validation
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === trimmed.length - 1) {
    issues.push({
      field: 'tld',
      message:
        dotIndex === -1
          ? 'No top-level domain (TLD) found. A domain must include a TLD, e.g. ".com".'
          : 'TLD is empty. Ensure the domain ends with a valid TLD like ".com" or ".org".',
      severity: 'error',
    });
  }

  // Labels (everything before the TLD)
  if (dotIndex > 0) {
    const labels = trimmed.slice(0, dotIndex).split('.');

    if (labels.length > 127) {
      issues.push({
        field: 'labels',
        message: `Domain has ${labels.length} labels; the maximum is 127.`,
        severity: 'error',
      });
    }

    for (const label of labels) {
      if (label.length > 63) {
        issues.push({
          field: 'label_length',
          message: `Label "${label.slice(0, 20)}..." exceeds the maximum 63 characters per label.`,
          severity: 'error',
        });
      }

      if (label.startsWith('-') || label.endsWith('-')) {
        issues.push({
          field: 'label_hyphen',
          message: `Label "${label}" starts or ends with a hyphen; this is invalid for DNS.`,
          severity: 'error',
        });
      }

      if (!/^[a-z0-9-]+$/.test(label)) {
        issues.push({
          field: 'label_characters',
          message: `Label "${label}" contains invalid characters. Only lowercase letters, digits, and hyphens are allowed.`,
          severity: 'error',
        });
      }
    }
  }

  // Common TLD check (warn, not error)
  const knownTlds = [
    'com',
    'org',
    'net',
    'edu',
    'gov',
    'mil',
    'io',
    'co',
    'ai',
    'app',
    'dev',
    'me',
    'info',
    'biz',
    'xyz',
    'online',
    'site',
    'tech',
    'store',
    'cloud',
    'digital',
    'design',
    'media',
    'pro',
    'name',
    'one',
    'uk',
  ];

  if (dotIndex > 0 && dotIndex < trimmed.length - 1) {
    const tld = trimmed.slice(dotIndex + 1);
    if (!knownTlds.includes(tld)) {
      issues.push({
        field: 'tld_recognition',
        message: `TLD ".${tld}" is not in the common TLD list. Verify it is valid for domain transfer.`,
        severity: 'warning',
      });
    }
  }

  return {
    valid: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}
