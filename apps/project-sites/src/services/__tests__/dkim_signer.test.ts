import {
  DEFAULT_SIGNED_HEADERS,
  type DkimKeyPair,
  type DkimSignature,
  type EmailHeader,
  dkimHeader,
  generateDkimKey,
  isCryptoKeyPair,
  signEmail,
} from '../dkim_signer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a base64 string back to ArrayBuffer (for verify). */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Build canonicalized signing data in the same manner as the signer,
 * so the test can verify the signature independently.
 */
function rebuildSigningData(
  headers: EmailHeader[],
  signedHeaderNames: string[],
  dkimValue: string,
): Uint8Array {
  const lookup = new Map(headers.map((h) => [h.name.toLowerCase(), h]));
  const entries: string[] = [];

  for (const name of signedHeaderNames) {
    const h = lookup.get(name);
    if (h) {
      entries.push(canonicalizeHeader(h.name, h.value));
    }
  }
  entries.push(canonicalizeHeader('dkim-signature', dkimValue));
  return new TextEncoder().encode(entries.join(''));
}

function canonicalizeHeader(name: string, value: string): string {
  const lc = name.toLowerCase().trim();
  const unfolded = value.replace(/\r?\n\s+/g, ' ');
  const compacted = unfolded.replace(/\s+/g, ' ').trim();
  return `${lc}:${compacted}\r\n`;
}

let keyPair: DkimKeyPair;

const HEADERS: EmailHeader[] = [
  { name: 'From', value: 'alice@example.com' },
  { name: 'To', value: 'bob@example.com' },
  { name: 'Subject', value: 'Hello, Bob!' },
  { name: 'Date', value: 'Mon, 1 Jan 2024 12:00:00 +0000' },
  { name: 'Message-ID', value: '<abc123@example.com>' },
  { name: 'MIME-Version', value: '1.0' },
  { name: 'Content-Type', value: 'text/plain; charset=UTF-8' },
];

const DOMAIN = 'example.com';
const SELECTOR = 's1';
const BODY = 'Hello, world!\r\n';

// ---------------------------------------------------------------------------
// generateDkimKey
// ---------------------------------------------------------------------------

