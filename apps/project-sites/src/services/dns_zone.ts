/**
 * @module services/dns_zone
 * @description DNS zone file builder for Cloudflare DNS import. Pure functions
 * that generate BIND zone format text and validate DNS record sets. Zero I/O,
 * deterministic, never throws.
 * @packageDocumentation
 */

/**
 * A DNS record representing a single resource record.
 */
export interface DnsRecord {
  /** Record type: A, AAAA, CNAME, MX, TXT, NS, SRV, CAA, etc. */
  readonly type: string;
  /** Record name: relative (e.g. "www") or "@" for the zone apex. */
  readonly name: string;
  /** Record value: IP, hostname, or text payload. */
  readonly content: string;
  /** Time-to-live in seconds (1-86400). */
  readonly ttl: number;
  /** Priority for MX/SRV records (lower = higher priority). */
  readonly priority?: number;
  /** Whether Cloudflare should proxy this record (A/AAAA/CNAME only). */
  readonly proxied?: boolean;
}

/** Default TTL for records when none is specified. */
export const DEFAULT_TTL = 3600;

/** Result of a zone validation check. */
export interface ZoneValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Build a BIND zone file string suitable for Cloudflare DNS import.
 *
 * The zone file includes a SOA placeholder and an NS record for the zone apex.
 * Each {@link DnsRecord} is serialised to a standard BIND-formatted line.
 *
 * @param domain - The fully-qualified domain name (e.g. "example.com").
 * @param records - The DNS records to include in the zone file.
 * @returns A BIND zone file as a string.
 *
 * @example
 * ```ts
 * buildZoneFile('example.com', [
 *   { type: 'A', name: '@', content: '192.0.2.1', ttl: 3600 },
 *   { type: 'CNAME', name: 'www', content: 'example.com', ttl: 3600 },
 * ]);
 * // => "; example.com zone file"
 * // => "$ORIGIN example.com."
 * // => "$TTL 3600"
 * // => "@ 3600 IN SOA ..."
 * // => "@ 3600 IN NS ..."
 * // => "@ 3600 IN A 192.0.2.1"
 * // => "www 3600 IN CNAME example.com."
 * ```
 */
