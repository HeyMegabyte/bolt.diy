/**
 * @module services/email_signing
 * @description Pure zero-I/O parsers and validators for email-signing DNS
 * records: DKIM, SPF, and DMARC. Never throws; every parser returns the record
 * on success or `null` for any unparseable/missing/type-mismatched input.
 *
 * @packageDocumentation
 */

/** Tag values for the DKIM `k=` field. */
export type DkimAlgorithm = 'rsa-sha256' | 'ed25519';

/** SPF mechanism qualifier prefix. */
export type SpfQualifier = '+' | '-' | '~' | '?';

/** Parsed DKIM TXT record. */
export interface DkimRecord {
  readonly version: string;
  readonly algorithm: DkimAlgorithm;
  readonly selector: string;
  readonly domain: string;
  readonly publicKeyB64: string;
  readonly flags?: string[];
}

/** Parsed SPF TXT record. */
export interface SpfRecord {
  readonly version: string;
  readonly mechanisms: Array<{ qualifier: SpfQualifier; mechanism: string }>;
  readonly modifiers: Record<string, string>;
  readonly allMechanism: string | null;
}

/** Parsed DMARC TXT record. */
export interface DmarcRecord {
  readonly version: string;
  readonly policy: 'none' | 'quarantine' | 'reject';
  readonly subdomainPolicy?: string;
  readonly pct?: number;
  readonly rua?: string[];
  readonly ruf?: string[];
}

/**
 * Parse a raw DKIM TXT record into a structured {@link DkimRecord}.
 *
 * The input SHOULD include the selector and domain (e.g. `google._domainkey.example.com`)
 * so they can be extracted; when missing, `selector` defaults to `'default'` and
 * `domain` to `'unknown'`.
 *
 * @param raw - The raw TXT record content (tag=value semicolons).
 * @param selector - The DNS label before `._domainkey`, or the whole subdomain.
 * @param domain - The signing domain.
 * @returns A parsed record, or `null` for invalid input.
 *
 * @example
 * parseDkimRecord('v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb4...', 'google', 'example.com');
 * // → { version: 'DKIM1', algorithm: 'rsa-sha256', selector: 'google',
 * //     domain: 'example.com', publicKeyB64: 'MIGfMA0GCSqGSIb4...' }
 */
export function parseDkimRecord(
  raw: string,
  selector = 'default',
  domain = 'unknown',
): DkimRecord | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  const tags = parseTags(raw);
  const version = tags.get('v');
  if (version !== 'DKIM1') return null;

  const algorithmRaw = tags.get('k') ?? 'rsa';
  const algorithm: DkimAlgorithm = algorithmRaw === 'ed25519' ? 'ed25519' : 'rsa-sha256';

  const publicKeyB64 = tags.get('p') ?? '';
  if (publicKeyB64.length === 0) return null;

  const flagsRaw = tags.get('t');
  const flags = flagsRaw ? flagsRaw.split(':').map((s) => `t=${s.trim()}`) : undefined;

  return {
    algorithm,
    domain,
    flags,
    publicKeyB64,
    selector,
    version,
  };
}

/**
 * Parse a raw SPF TXT record.
 *
 * @param raw - The raw TXT record content (e.g. `v=spf1 include:_spf.google.com ~all`).
 * @returns A parsed record, or `null` for invalid input.
 *
 * @example
 * parseSpfRecord('v=spf1 include:_spf.google.com ~all');
 * // → { version: 'spf1', mechanisms: [{ qualifier: '+', mechanism: 'include:_spf.google.com' }],
 * //     modifiers: {}, allMechanism: '~all' }
 */
export function parseSpfRecord(raw: string): SpfRecord | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  const tokens = raw.trim().split(/\s+/);
  if (tokens[0] !== 'v=spf1') return null;

  const mechanisms: Array<{ qualifier: SpfQualifier; mechanism: string }> = [];
  const modifiers: Record<string, string> = {};
  let allMechanism: string | null = null;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    // Modifier – key=value form (e.g. redirect=_spf.example.com)
    const modMatch = token.match(/^([a-z]+)=(.+)$/i);
    if (modMatch) {
      modifiers[modMatch[1]] = modMatch[2];
      continue;
    }

    // all‑mechanism
    if (token.endsWith('all')) {
      allMechanism = token;
      continue;
    }

    // Mechanism with optional qualifier
    const qualifier: SpfQualifier =
      token[0] === '+' || token[0] === '-' || token[0] === '~' || token[0] === '?'
        ? (token[0] as SpfQualifier)
        : '+';
    const mechanism = qualifier === '+' ? token : token.slice(1);
    mechanisms.push({ mechanism, qualifier });
  }

  return {
    allMechanism,
    mechanisms,
    modifiers,
    version: 'spf1',
  };
}

