/**
 * @module platform/aws-sigv4
 *
 * @description
 * AWS Signature Version 4 signer using Web Crypto only — zero npm deps, Workers-
 * native (convergence: Amazon SES via SigV4 raw-send, no AWS SDK). Pure given a
 * fixed `amzDate`/`dateStamp`, so it is verifiable against AWS's published
 * "get-vanilla" known-answer test vector (see aws_sigv4.test.ts).
 *
 * @see https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
 */

const enc = new TextEncoder();

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return hex(new Uint8Array(digest));
}

async function hmac(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg) as BufferSource);
  return new Uint8Array(sig);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Inputs to sign one request. `amzDate`/`dateStamp` are explicit for determinism. */
export interface SigV4Input {
  readonly method: string;
  readonly url: string;
  readonly region: string;
  readonly service: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly body?: string;
  /** Headers to sign + send (host is derived from the URL if omitted). */
  readonly headers?: Record<string, string>;
  /** `YYYYMMDDTHHMMSSZ` UTC. */
  readonly amzDate: string;
  /** `YYYYMMDD` UTC. */
  readonly dateStamp: string;
}

/**
 * Sign a request; returns the full header set (incl. `Authorization`) to send.
 *
 * @example
 * const headers = await signRequestV4({ method:'GET', url:'https://example.amazonaws.com/',
 *   region:'us-east-1', service:'service', accessKeyId:'AKIDEXAMPLE',
 *   secretAccessKey:'…', amzDate:'20150830T123600Z', dateStamp:'20150830' });
 */
export async function signRequestV4(input: SigV4Input): Promise<Record<string, string>> {
  const url = new URL(input.url);
  const payloadHash = await sha256Hex(input.body ?? '');

  // Assemble headers to sign: caller's + host + x-amz-date + x-amz-content-sha256
  // (+ x-amz-security-token when a session token is present).
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-date': input.amzDate,
    ...(input.headers ?? {}),
  };
  // get-vanilla vector signs ONLY host;x-amz-date — add content-sha256 only when
  // the caller sends a body (real SES posts), so the canonical set stays minimal
  // for the known-answer test.
  if (input.body !== undefined) headers['x-amz-content-sha256'] = payloadHash;
  if (input.sessionToken) headers['x-amz-security-token'] = input.sessionToken;

  const lcHeaders = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const canonicalHeaders = lcHeaders.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = lcHeaders.map(([k]) => k).join(';');

  const canonicalUri = url.pathname || '/';
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${input.dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate = await hmac(enc.encode(`AWS4${input.secretAccessKey}`), input.dateStamp);
  const kRegion = await hmac(kDate, input.region);
  const kService = await hmac(kRegion, input.service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(kSigning, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { ...headers, Authorization: authorization };
}
