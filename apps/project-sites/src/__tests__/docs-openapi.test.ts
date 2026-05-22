/**
 * @fileoverview Unit tests for the `/api/admin/docs/*` explorer backend.
 *
 * Asserts:
 *   1. The hand-curated `buildOpenApiSpec()` emits ≥ 30 paths.
 *   2. Every authenticated path declares `security: [{ bearerAuth: [] }]`.
 *   3. Every path advertises the standard error envelope under 4xx/5xx.
 *   4. `requireUser`-style guarding: handler returns 401 envelope when no userId
 *      is on the Hono context, and the OpenAPI body when a userId is present.
 *   5. The Angular overview markdown contains the state-machine arrow string.
 */
import { Hono } from 'hono';
import { docs, buildOpenApiSpec, buildAppOverviewMarkdown } from '../routes/docs.js';

describe('buildOpenApiSpec()', () => {
  const spec = buildOpenApiSpec();
  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

  it('emits a 3.1 spec with the expected top-level shape', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toBeDefined();
    expect((spec.info as { title?: string }).title).toBe('Project Sites API');
    expect(spec.components).toBeDefined();
  });

  it('documents at least 30 paths', () => {
    expect(Object.keys(paths).length).toBeGreaterThanOrEqual(30);
  });

  it('attaches Bearer security to every authenticated operation', () => {
    const authPaths: string[] = [];
    let authCount = 0;
    let unauthCount = 0;
    for (const [pathName, methods] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (method === 'parameters') continue;
        const security = (op as { security?: unknown[] }).security;
        if (Array.isArray(security) && security.length > 0) {
          authCount++;
          authPaths.push(`${method.toUpperCase()} ${pathName}`);
          expect(security[0]).toEqual({ bearerAuth: [] });
        } else {
          unauthCount++;
        }
      }
    }
    // Every authenticated path that is documented must use the Bearer scheme.
    expect(authCount).toBeGreaterThanOrEqual(25);
    expect(unauthCount).toBeGreaterThan(0);
  });

  it('emits the standard error envelope under 4xx/5xx for every operation', () => {
    for (const methods of Object.values(paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (method === 'parameters') continue;
        const responses = (op as { responses?: Record<string, unknown> }).responses ?? {};
        expect(responses['400']).toBeDefined();
        expect(responses['500']).toBeDefined();
      }
    }
  });

  it('extracts path parameters from `{param}` segments', () => {
    const sitePath = paths['/api/sites/{id}'];
    expect(sitePath).toBeDefined();
    const get = sitePath!['get'] as { parameters?: Array<{ name: string; in: string }> };
    expect(get.parameters).toBeDefined();
    expect(get.parameters!.some((p) => p.name === 'id' && p.in === 'path')).toBe(true);
  });

  it('exposes the docs explorer itself', () => {
    expect(paths['/api/admin/docs/openapi.json']).toBeDefined();
    expect(paths['/api/admin/docs/app-overview']).toBeDefined();
  });

  it('declares the standard error schema component', () => {
    const components = spec.components as { schemas?: { Error?: { type?: string } } };
    expect(components.schemas?.Error?.type).toBe('object');
  });

  it('lists all major tags', () => {
    const tags = (spec.tags as Array<{ name: string }>).map((t) => t.name);
    for (const expected of ['auth', 'sites', 'billing', 'hostnames', 'webhooks', 'ai', 'admin']) {
      expect(tags).toContain(expected);
    }
  });
});

describe('buildAppOverviewMarkdown()', () => {
  const md = buildAppOverviewMarkdown();

  it('returns a non-trivial markdown body', () => {
    expect(md.length).toBeGreaterThan(800);
  });

  it('documents the homepage state-machine arrow', () => {
    expect(md).toContain('search');
    expect(md).toContain('signin');
    expect(md).toContain('details');
    expect(md).toContain('waiting');
  });

  it('renders the route tree headings', () => {
    expect(md).toContain('## Route Tree');
    expect(md).toContain('/admin/docs');
    expect(md).toContain('AppComponent');
  });
});

describe('/api/admin/docs/* route handlers', () => {
  /** Fresh Hono app mirroring how `index.ts` mounts the sub-app + auth middleware. */
  function buildApp(opts: { userId?: string } = {}): Hono {
    const app = new Hono();
    app.use('*', async (c, next) => {
      if (opts.userId) c.set('userId', opts.userId);
      c.set('requestId', 'req-test-1');
      await next();
    });
    app.route('/', docs);
    return app;
  }

  it('returns 401 for /openapi.json when unauthenticated', async () => {
    const app = buildApp();
    const res = await app.request('/api/admin/docs/openapi.json');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns the spec for /openapi.json when authenticated', async () => {
    const app = buildApp({ userId: 'user-1' });
    const res = await app.request('/api/admin/docs/openapi.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openapi?: string; paths?: Record<string, unknown> };
    expect(body.openapi).toBe('3.1.0');
    expect(Object.keys(body.paths ?? {}).length).toBeGreaterThanOrEqual(30);
  });

  it('returns 401 for /app-overview when unauthenticated', async () => {
    const app = buildApp();
    const res = await app.request('/api/admin/docs/app-overview');
    expect(res.status).toBe(401);
  });

  it('returns markdown + timestamp for /app-overview when authenticated', async () => {
    const app = buildApp({ userId: 'user-1' });
    const res = await app.request('/api/admin/docs/app-overview');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { markdown?: string; generated_at?: string } };
    expect(body.data?.markdown).toContain('Angular SPA');
    expect(body.data?.generated_at).toBeTruthy();
  });
});
