/**
 * @module services/dkim_signer
 * @description DKIM (DomainKeys Identified Mail) signing utilities. Pure
 * functions for generating RSA key pairs, signing email bodies, and producing
 * DKIM-Signature header values per RFC 6376. Uses Web Crypto API for all
 * cryptographic operations — Workers-compatible with no external deps.
 *
 * Canonicalization: relaxed/relaxed (the default; RFC 6376 §3.4.2/§3.4.4).
 * Key type: RSASSA-PKCS1-v1_5 with SHA-256, 2048-bit modulus.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** RSA-2048 key pair for DKIM RSASSA-PKCS1-v1_5 signing with SHA-256. */
export interface DkimKeyPair {
  /** Private key usable for RSASSA-PKCS1-v1_5 sign operations. */
  privateKey: CryptoKey;
  /** Public key usable for RSASSA-PKCS1-v1_5 verify operations. */
  publicKey: CryptoKey;
  /** SPKI DER-encoded public key (ArrayBuffer for raw access / storage). */
  publicKeyDer: ArrayBuffer;
  /** SPKI DER public key encoded as standard Base64 (for DNS TXT records). */
  publicKeyB64: string;
}

/** A computed DKIM signature over a set of email headers and body. */
export interface DkimSignature {
  /** Signing domain identifier (d= tag). */
  domain: string;
  /** Selector subdomain under _domainkey (s= tag). */
  selector: string;
  /** Ordered list of header field names included in the signature (h= tag). */
  signedHeaders: string[];
  /** Canonicalization algorithm, default "relaxed/relaxed" (c= tag). */
  canonicalization: string;
  /** Signing algorithm, default "rsa-sha256" (a= tag). */
  algorithm: string;
  /** Base64-encoded RSASSA-PKCS1-v1_5 signature value (b= tag). */
  signature: string;
  /** Base64-encoded SHA-256 hash of the canonicalized body (bh= tag). */
  bodyHash: string;
  /** Signature timestamp as Unix seconds (t= tag). */
  timestamp: number;
  /** Optional body length estimate in bytes (l= tag). */
  bodyLength?: number;
}

/** A single email header name-value pair. Order is significant for signing. */
export interface EmailHeader {
  /** Header field name (case-insensitive). */
  name: string;
  /** Header field value (raw, before canonicalization). */
  value: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default set of header fields to include in the DKIM signature. */
export const DEFAULT_SIGNED_HEADERS = [
  'from',
  'to',
  'subject',
  'date',
  'message-id',
  'mime-version',
  'content-type',
];

/** RSA modulus length in bits for key generation. */
export const DKIM_KEY_BITS = 2048;
/** Default canonicalization algorithm. */
export const DKIM_CANONICALIZATION = 'relaxed/relaxed';
/** Default signing algorithm. */
export const DKIM_ALGORITHM = 'rsa-sha256';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an RSA key pair suitable for DKIM signing. Produces a 2048-bit
 * RSASSA-PKCS1-v1_5 key with SHA-256 — the standard DKIM key type.
 *
 * @remarks Uses Web Crypto {@link crypto.subtle.generateKey} with the
 *   `extractable` flag so the public key can be exported for DNS.
 *   Returns the private {@link CryptoKey}, the public key as a DER
 *   {@link ArrayBuffer}, and a base64-encoded DER string for DNS TXT records.
 *
 * @returns A {@link DkimKeyPair} with the generated private/public pair.
 *
 * @example
 * ```ts
 * const pair = await generateDkimKey();
 * // pair.publicKeyB64 → "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..."
 * ```
 *
 * @throws {Error} When the environment does not support `crypto.subtle` (e.g.
 *   insecure context).
 */
export async function generateDkimKey(): Promise<DkimKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      hash: 'SHA-256',
      modulusLength: DKIM_KEY_BITS,
      name: 'RSASSA-PKCS1-v1_5',
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  );

  const spkiDer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyB64: arrayBufferToBase64(spkiDer),
    publicKeyDer: spkiDer,
  };
}

