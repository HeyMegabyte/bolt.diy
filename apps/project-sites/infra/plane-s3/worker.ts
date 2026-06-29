/**
 * r2s3.projectsites.dev — S3 POST-Object compatibility shim for Plane's media bucket.
 *
 * @remarks
 * Plane uploads avatars/attachments with an S3 **presigned POST** (browser → bucket-root POST,
 * multipart form). Cloudflare R2 does NOT implement the S3 `PostObject` operation (returns 501),
 * so Plane's uploads break on R2. This Worker is set as Plane's `AWS_S3_ENDPOINT_URL` and presents
 * a minimal S3 facade over the `plane-media` R2 binding — implementing POST Object (which R2 lacks)
 * plus GET/HEAD/PUT/DELETE/CopyObject/batch-delete so the FULL Plane storage flow works on R2.
 *
 * Security: every WRITE/DELETE is authenticated by re-deriving the SigV4 signature with the same R2
 * secret Plane signs with (POST → POST-policy signature; PUT/DELETE/Copy → Authorization-header
 * SigV4). Reads (GET/HEAD) are capability-by-key (unguessable UUID keys), matching presigned-GET
 * shareability. Path-style addressing only (`/plane-media/<key>`), which boto uses for custom endpoints.
 */
interface Env {
  PLANE_MEDIA: R2Bucket;
  /** plane-media R2 S3 secret access key — used ONLY to validate Plane's SigV4 signatures. */
  R2_SECRET_ACCESS_KEY: string;
}

const BUCKET = 'plane-media';
const ALLOWED_ORIGINS = new Set([
  'https://pm.projectsites.dev',
  'https://pm.megabyte.space',
]);

// ───────────────────────── crypto (Web Crypto SigV4 primitives) ─────────────────────────
const enc = new TextEncoder();
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}
async function signingKey(secret: string, dateStamp: string, region: string): Promise<ArrayBuffer> {
  const kDate = await hmac(enc.encode('AWS4' + secret), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}
/** constant-time-ish hex string compare. */
function eqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/** Parse `AKID/20260629/auto/s3/aws4_request`. */
function parseCredential(cred: string): { dateStamp: string; region: string } {
  const p = cred.split('/');
  return { dateStamp: p[1] ?? '', region: p[2] ?? 'auto' };
}

/** Validate a browser S3 presigned-POST: signature = hex(HMAC(signingKey, base64Policy)). */
async function validatePostPolicy(fields: Map<string, string>, secret: string): Promise<boolean> {
  const policy = fields.get('policy') ?? fields.get('Policy');
  const provided = (fields.get('x-amz-signature') ?? fields.get('X-Amz-Signature') ?? '').toLowerCase();
  const cred = fields.get('x-amz-credential') ?? fields.get('X-Amz-Credential');
  if (!policy || !provided || !cred) return false;
  const { dateStamp, region } = parseCredential(cred);
  const expected = toHex(await hmac(await signingKey(secret, dateStamp, region), policy));
  return eqHex(expected, provided);
}

/** Validate an AWS SigV4 Authorization header (server-side PUT/DELETE/Copy/batch). */
async function validateSigV4Header(req: Request, secret: string): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? '';
  const m = /AWS4-HMAC-SHA256\s+Credential=([^,]+),\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]+)/i.exec(auth);
  if (!m) return false;
  const [, cred, signedHeaders, provided] = m;
  const { dateStamp, region } = parseCredential(cred);
  const amzDate = req.headers.get('x-amz-date') ?? '';
  const payloadHash = req.headers.get('x-amz-content-sha256') ?? 'UNSIGNED-PAYLOAD';
  const url = new URL(req.url);
  const canonicalUri = url.pathname
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('/');
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalHeaders = signedHeaders
    .split(';')
    .map((h) => `${h}:${(req.headers.get(h) ?? '').trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const canonicalRequest = [req.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  const expected = toHex(await hmac(await signingKey(secret, dateStamp, region), stringToSign));
  return eqHex(expected, provided.toLowerCase());
}

// ───────────────────────── helpers ─────────────────────────
function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, PUT, POST, HEAD, DELETE',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'ETag, Location',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
/** Strip the leading `/plane-media/` (path-style) → the object key. */
function keyFromPath(pathname: string): string {
  const p = decodeURIComponent(pathname.replace(/^\/+/, ''));
  return p.startsWith(BUCKET + '/') ? p.slice(BUCKET.length + 1) : p === BUCKET ? '' : p;
}
function s3Error(code: string, message: string, status: number, origin: string | null): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`,
    { status, headers: { 'Content-Type': 'application/xml', ...corsHeaders(origin) } },
  );
}