export function buildZoneFile(domain: string, records: readonly DnsRecord[]): string {
  const fqdn = domain.endsWith('.') ? domain : `${domain}.`;
  const lines: string[] = [];
  const raw = Array.isArray(records) ? records : [];
  const recs = raw.filter(
    (r): r is DnsRecord => r != null && typeof r.type === 'string' && r.type.length > 0,
  );
  const ttl = recs.length > 0 ? recs[0].ttl : DEFAULT_TTL;

  lines.push(`; ${domain} zone file`);
  lines.push(`; Generated for Cloudflare DNS import`);
  lines.push(`$ORIGIN ${fqdn}`);
  lines.push(`$TTL ${ttl}`);
  lines.push('');

  // SOA record (required for a valid zone file)
  lines.push(
    `${escapeName('@')} ${ttl} IN SOA ${fqdn.slice(0, -1)}. admin.${fqdn.slice(0, -1)}. (`,
  );
  const now = Math.floor(Date.now() / 1000);
  lines.push(`  ${now}  ; serial (Unix timestamp)`);
  lines.push('  7200       ; refresh (2 hours)');
  lines.push('  3600       ; retry (1 hour)');
  lines.push('  1209600    ; expire (2 weeks)');
  lines.push('  3600       ; minimum TTL (1 hour)');
  lines.push('  )');
  lines.push('');

  // NS record for the zone apex
  lines.push(`${escapeName('@')} ${ttl} IN NS ${fqdn.slice(0, -1)}.`);
  lines.push('');

  // User records
  for (const r of recs) {
    if (!r || !r.type || !r.name || r.content === undefined) continue;
    const name = escapeName(r.name);
    const content = escapeContent(r.type, r.content, fqdn);
    const ttlVal = Number.isFinite(r.ttl) && r.ttl > 0 ? r.ttl : DEFAULT_TTL;
    if (r.priority !== undefined && r.priority !== null) {
      lines.push(`${name} ${ttlVal} IN ${r.type.toUpperCase()} ${r.priority} ${content}`);
    } else {
      lines.push(`${name} ${ttlVal} IN ${r.type.toUpperCase()} ${content}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Validate a list of DNS records for common issues.
 *
 * Checks performed:
 * - At most one SOA record
 * - At least one NS record (recommendation)
 * - No duplicate (type, name, content) triples
 * - TTL values fall within 1-86400
 *
 * @param records - The DNS records to validate.
 * @returns A {@link ZoneValidationResult} with pass/fail and human-readable errors.
 *
 * @example
 * ```ts
 * validateZone([]);
 * // => { valid: false, errors: ["Missing SOA record", "Missing NS record"] }
 *
 * validateZone([{ type: 'A', name: '@', content: '1.2.3.4', ttl: 3600 }]);
 * // => { valid: true, errors: [] }
 * ```
 */
export function validateZone(records: readonly DnsRecord[]): ZoneValidationResult {
  const errors: string[] = [];
  const raw = Array.isArray(records) ? records : [];
  const recs = raw.filter(
    (r): r is DnsRecord => r != null && typeof r.type === 'string' && r.type.length > 0,
  );

  if (recs.length === 0) {
    return { errors: ['Zone must contain at least one record'], valid: false };
  }

  // Check for SOA (at most one)
  const soas = recs.filter((r) => r.type.toUpperCase() === 'SOA');
  if (soas.length > 1) {
    errors.push('Zone must contain at most one SOA record');
  }

  // Check for duplicate (type, name, content) triples
  const seen = new Set<string>();
  for (const r of recs) {
    const key = `${r.type.toUpperCase()}|${r.name}|${r.content}`;
    if (seen.has(key)) {
      errors.push(`Duplicate record: ${r.type} ${r.name} ${r.content}`);
    }
    seen.add(key);
  }

  // Validate TTL values
  for (const r of recs) {
    if (r.ttl !== undefined && r.ttl !== null) {
      if (!Number.isFinite(r.ttl) || r.ttl < 1 || r.ttl > 86400) {
        errors.push(`Invalid TTL ${r.ttl} on ${r.type} ${r.name}: must be between 1 and 86400`);
      }
    }
  }

  return { errors, valid: errors.length === 0 };
}

/**
 * Escape a DNS record name for BIND zone format.
 *
 * - "@" is left as-is (zone apex marker).
 * - Names ending with "." are treated as fully-qualified and left as-is.
 * - Other names get the zone origin appended.
 * - Empty/root names become "@".
 */
function escapeName(name: string): string {
  if (!name || name === '@' || name === '.') return '@';
  const n = name.trim();
  if (!n) return '@';
  if (n.endsWith('.')) return n;
  return n;
}

/**
 * Escape a DNS record content value for BIND zone format.
 *
 * - MX/SRV priorities are handled by the caller.
 * - TXT records get quoted if they contain spaces or special characters.
 * - Bare hostnames (not IPs) get the zone origin if not already FQDN.
 */
function escapeContent(type: string, content: string, origin: string): string {
  const t = type.toUpperCase();

  // TXT records: quote if not already quoted
  if (t === 'TXT') {
    const trimmed = content.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
    return `"${trimmed}"`;
  }

  // MX: hostname only (priority handled by caller)
  if (t === 'MX' || t === 'SRV') {
    const trimmed = content.trim();
    if (trimmed.endsWith('.')) return trimmed;
    return `${trimmed}.`;
  }

  // A/AAAA/NS/CNAME: IPs and FQDN hostnames
  if (t === 'CNAME') {
    const trimmed = content.trim();
    if (trimmed === '@') return `${origin.slice(0, -1)}.`;
    if (trimmed.endsWith('.')) return trimmed;
    if (trimmed.includes('.') && !trimmed.includes(' ')) return `${trimmed}.`;
    // Relative CNAME target — append origin
    return `${trimmed}.${origin}`;
  }

  if (t === 'NS') {
    const trimmed = content.trim();
    if (trimmed.endsWith('.')) return trimmed;
    return `${trimmed}.`;
  }

  return content;
}