/**
 * Sign an email body and headers using DKIM. Computes a DKIM-Signature value
 * using relaxed/relaxed canonicalization and RSASSA-PKCS1-v1_5 with SHA-256.
 *
 * @remarks
 * Only headers present in both the `headers` argument and the default set
 * (from, to, subject, date, message-id, mime-version, content-type) are
 * included in the signed list. Headers available but absent from the default
 * set are NOT signed — extend the default set if custom headers are required.
 *
 * The returned {@link DkimSignature} carries every tag needed for the final
 * DKIM-Signature header. Pass it to {@link dkimHeader} to produce the
 * wire-format header value.
 *
 * @param headers - Ordered list of email headers. Only the subset matching
 *   {@link DEFAULT_SIGNED_HEADERS} is included in the signature.
 * @param body - Raw email body text (may contain CRLF line endings).
 * @param key - RSA private key from {@link generateDkimKey}.
 * @param domain - Signing domain (e.g. "example.com") → d= tag.
 * @param selector - The selector in `{selector}._domainkey.{domain}` DNS → s= tag.
 * @returns The computed {@link DkimSignature}.
 *
 * @example
 * ```ts
 * const pair = await generateDkimKey();
 * const sig = await signEmail(
 *   [{ name: 'From', value: 'alice@example.com' }, ...],
 *   'Hello, world!\r\n',
 *   pair.privateKey,
 *   'example.com',
 *   's1',
 * );
 * ```
 */
export async function signEmail(
  headers: EmailHeader[],
  body: string,
  key: CryptoKey,
  domain: string,
  selector: string,
): Promise<DkimSignature> {
  const timestamp = Math.floor(Date.now() / 1000);
  const headerMap = new Map(headers.map((h) => [h.name.toLowerCase(), h.value]));

  // Which of the DEFAULT headers are actually present?
  const signedHeaders = DEFAULT_SIGNED_HEADERS.filter((n) => headerMap.has(n));

  // 1. Canonicalize body → bh= hash
  const canonBody = canonicalizeBodyRelaxed(body);
  const bodyHash = await sha256Base64(canonBody);
  const bodyLength = body.length;

  // 2. Build partial DKIM-Signature header with empty b= for signing
  const dkimValue = buildDkimFieldValue({
    algorithm: DKIM_ALGORITHM,
    bodyHash,
    bodyLength,
    canonicalization: DKIM_CANONICALIZATION,
    domain,
    selector,
    signature: '',
    signedHeaders,
    timestamp,
  });

  // 3. Build the canonicalised data that gets signed
  const signingData = buildSigningData(headers, signedHeaders, dkimValue);

  // 4. Sign
  const signature = await signRsaSha256(signingData, key);

  return {
    algorithm: DKIM_ALGORITHM,
    bodyHash,
    bodyLength,
    canonicalization: DKIM_CANONICALIZATION,
    domain,
    selector,
    signature,
    signedHeaders,
    timestamp,
  };
}

/**
 * Produce the wire-format DKIM-Signature header value from a signature object.
 * The result is a single header field value (without the "DKIM-Signature:" label)
 * suitable for insertion into the email. Long lines are folded with CRLF + tab
 * per RFC 5322 §2.2.3.
 *
 * @param sig - A completed {@link DkimSignature} from {@link signEmail}.
 * @returns The DKIM-Signature header field value (without field name).
 *
 * @example
 * ```ts
 * const sig = await signEmail(headers, body, key, 'example.com', 's1');
 * const hdr = dkimHeader(sig);
 * // → "v=1; a=rsa-sha256; c=relaxed/relaxed; d=example.com; s=s1; ..."
 * ```
 */
export function dkimHeader(sig: DkimSignature): string {
  const raw = buildDkimFieldValue({
    algorithm: sig.algorithm,
    bodyHash: sig.bodyHash,
    bodyLength: sig.bodyLength,
    canonicalization: sig.canonicalization,
    domain: sig.domain,
    selector: sig.selector,
    signature: sig.signature,
    signedHeaders: sig.signedHeaders,
    timestamp: sig.timestamp,
  });
  return foldHeaderValue(raw);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert an ArrayBuffer to a standard Base64 string.
 * Workers-compatible (no Buffer dependency).
 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Compute SHA-256 digest of a Uint8Array and return base64-encoded result.
 */
async function sha256Base64(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return arrayBufferToBase64(hash);
}

/**
 * RSASSA-PKCS1-v1_5 sign a Uint8Array using the provided private key.
 * Returns the base64-encoded signature bytes.
 */
async function signRsaSha256(data: Uint8Array, key: CryptoKey): Promise<string> {
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, data as BufferSource);
  return arrayBufferToBase64(sig);
}

/**
 * Relaxed body canonicalization per RFC 6376 §3.4.4.
 *
 * 1. Strip trailing whitespace from each line.
 * 2. Remove all trailing empty lines (i.e. blank or whitespace-only).
 * 3. Ensure the canonicalized body ends with exactly one CRLF.
 *
 * An empty input body canonicalises to a single CRLF.
 */