/**
 * Parse a raw DMARC TXT record.
 *
 * @param raw - The raw TXT record content (e.g. `v=DMARC1; p=reject; rua=mailto:dmarc@...`).
 * @returns A parsed record, or `null` for invalid input.
 *
 * @example
 * parseDmarcRecord('v=DMARC1; p=reject; rua=mailto:dmarc-reports@example.com');
 * // → { version: 'DMARC1', policy: 'reject', rua: ['mailto:dmarc-reports@example.com'] }
 */
export function parseDmarcRecord(raw: string): DmarcRecord | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  const tags = parseTags(raw);
  const version = tags.get('v');
  if (version !== 'DMARC1') return null;

  const policyRaw = tags.get('p');
  if (!policyRaw || !['none', 'quarantine', 'reject'].includes(policyRaw)) return null;
  const policy = policyRaw as 'none' | 'quarantine' | 'reject';

  const spRaw = tags.get('sp');
  const subdomainPolicy =
    spRaw && ['none', 'quarantine', 'reject'].includes(spRaw) ? spRaw : undefined;

  const pctRaw = tags.get('pct');
  const pct = pctRaw ? clampPct(Number(pctRaw)) : undefined;

  const rua = parseUris(tags.get('rua'));
  const ruf = parseUris(tags.get('ruf'));

  return { pct, policy, rua, ruf, subdomainPolicy, version };
}

/**
 * Validate a DKIM base64 public key is (a) well-formed base64 and (b) a
 * reasonable length for a real key (128–4096 chars).
 *
 * @param b64 - The raw base64 string from the DKIM `p=` tag.
 * @returns `true` when the key looks valid.
 *
 * @example
 * isValidDkimKey('MIGfMA0GCSqGSIb4...'); // → true
 * isValidDkimKey('');                     // → false
 * isValidDkimKey('!!!');                  // → false
 */
export function isValidDkimKey(b64: string): boolean {
  if (typeof b64 !== 'string') return false;
  if (b64.length < 128 || b64.length > 4096) return false;
  // Check well-formed base64 (allow whitespace padding)
  return /^[A-Za-z0-9+/]*={0,2}$/.test(b64.trim());
}

/**
 * Build human- and DNS-paste-ready TXT record values for a domain's email
 * signing setup.
 *
 * @param opts - Configuration.
 * @returns Four record-value strings: dkim, spf, dmarc, and a verification
 * instruction paragraph.
 *
 * @example
 * buildDnsInstructions({ domain: 'example.com', sendingService: 'ses' });
 * // → { dkim: '...', spf: '...', dmarc: '...', verification: '...' }
 */
export function buildDnsInstructions(opts: {
  domain: string;
  sendingService?: 'ses' | 'listmonk' | 'custom';
  customValues?: { dkim?: string; spf?: string; dmarc?: string };
}): { dkim: string; spf: string; dmarc: string; verification: string } {
  const d = opts.domain;
  const service = opts.sendingService ?? 'custom';

  const dkim =
    opts.customValues?.dkim ??
    `${service === 'ses' ? 'ses' : service === 'listmonk' ? 'dkim' : 'default'}._domainkey.${d}  TXT  "v=DKIM1; k=rsa; p=YOUR_PUBLIC_KEY"`;

  const spf =
    opts.customValues?.spf ??
    (service === 'ses'
      ? `${d}  TXT  "v=spf1 include:amazonses.com ~all"`
      : service === 'listmonk'
        ? `${d}  TXT  "v=spf1 mx include:_spf.${d} ~all"`
        : `${d}  TXT  "v=spf1 mx ~all"`);

  const dmarc =
    opts.customValues?.dmarc ??
    `_dmarc.${d}  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${d}; sp=none; pct=100"`;

  const verification =
    `After adding these records to ${d}'s DNS zone, verify propagation:\n` +
    `  dig +short ${d} TXT | grep 'v=spf1'  → SPF present\n` +
    `  dig +short _dmarc.${d} TXT           → DMARC present\n` +
    `  dig +short default._domainkey.${d} TXT → DKIM present\n` +
    `Then send a test email and check headers for Authentication-Results: dkim=pass / spf=pass / dmarc=pass.`;

  return { dkim, dmarc, spf, verification };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a semicolon-separated `tag=value` string into a Map.
 * Handles optional whitespace around delimiters.
 */
function parseTags(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  const parts = raw.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key.length > 0) {
      map.set(key, value);
    }
  }
  return map;
}

/** Clamp a percentage to 1–100. */
function clampPct(n: number): number | undefined {
  if (Number.isNaN(n)) return undefined;
  if (n < 1) return 1;
  if (n > 100) return 100;
  return Math.round(n);
}

/** Parse `mailto:` URIs from a semicolon-separated DMARC tag value. */
function parseUris(raw: string | undefined): string[] | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('mailto:') && s.length > 7);
}
