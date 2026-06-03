/**
 * Route coverage for the `assets` sub-app (convergence r37).
 *
 * Exercises both handlers end-to-end through the real Hono app, mocking only
 * the boundaries (R2 `SITES_BUCKET`, D1 `DB`):
 *   - `POST /api/assets/upload` — auth 401, multipart upload to R2, type and
 *     size validation, name sanitization, the 25-file cap, and the success
 *     envelope.
 *   - `GET  /api/sites/:id/build-assets` — auth 401, org/site scoping (404 on
 *     a missing or wrong-org site), R2 prefix listing, the manifest/build-
 *     context filter, and the public-URL derivation.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { assets } from '../routes/assets.js';

// ─── Boundary mocks ──────────────────────────────────────────────────────────

interface PutCall {
  key: string;
  value: ArrayBuffer;
  options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  };
}

/** In-memory R2 bucket mock recording `put` calls and replaying `list`. */
function makeBucket(listObjects: Array<Record<string, unknown>> = []) {
  const puts: PutCall[] = [];
  return {
    put: jest.fn(async (key: string, value: ArrayBuffer, options?: PutCall['options']) => {
      puts.push({ key, value, options });
      return { key };
    }),
    list: jest.fn(async (_opts?: { prefix?: string; limit?: number }) => ({
      objects: listObjects,
      truncated: false,
    })),
    _puts: puts,
  };
}

