/**
 * @module services/url_sanitizer
 * @description AP23 (#329) — URL validation + SSRF guard. Pure zero-I/O module
 * that validates and sanitizes URLs before any outbound fetch so no
 * SSRF-adjacent calls escape.
 *
 * Complements the rate-limit/retry/idempotency half (follow-on module).
 *
 * @packageDocumentation
 */

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** Allowed URL schemes. */
export const ALLOWED_SCHEMES: readonly string[] = ['https:', 'http:'];

/** Additional blocked hostname patterns (beyond IP-range checks). */
export const BLOCKED_HOSTS: readonly string[] = [
  'metadata.google.internal',
  'metadata.google.internal.',
  '169.254.169.254',
  'metadata.internal',
  '100.100.100.200',
];

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface SanitizeResult {
  /** Sanitized URL (null when invalid). */
  readonly url: string | null;
  /** True when the URL passes all checks. */
  readonly valid: boolean;
  /** Error description when invalid, null when valid. */
  readonly reason: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Normalize a URL — lowercase scheme + host, strip fragment, tidy spacing.
 *
 * @param url - The URL to normalize
 * @returns Normalized URL string
 */
function normalizeUrl(url: URL): string {
  const scheme = url.protocol.toLowerCase();
  const host = url.hostname.toLowerCase();
  const port = url.port ? (isDefaultPort(scheme, url.port) ? '' : `:${url.port}`) : '';
  const path = url.pathname === '' ? '/' : url.pathname;
  const search = url.search;
  // Drop fragment
  return `${scheme}//${host}${port}${path}${search}`;
}

/**
 * True when the port is the default for the scheme.
 */
function isDefaultPort(scheme: string, port: string): boolean {
  if (scheme === 'https:' && port === '443') return true;
  if (scheme === 'http:' && port === '80') return true;
  return false;
}

/**
 * True when a hostname or IP is in a private / internal / link-local range.
 *
 * Blocks:
 * - localhost / 127.0.0.0/8
 * - 10.0.0.0/8 (RFC 1918)
 * - 172.16.0.0/12 (RFC 1918)
 * - 192.168.0.0/16 (RFC 1918)
 * - 169.254.0.0/16 (link-local)
 * - 0.0.0.0
 * - [::1] (IPv6 loopback)
 * - fc00::/7 (IPv6 unique local)
 * - fe80::/10 (IPv6 link-local)
 */
export function isPrivateHost(host: string): boolean {
  const trimmed = host.replace(/^\[|\]$/g, '').toLowerCase();

  // Named loopback
  if (trimmed === 'localhost' || trimmed === 'localhost.') return true;

  // IPv6 checks
  if (trimmed === '::1') return true;
  if (trimmed.startsWith('fc') || trimmed.startsWith('fd')) return true; // fc00::/7

  // fe80::/10 — need numeric check since range spans fe80–febf
  const firstColon = trimmed.indexOf(':');
  if (firstColon > 0) {
    const firstHex = parseInt(trimmed.substring(0, firstColon), 16);
    if (!isNaN(firstHex) && firstHex >= 0xfe80 && firstHex <= 0xfebf) return true; // fe80::/10 (link-local)
  }

  // IPv4 checks
  const ipv4Match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [a, b, c] = [
      parseInt(ipv4Match[1], 10),
      parseInt(ipv4Match[2], 10),
      parseInt(ipv4Match[3], 10),
      parseInt(ipv4Match[4], 10),
    ];
    // 127.0.0.0/8
    if (a === 127) return true;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16
    if (a === 169 && b === 254) return true;
    // 0.0.0.0
    if (a === 0 && b === 0 && c === 0) return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Validate and sanitize a URL.
 *
 * Returns a normalized URL on success (lowercase scheme+host, strip
 * fragment, default port stripped). Returns an error reason on failure.
 *
 * @param input - Raw URL string to validate
 * @returns SanitizeResult with sanitized URL or error reason
 *
 * @example
 * const r = sanitizeUrl('https://api.example.com/path?q=1#section');
 * r.valid   // true
 * r.url     // 'https://api.example.com/path?q=1'
 *
 * @example
 * const r = sanitizeUrl('javascript:alert(1)');
 * r.valid   // false
 * r.reason  // 'scheme not allowed: javascript:'
 */
export function sanitizeUrl(input: string): SanitizeResult {
  // Empty input
  if (!input || input.trim().length === 0) {
    return { reason: 'empty host', url: null, valid: false };
  }

  // Strip fragment ourselves after parse (URL class auto-strips it but we
  // want the full URL before parsing for error clarity)
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    // Try prepending https: for protocol-relative URLs (//host/path)
    // but only when the input is NOT already a scheme-prefixed stub
    if (input.includes('://')) {
      return { reason: 'invalid url', url: null, valid: false };
    }
    try {
      parsed = new URL(`https:${input}`);
    } catch {
      return { reason: 'invalid url', url: null, valid: false };
    }
  }

  // Check scheme
  if (!ALLOWED_SCHEMES.includes(parsed.protocol.toLowerCase())) {
    return {
      reason: `scheme not allowed: ${parsed.protocol.toLowerCase()}`,
      url: null,
      valid: false,
    };
  }

  // Check host is non-empty
  const host = parsed.hostname;
  if (!host) {
    return { reason: 'empty host', url: null, valid: false };
  }

  // Check private / internal host
  if (isPrivateHost(host)) {
    return {
      reason: `host not allowed: ${host}`,
      url: null,
      valid: false,
    };
  }

  // Check BLOCKED_HOSTS patterns
  const hostLower = host.toLowerCase();
  for (const blocked of BLOCKED_HOSTS) {
    if (hostLower === blocked.toLowerCase()) {
      return {
        reason: `host not allowed: ${host}`,
        url: null,
        valid: false,
      };
    }
  }

  // Success — return normalized URL
  return {
    reason: null,
    url: normalizeUrl(parsed),
    valid: true,
  };
}

/**
 * True when a URL is safe to fetch.
 *
 * A convenience wrapper around sanitizeUrl.
 *
 * @param input - Raw URL string to check
 * @returns True when the URL passes all safety checks
 *
 * @example
 * isSafeUrl('https://example.com')       // true
 * isSafeUrl('http://192.168.1.1/admin')  // false
 */
export function isSafeUrl(input: string): boolean {
  return sanitizeUrl(input).valid;
}