/**
 * Retry a transient R2 op with exponential backoff + jitter (error-recovery: max attempts,
 * backoff). R2 binding calls are the "API" here — a transient blip auto-retries instead of
 * failing the user's upload. The fn must be re-runnable (we buffer upload bodies first).
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1) break;
      const backoff = Math.min(2000, 100 * 2 ** i) + Math.floor(Math.random() * 120);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const secret = env.R2_SECRET_ACCESS_KEY;

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    try {
      const key = keyFromPath(url.pathname);

    // ── POST Object (browser presigned-POST upload) — the operation R2 lacks ──
    if (req.method === 'POST' && !url.searchParams.has('delete')) {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return s3Error('MalformedPOSTRequest', 'expected multipart/form-data', 400, origin);
      }
      const fields = new Map<string, string>();
      let file: File | null = null;
      for (const [k, v] of form.entries()) {
        if (v instanceof File) file = v;
        else fields.set(k, v);
      }
      if (!(await validatePostPolicy(fields, secret))) return s3Error('AccessDenied', 'invalid POST policy signature', 403, origin);
      const objKey = fields.get('key');
      if (!objKey || !file) return s3Error('InvalidArgument', 'missing key or file', 400, origin);
      const contentType = fields.get('Content-Type') ?? fields.get('content-type') ?? file.type ?? 'application/octet-stream';
      // Buffer the body so a retried put can re-send it (a consumed stream can't replay).
      const bytes = await file.arrayBuffer();
      const obj = await withRetry(() => env.PLANE_MEDIA.put(objKey, bytes, { httpMetadata: { contentType } }));
      const successStatus = fields.get('success_action_status');
      const headers = { ...corsHeaders(origin), ETag: obj?.httpEtag ?? '""', Location: `${url.origin}/${BUCKET}/${objKey}` };
      if (successStatus === '201') {
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><PostResponse><Location>${headers.Location}</Location><Bucket>${BUCKET}</Bucket><Key>${objKey}</Key><ETag>${headers.ETag}</ETag></PostResponse>`,
          { status: 201, headers: { ...headers, 'Content-Type': 'application/xml' } },
        );
      }
      return new Response(null, { status: successStatus === '200' ? 200 : 204, headers });
    }

    // ── batch delete: POST /plane-media?delete (XML body) ──
    if (req.method === 'POST' && url.searchParams.has('delete')) {
      if (!(await validateSigV4Header(req, secret))) return s3Error('AccessDenied', 'invalid signature', 403, origin);
      const body = await req.text();
      const keys = [...body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((mm) => mm[1]);
      const deleted = await Promise.all(
        keys.map(async (k) => {
          await withRetry(() => env.PLANE_MEDIA.delete(k)).catch(() => undefined);
          return `<Deleted><Key>${k}</Key></Deleted>`;
        }),
      );
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><DeleteResult>${deleted.join('')}</DeleteResult>`, {
        status: 200,
        headers: { 'Content-Type': 'application/xml', ...corsHeaders(origin) },
      });
    }

    // ── GET / HEAD (download / metadata) — capability by key ──
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!key) return s3Error('NoSuchKey', 'object key required', 404, origin);
      const obj = await withRetry(() => (req.method === 'HEAD' ? env.PLANE_MEDIA.head(key) : env.PLANE_MEDIA.get(key)));
      if (!obj) return s3Error('NoSuchKey', 'not found', 404, origin);
      const headers = new Headers(corsHeaders(origin));
      headers.set('ETag', obj.httpEtag);
      headers.set('Content-Length', String(obj.size));
      if (obj.httpMetadata?.contentType) headers.set('Content-Type', obj.httpMetadata.contentType);
      if (req.method === 'HEAD') return new Response(null, { status: 200, headers });
      return new Response((obj as R2ObjectBody).body, { status: 200, headers });
    }

    // ── PUT: CopyObject (x-amz-copy-source) OR PutObject ──
    if (req.method === 'PUT') {
      if (!(await validateSigV4Header(req, secret))) return s3Error('AccessDenied', 'invalid signature', 403, origin);
      if (!key) return s3Error('InvalidArgument', 'object key required', 400, origin);
      const copySource = req.headers.get('x-amz-copy-source');
      if (copySource) {
        const srcKey = keyFromPath(new URL('https://x/' + copySource.replace(/^\//, '')).pathname);
        const src = await withRetry(() => env.PLANE_MEDIA.get(srcKey));
        if (!src) return s3Error('NoSuchKey', 'copy source not found', 404, origin);
        const srcBytes = await src.arrayBuffer();
        const obj = await withRetry(() => env.PLANE_MEDIA.put(key, srcBytes, { httpMetadata: src.httpMetadata }));
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>${obj?.httpEtag ?? '""'}</ETag></CopyObjectResult>`,
          { status: 200, headers: { 'Content-Type': 'application/xml', ...corsHeaders(origin) } },
        );
      }
      const ct = req.headers.get('content-type') ?? undefined;
      const putBytes = await req.arrayBuffer();
      const obj = await withRetry(() => env.PLANE_MEDIA.put(key, putBytes, ct ? { httpMetadata: { contentType: ct } } : undefined));
      return new Response(null, { status: 200, headers: { ...corsHeaders(origin), ETag: obj?.httpEtag ?? '""' } });
    }

    // ── DELETE ──
    if (req.method === 'DELETE') {
      if (!(await validateSigV4Header(req, secret))) return s3Error('AccessDenied', 'invalid signature', 403, origin);
      if (key) await withRetry(() => env.PLANE_MEDIA.delete(key));
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

      return s3Error('MethodNotAllowed', `${req.method} not supported`, 405, origin);
    } catch (err) {
      // Retries above exhausted, or an unexpected fault → return a RETRYABLE 503 so the
      // client (boto / browser) retries later, instead of a hard failure ("retry later").
      console.error('[plane-s3]', err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Error><Code>SlowDown</Code><Message>temporary storage error — retry</Message></Error>`,
        { status: 503, headers: { 'Content-Type': 'application/xml', 'Retry-After': '3', ...corsHeaders(origin) } },
      );
    }
  },
};