describe('generateDkimKey', () => {
  beforeAll(async () => {
    keyPair = await generateDkimKey();
  });

  it('returns a privateKey CryptoKey with sign usage', () => {
    expect(keyPair.privateKey).toBeInstanceOf(CryptoKey);
    expect(keyPair.privateKey.type).toBe('private');
    expect(keyPair.privateKey.usages).toContain('sign');
  });

  it('returns a publicKeyDer ArrayBuffer with DER content', () => {
    expect(keyPair.publicKeyDer).toBeInstanceOf(ArrayBuffer);
    // A 2048-bit SPKI DER starts with a known prefix ~ 294 bytes
    expect(keyPair.publicKeyDer.byteLength).toBeGreaterThan(250);
    expect(keyPair.publicKeyDer.byteLength).toBeLessThan(350);
  });

  it('returns a publicKeyB64 string that round-trips', () => {
    expect(typeof keyPair.publicKeyB64).toBe('string');
    expect(keyPair.publicKeyB64.length).toBeGreaterThan(300);

    const decoded = base64ToArrayBuffer(keyPair.publicKeyB64);
    expect(decoded.byteLength).toBe(keyPair.publicKeyDer.byteLength);
  });

  it('generates distinct keys on successive calls', async () => {
    const second = await generateDkimKey();
    expect(second.publicKeyB64).not.toBe(keyPair.publicKeyB64);
  });

  it('isCryptoKeyPair narrows a pair and rejects a bare CryptoKey', () => {
    expect(isCryptoKeyPair({ publicKey: {}, privateKey: {} } as unknown as CryptoKeyPair)).toBe(
      true,
    );
    expect(isCryptoKeyPair({ type: 'private' } as unknown as CryptoKey)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// signEmail
// ---------------------------------------------------------------------------

describe('signEmail', () => {
  let sig: DkimSignature;

  beforeAll(async () => {
    sig = await signEmail(HEADERS, BODY, keyPair.privateKey, DOMAIN, SELECTOR);
  });

  it('returns all required DkimSignature fields', () => {
    expect(sig.domain).toBe(DOMAIN);
    expect(sig.selector).toBe(SELECTOR);
    expect(sig.signedHeaders).toEqual(DEFAULT_SIGNED_HEADERS);
    expect(sig.canonicalization).toBe('relaxed/relaxed');
    expect(sig.algorithm).toBe('rsa-sha256');
    expect(sig.timestamp).toBeGreaterThan(0);
    expect(sig.bodyLength).toBe(BODY.length);
  });

  it('produces a non-empty signature and bodyHash', () => {
    expect(sig.signature).toBeTruthy();
    expect(sig.signature.length).toBeGreaterThan(300);
    expect(sig.bodyHash).toBeTruthy();
    expect(sig.bodyHash.length).toBeGreaterThan(30);
  });

  it('bodyHash changes when the body changes', async () => {
    const other = await signEmail(
      HEADERS,
      'Different body\r\n',
      keyPair.privateKey,
      DOMAIN,
      SELECTOR,
    );
    expect(other.bodyHash).not.toBe(sig.bodyHash);
  });

  it('signature changes when headers change', async () => {
    const otherHeaders: EmailHeader[] = HEADERS.map((h) =>
      h.name === 'Subject' ? { ...h, value: 'Different Subject' } : h,
    );
    const other = await signEmail(otherHeaders, BODY, keyPair.privateKey, DOMAIN, SELECTOR);
    expect(other.signature).not.toBe(sig.signature);
  });

  it('signature is verifiable with the public key', async () => {
    // Re-construct the DKIM field value that was fed into the signer
    const dkimValue = buildDkimFieldValue({
      domain: sig.domain,
      selector: sig.selector,
      timestamp: sig.timestamp,
      algorithm: sig.algorithm,
      canonicalization: sig.canonicalization,
      signedHeaders: sig.signedHeaders,
      bodyHash: sig.bodyHash,
      bodyLength: sig.bodyLength,
      signature: '',
    });
    const signingData = rebuildSigningData(HEADERS, sig.signedHeaders, dkimValue);
    const sigBytes = base64ToArrayBuffer(sig.signature);

    const valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      keyPair.publicKey,
      sigBytes,
      signingData,
    );
    expect(valid).toBe(true);
  });

  it('verification fails with tampered data', async () => {
    const tampered = new TextEncoder().encode('TAMPERED DATA');
    const sigBytes = base64ToArrayBuffer(sig.signature);

    const valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      keyPair.publicKey,
      sigBytes,
      tampered,
    );
    expect(valid).toBe(false);
  });

  it('signs with empty body', async () => {
    const empty = await signEmail(HEADERS, '', keyPair.privateKey, DOMAIN, SELECTOR);
    expect(empty.bodyHash).toBeTruthy();
    expect(empty.signature).toBeTruthy();
  });

  it('only includes headers present in DEFAULT_SIGNED_HEADERS', async () => {
    const extra: EmailHeader[] = [...HEADERS, { name: 'X-Custom', value: 'should-not-be-signed' }];
    const result = await signEmail(extra, BODY, keyPair.privateKey, DOMAIN, SELECTOR);
    expect(result.signedHeaders).not.toContain('x-custom');
    expect(result.signedHeaders).toEqual(DEFAULT_SIGNED_HEADERS);
  });
});

// ---------------------------------------------------------------------------
// dkimHeader
// ---------------------------------------------------------------------------

describe('dkimHeader', () => {
  let sig: DkimSignature;

  beforeAll(async () => {
    sig = await signEmail(HEADERS, BODY, keyPair.privateKey, DOMAIN, SELECTOR);
  });

  it('starts with v=1', () => {
    const hdr = dkimHeader(sig);
    expect(hdr).toMatch(/^v=1;/);
  });

  it('contains all required DKIM tags', () => {
    const hdr = dkimHeader(sig);
    expect(hdr).toContain('a=rsa-sha256');
    expect(hdr).toContain('c=relaxed/relaxed');
    expect(hdr).toContain(`d=${DOMAIN}`);
    expect(hdr).toContain(`s=${SELECTOR}`);
    expect(hdr).toContain('t=');
    expect(hdr).toContain('h=');
    expect(hdr).toContain('bh=');
    expect(hdr).toContain('b=');
    expect(hdr).toContain('l=');
  });

  it('includes the body hash tag and signature tag in the header', () => {
    const hdr = dkimHeader(sig);
    expect(hdr).toContain('bh=');
    expect(hdr).toContain(sig.bodyHash);
    expect(hdr).toContain('b=');
    // The signature base64 may be folded across continuation lines, so
    // verify a leading portion appears contiguously after b= rather than
    // requiring the full 344-char value as one substring.
    expect(hdr).toContain(sig.signature.substring(0, 40));
  });

  it('folds long lines with CRLF when value exceeds 78 characters', () => {
    const hdr = dkimHeader(sig);
    // A DKIM-Signature header is always well over 78 chars, so it MUST fold
    expect(hdr).toContain('\r\n');
    // Every continuation line starts with a tab
    for (const line of hdr.split('\r\n').slice(1)) {
      expect(line.startsWith('\t')).toBe(true);
    }
  });

  it('each folded line is at most 78 chars excluding the leading tab', () => {
    const hdr = dkimHeader(sig);
    for (const line of hdr.split('\r\n')) {
      // The first line has no leading tab; continuation lines do
      const effective = line.startsWith('\t') ? line.length - 1 : line.length;
      expect(effective).toBeLessThanOrEqual(78);
    }
  });
});

// ---------------------------------------------------------------------------
// Helper used only in this test (mirrors internal buildDkimFieldValue)
// ---------------------------------------------------------------------------

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
    domain,
    selector,
    timestamp,
    algorithm,
    canonicalization,
    signedHeaders,
    bodyHash,
    bodyLength,
    signature,
  } = params;

  const parts: string[] = [
    'v=1',
    `a=${algorithm}`,
    `c=${canonicalization}`,
    `d=${domain}`,
    `s=${selector}`,
    `t=${timestamp}`,
  ];

  if (bodyLength !== undefined) {
    parts.push(`l=${bodyLength}`);
  }

  parts.push(`h=${signedHeaders.join(':')}`, `bh=${bodyHash}`, `b=${signature}`);

  return parts.join('; ');
}