function canonicalizeBodyRelaxed(body: string): Uint8Array {
  const lines = body.split(/\r?\n/);

  // Strip trailing whitespace per line
  const stripped = lines.map((l) => l.replace(/\s+$/, ''));

  // Buck trailing empty lines
  let end = stripped.length - 1;
  while (end >= 0 && stripped[end] === '') {
    end--;
  }

  const kept = stripped.slice(0, end + 1);
  // Always end with exactly one CRLF (even empty body → a single CRLF)
  const normalized = kept.join('\r\n') + '\r\n';
  return new TextEncoder().encode(normalized);
}

/**
 * Relaxed header canonicalization per RFC 6376 §3.4.2.
 *
 * 1. Lowercase header field name.
 * 2. Unfold: replace CRLF+WSP with a single space.
 * 3. Strip leading/trailing WSP.
 * 4. Compact multiple WSP to a single space.
 */
function canonicalizeHeaderRelaxed(name: string, value: string): string {
  const lc = name.toLowerCase().trim();
  const unfolded = value.replace(/\r?\n\s+/g, ' ');
  const compacted = unfolded.replace(/\s+/g, ' ').trim();
  return `${lc}:${compacted}\r\n`;
}

/**
 * Build the DKIM-Signature header field VALUE (without the field name).
 * When `signature` is empty, the field is the pre-image for signing
 * (RFC 6376 §3.7 — b= tag is empty during signature computation).
 */
function buildDkimFieldValue(params: {
  domain: string;
  selector: string;
  timestamp: number;
  algorithm: string;
  canonicalization: string;
  signedHeaders: string[];
  bodyHash: string;
  bodyLength?: number;
  signature: string;
}): string {
  const {
    algorithm,
    bodyHash,
    bodyLength,
    canonicalization,
    domain,
    selector,
    signature,
    signedHeaders,
    timestamp,
  } = params;

  const hValue = signedHeaders.join(':');
  const parts: string[] = [
    `v=1`,
    `a=${algorithm}`,
    `c=${canonicalization}`,
    `d=${domain}`,
    `s=${selector}`,
    `t=${timestamp}`,
  ];

  if (bodyLength !== undefined) {
    parts.push(`l=${bodyLength}`);
  }

  parts.push(`h=${hValue}`, `bh=${bodyHash}`, `b=${signature}`);

  return parts.join('; ');
}

/**
 * Build the canonicalized data that gets signed (RFC 6376 §3.7).
 *
 * The data is the concatenation of every header in `signedHeaderNames`
 * (in order, canonicalized), followed by the DKIM-Signature header itself
 * (also canonicalized, with an empty b= tag).
 */
function buildSigningData(
  headers: EmailHeader[],
  signedHeaderNames: string[],
  dkimValue: string,
): Uint8Array {
  const lookup = new Map(
    headers.map((h) => [h.name.toLowerCase(), { name: h.name, value: h.value }]),
  );
  const entries: string[] = [];

  for (const name of signedHeaderNames) {
    const h = lookup.get(name);
    if (h) {
      entries.push(canonicalizeHeaderRelaxed(h.name, h.value));
    }
  }

  // Append the DKIM-Signature header itself (with empty b=)
  entries.push(canonicalizeHeaderRelaxed('dkim-signature', dkimValue));

  return new TextEncoder().encode(entries.join(''));
}

/**
 * Fold a header value to keep lines under 78 characters per
 * RFC 5322 §2.2.3. Continuation lines are indented with a single tab.
 * Breaks at semicolon boundaries where possible.
 *
 * @remarks If the value contains a contiguous run of non-whitespace longer
 *   than `maxLen` (e.g. a base64 signature), the fold occurs at the maxLen
 *   boundary regardless — no break update is found.
 */
function foldHeaderValue(value: string): string {
  const maxLen = 78;
  const lines: string[] = [];
  let remaining = value.trim();
  const maxIterations = 1_000_000 / maxLen; // fail-safe against runaway

  for (let i = 0; i < maxIterations; i++) {
    if (remaining.length <= maxLen) {
      lines.push(remaining);
      break;
    }

    // Prefer break at a semicolon+space pair within the limit
    const slice = remaining.substring(0, maxLen);
    let breakAt = slice.lastIndexOf('; ');

    // Skip trivial breaks (length 0 or just a continuation tab)
    if (breakAt <= 1) {
      breakAt = slice.lastIndexOf(' ');
    }
    if (breakAt <= 1) {
      // No useful whitespace in the window — hard-split at maxLen.
      lines.push(remaining.substring(0, maxLen));
      remaining = '\t' + remaining.substring(maxLen).trimStart();
      continue;
    }

    lines.push(remaining.substring(0, breakAt));
    remaining = '\t' + remaining.substring(breakAt).trimStart();
  }

  return lines.join('\r\n');
}
