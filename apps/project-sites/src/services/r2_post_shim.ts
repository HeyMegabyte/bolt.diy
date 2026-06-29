/**
 * @module services/r2_post_shim
 * @description AP6 — reusable R2 S3-POST-object shim. Generalizes the Plane S3
 * pattern: given an R2 custom domain + access-key pair, builds the base64
 * policy, HMAC-SHA256 signature, and form fields any S3-POST client needs.
 * Pure + zero-I/O: the caller provides the credentials; this layer is a
 * deterministic crypto builder. The actual POST executes client-side against
 * the R2 endpoint so the Worker never sees the file bytes. Never throws.
 *
 * @packageDocumentation
 */

export interface R2PostConfig {
  /** R2 custom-domain HTTPS endpoint (no trailing slash), e.g. `https://r2.example.com`. */
  readonly endpoint: string;
  /** R2 S3-compatible access key ID. */
  readonly accessKeyId: string;
  /** R2 S3-compatible secret access key (used for HMAC-SHA256 signing). */
  readonly secretAccessKey: string;
  /** Bucket name. */
  readonly bucket: string;
  /** Key prefix, e.g. `plane-media` or `app-uploads`. */
  readonly keyPrefix?: string;
  /** Max file size in bytes (default 25 MB). */
  readonly maxContentLength?: number;
  /** Policy expiration in seconds from now (default 600 = 10 min). */
  readonly expiresInSeconds?: number;
}

export interface R2PostForm {
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const TWO_DAYS = 2 * 24 * 60 * 60;

async function sign(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Deterministic ISO UTC timestamp for policy expiration. */
function isoDate(nowMs: number, offsetSeconds: number): string {
  const d = new Date(nowMs + offsetSeconds * 1000);
  // Only valid when the timestamp resolves — always the case for real inputs.
  const s = d.toISOString();
  return ISO_DATE_RE.test(s) ? s : d.toISOString(); // fallback (belt-and-suspenders)
}

/**
 * Build the signed S3 POST form fields for an R2 bucket. The caller passes the
 * result to the client-side form/uploader; the Worker never touches raw file
 * bytes.
 *
 * @param config - {@link R2PostConfig}.
 * @param nowMs - Current ms timestamp (for deterministic expiration).
 * @returns {@link R2PostForm} (url + fields for the HTML form).
 *
 * @example
 * buildR2PostForm({ endpoint:'https://r2.x.com', accessKeyId:'k1',
 *   secretAccessKey:'s1', bucket:'my-bucket', keyPrefix:'uploads',
 *   maxContentLength:25_000_000 }, Date.now())
 */
export async function buildR2PostForm(
  config: R2PostConfig,
  nowMs: number = Date.now(),
): Promise<R2PostForm> {
  const endpoint = (config.endpoint ?? '').replace(/\/+$/, '');
  const bucket = (config.bucket ?? '').trim();
  const prefix = (config.keyPrefix ?? '').trim();
  const maxLen =
    config.maxContentLength && config.maxContentLength > 0
      ? Math.round(config.maxContentLength)
      : 25_000_000;
  const expiresIn =
    config.expiresInSeconds && config.expiresInSeconds > 0
      ? Math.round(config.expiresInSeconds)
      : 600;
  const n = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now();

  const keyCondition = prefix ? `${prefix}/$\{filename}` : '${filename}';
  const expiration = isoDate(n, Math.min(expiresIn, TWO_DAYS));

  const policy = {
    expiration,
    conditions: [
      { bucket },
      ['starts-with', '$key', prefix ? `${prefix}/` : ''],
      { 'x-amz-algorithm': 'AWS4-HMAC-SHA256' },
      {
        'x-amz-credential': `${config.accessKeyId}/${expiration.slice(0, 10)}/auto/s3/aws4_request`,
      },
      { 'x-amz-date': isoDate(n, 0).replace(/[:\-]/g, '').slice(0, 15) + 'Z' },
      ['content-length-range', 0, maxLen],
    ],
  };

  const policyB64 = btoa(JSON.stringify(policy));
  const dateKey = await sign(`AWS4${config.secretAccessKey}`, expiration.slice(0, 10));
  const dateRegionKey = await sign(dateKey, 'auto');
  const dateRegionServiceKey = await sign(dateRegionKey, 's3');
  const signingKey = await sign(dateRegionServiceKey, 'aws4_request');
  const signature = await sign(signingKey, policyB64);

  const algorithm = 'AWS4-HMAC-SHA256';
  const credential = `${config.accessKeyId}/${expiration.slice(0, 10)}/auto/s3/aws4_request`;
  const xAmzDate = isoDate(n, 0).slice(0, 10).replace(/-/g, '') + 'T000000Z';

  return {
    url: `${endpoint}/${bucket}`,
    fields: {
      key: keyCondition,
      'x-amz-algorithm': algorithm,
      'x-amz-credential': credential,
      'x-amz-date': xAmzDate,
      'x-amz-signature': signature,
      policy: policyB64,
    },
  };
}