/** D1 mock whose `.first()` resolves to the supplied row (or null = not found). */
function makeDb(row: { slug: string } | null) {
  const first = jest.fn(async () => row);
  const bind = jest.fn(() => ({ first }));
  const prepare = jest.fn(() => ({ bind }));
  return { prepare, bind, first } as unknown as D1Database & {
    prepare: jest.Mock;
    bind: jest.Mock;
    first: jest.Mock;
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: makeDb(null),
    SITES_BUCKET: makeBucket(),
    ...overrides,
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

/**
 * Build the app with a middleware that seeds the auth context vars the handler
 * reads (`orgId`, `userId`, `requestId`). Passing no vars simulates an
 * unauthenticated request.
 */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', assets);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

/**
 * Build a real File whose `size` is the byte length of its contents. The
 * handler reads `file.size` AFTER the multipart round-trip re-serializes the
 * blob, so a `defineProperty` override would be lost — we must back the size
 * with actual bytes.
 */
function makeFile(name: string, type: string, size: number): File {
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

function uploadReq(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  form: FormData | undefined,
  env: Env,
) {
  return app.request('/api/assets/upload', { method: 'POST', body: form }, env, makeCtx());
}

function listReq(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  siteId: string,
  env: Env,
) {
  return app.request(`/api/sites/${siteId}/build-assets`, { method: 'GET' }, env, makeCtx());
}

const AUTH: Partial<Variables> = { orgId: 'org-1', userId: 'user-1', requestId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── POST /api/assets/upload ───────────────────────────────────────────────────

describe('POST /api/assets/upload', () => {
  it('returns 401 when the request is unauthenticated', async () => {
    const env = makeEnv();
    const form = new FormData();
    form.set('logo', makeFile('logo.png', 'image/png', 1024));
    const res = await uploadReq(makeApp(), form, env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    // Must short-circuit before touching R2.
    expect((env.SITES_BUCKET as unknown as { put: jest.Mock }).put).not.toHaveBeenCalled();
  });

  it('uploads a logo to R2 and returns a populated success envelope', async () => {
    const bucket = makeBucket();
    const env = makeEnv({ SITES_BUCKET: bucket });
    const form = new FormData();
    form.set('logo', makeFile('My Logo.png', 'image/png', 2048));

    const res = await uploadReq(makeApp(AUTH), form, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { upload_id: string; assets: Array<Record<string, unknown>> };
    };

    expect(typeof json.data.upload_id).toBe('string');
    expect(json.data.upload_id.length).toBeGreaterThan(0);
    expect(json.data.assets).toHaveLength(1);
    const asset = json.data.assets[0];
    expect(asset['name']).toBe('My Logo.png');
    expect(asset['type']).toBe('image/png');
    expect(asset['size']).toBe(2048);

    // R2 received exactly one put, under uploads/{id}/logo/ with sanitized name.
    expect(bucket._puts).toHaveLength(1);
    const put = bucket._puts[0];
    expect(put.key).toMatch(/^uploads\/[0-9a-f-]+\/logo\/My_Logo\.png$/);
    expect(put.options?.httpMetadata?.contentType).toBe('image/png');
    expect(put.options?.customMetadata?.category).toBe('logo');
    expect(put.options?.customMetadata?.originalName).toBe('My Logo.png');
  });

  it('uploads logo, favicon, and multiple images each under its category prefix', async () => {
    const bucket = makeBucket();
    const env = makeEnv({ SITES_BUCKET: bucket });
    const form = new FormData();
    form.set('logo', makeFile('logo.svg', 'image/svg+xml', 512));
    form.set('favicon', makeFile('favicon.png', 'image/png', 256));
    form.append('images', makeFile('a.jpg', 'image/jpeg', 1000));
    form.append('images', makeFile('b.webp', 'image/webp', 1000));

    const res = await uploadReq(makeApp(AUTH), form, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { assets: Array<Record<string, unknown>> } };
    expect(json.data.assets).toHaveLength(4);

    const keys = bucket._puts.map((p) => p.key);
    expect(keys.some((k) => /\/logo\/logo\.svg$/.test(k))).toBe(true);
    expect(keys.some((k) => /\/favicon\/favicon\.png$/.test(k))).toBe(true);
    expect(keys.filter((k) => /\/images\//.test(k))).toHaveLength(2);
    // All four share the same upload_id prefix.
    const ids = new Set(keys.map((k) => k.split('/')[1]));
    expect(ids.size).toBe(1);
  });

  it('rejects a file that exceeds the 10MB per-file size cap', async () => {
    const bucket = makeBucket();
    const env = makeEnv({ SITES_BUCKET: bucket });
    const form = new FormData();
    form.set('logo', makeFile('huge.png', 'image/png', 11 * 1024 * 1024));

    const res = await uploadReq(makeApp(AUTH), form, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { assets: unknown[] } };
    // Oversized file is skipped, not stored.
    expect(json.data.assets).toHaveLength(0);
    expect(bucket._puts).toHaveLength(0);
  });

  it('rejects a disallowed file type with no matching extension', async () => {
    const bucket = makeBucket();
    const env = makeEnv({ SITES_BUCKET: bucket });
    const form = new FormData();
    form.set('logo', makeFile('payload.exe', 'application/octet-stream', 1024));

    const res = await uploadReq(makeApp(AUTH), form, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { assets: unknown[] } };
    expect(json.data.assets).toHaveLength(0);
    expect(bucket._puts).toHaveLength(0);
  });

  it('accepts a file by extension when its MIME type is generic', async () => {
    const bucket = makeBucket();
    const env = makeEnv({ SITES_BUCKET: bucket });
    const form = new FormData();
    // Generic MIME but a .png extension → allowed via the extension fallback.
    form.set('logo', makeFile('brand.png', 'application/octet-stream', 1024));

    const res = await uploadReq(makeApp(AUTH), form, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { assets: unknown[] } };
    expect(json.data.assets).toHaveLength(1);
    expect(bucket._puts).toHaveLength(1);
  });

  it('caps the number of stored files at 25', async () => {
    const bucket = makeBucket();
    const env = makeEnv({ SITES_BUCKET: bucket });
    const form = new FormData();
    for (let i = 0; i < 30; i++) {
      form.append('images', makeFile(`img-${i}.jpg`, 'image/jpeg', 1000));
    }

    const res = await uploadReq(makeApp(AUTH), form, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { assets: unknown[] } };
    expect(json.data.assets).toHaveLength(25);
    expect(bucket._puts).toHaveLength(25);
  });

  it('ignores empty (zero-size) file fields', async () => {
    const bucket = makeBucket();
    const env = makeEnv({ SITES_BUCKET: bucket });
    const form = new FormData();
    form.set('logo', makeFile('empty.png', 'image/png', 0));

    const res = await uploadReq(makeApp(AUTH), form, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { assets: unknown[] } };
    expect(json.data.assets).toHaveLength(0);
    expect(bucket._puts).toHaveLength(0);
  });
});

// ─── GET /api/sites/:id/build-assets ───────────────────────────────────────────

describe('GET /api/sites/:id/build-assets', () => {
  it('returns 401 when the request is unauthenticated', async () => {
    const env = makeEnv();
    const res = await listReq(makeApp(), 'site-1', env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    // Must short-circuit before any D1 lookup.
    expect((env.DB as unknown as { prepare: jest.Mock }).prepare).not.toHaveBeenCalled();
  });

  it('returns 404 when the site is missing or belongs to another org', async () => {
    const db = makeDb(null); // first() → null = not found / wrong org
    const env = makeEnv({ DB: db });
    const res = await listReq(makeApp(AUTH), 'ghost-site', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    // The lookup is org-scoped: the bound params include siteId + orgId.
    expect((db as unknown as { bind: jest.Mock }).bind).toHaveBeenCalledWith('ghost-site', 'org-1');
    // R2 list never runs for an unresolved site.
    expect((env.SITES_BUCKET as unknown as { list: jest.Mock }).list).not.toHaveBeenCalled();
  });

  it('lists R2 assets for a resolved site and derives public URLs', async () => {
    const uploaded = new Date('2026-05-01T12:00:00.000Z');
    const bucket = makeBucket([
      { key: 'sites/acme/assets/hero.jpg', size: 4321, uploaded },
      { key: 'sites/acme/assets/logo.svg', size: 900, uploaded },
      // Filtered out — internal build artifacts.
      { key: 'sites/acme/assets/_manifest.json', size: 50, uploaded },
      { key: 'sites/acme/assets/_build-context.json', size: 70, uploaded },
    ]);
    const db = makeDb({ slug: 'acme' });
    const env = makeEnv({ DB: db, SITES_BUCKET: bucket });

    const res = await listReq(makeApp(AUTH), 'site-acme', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{
        key: string;
        name: string;
        type: string;
        size: number;
        url: string;
        uploaded: string;
      }>;
    };

    // The two internal artifacts are filtered out.
    expect(json.data).toHaveLength(2);

    const hero = json.data.find((a) => a.name === 'hero.jpg');
    expect(hero).toBeDefined();
    expect(hero?.type).toBe('jpg');
    expect(hero?.size).toBe(4321);
    expect(hero?.url).toBe('https://acme.projectsites.dev/assets/hero.jpg');
    expect(hero?.uploaded).toBe('2026-05-01T12:00:00.000Z');

    const logo = json.data.find((a) => a.name === 'logo.svg');
    expect(logo?.type).toBe('svg');
    expect(logo?.url).toBe('https://acme.projectsites.dev/assets/logo.svg');

    // List was scoped to the site's asset prefix.
    expect(bucket.list).toHaveBeenCalledWith({ prefix: 'sites/acme/assets/', limit: 100 });
  });

  it('returns an empty array when the site has no build assets', async () => {
    const bucket = makeBucket([]);
    const db = makeDb({ slug: 'empty-site' });
    const env = makeEnv({ DB: db, SITES_BUCKET: bucket });

    const res = await listReq(makeApp(AUTH), 'site-empty', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toEqual([]);
  });
});
