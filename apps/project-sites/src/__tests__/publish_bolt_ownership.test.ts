/**
 * Cross-org publish IDOR guards for the two bolt.diy publish endpoints.
 *
 * BUG CLASS — write-to-attacker-controlled-slug (site takeover / defacement):
 *
 *  1. `POST /api/publish/bolt` (no `:id`, reachable UNAUTHENTICATED) took the
 *     target `slug` from the request BODY and, when it named an EXISTING site,
 *     overwrote that site's R2 files + `_manifest.json` current_version + purged
 *     its hostname KV — with ZERO ownership check. Any caller could POST
 *     `{ files:[…], slug:'<victim>' }` and replace another org's LIVE site with
 *     arbitrary HTML/JS. Fix: re-publish over an existing site row requires the
 *     caller's org to own it (404 non-leak otherwise); brand-new slugs stay
 *     anonymously publishable.
 *
 *  2. `POST /api/sites/:id/publish-bolt` verified org-ownership of the `:id`
 *     path param but then wrote to a body-supplied `providedSlug || site.slug`
 *     — so an owner of site A could pass `slug:'<victim>'` and overwrite site B.
 *     Fix: always publish to the verified-owned `site.slug`; ignore the body slug.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { api } from '../routes/api.js';
import { errorHandler } from '../middleware/error_handler.js';

interface DbConfig {
  /** org_id returned for `SELECT … FROM sites WHERE slug = ?`, or null (no row). */
  siteBySlugOrg?: string | null;
  /** Row returned for `SELECT … FROM sites WHERE id = ?`, or null. */
  siteById?: { id: string; slug: string; org_id: string; business_name: string | null } | null;
}

function makeEnv(cfg: DbConfig) {
  const r2Puts: string[] = [];
  const kvDeletes: string[] = [];
  // Resolve the row a SELECT should yield (dbQueryOne reads `.all().results[0]`;
  // the mock also serves `.first()` defensively for any direct-read consumer).
  const rowFor = (sql: string): Record<string, unknown> | null => {
    if (/FROM sites WHERE slug = \?/i.test(sql)) {
      return cfg.siteBySlugOrg == null ? null : { org_id: cfg.siteBySlugOrg };
    }
    if (/FROM sites WHERE id = \?/i.test(sql)) return cfg.siteById ?? null;
    return null;
  };
  const db = {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          const row = rowFor(sql);
          return {
            first: async () => row,
            all: async () => ({ results: row ? [row] : [] }),
            run: async () => ({ meta: { changes: 1 } }),
          };
        },
      };
    },
  } as unknown as Env['DB'];
  const SITES_BUCKET = {
    get: async () => null,
    put: async (key: string) => {
      r2Puts.push(key);
      return {} as R2Object;
    },
  } as unknown as Env['SITES_BUCKET'];
  const CACHE_KV = {
    delete: async (key: string) => {
      kvDeletes.push(key);
    },
  } as unknown as Env['CACHE_KV'];
  const env = { DB: db, SITES_BUCKET, CACHE_KV } as unknown as Env;
  return { env, r2Puts, kvDeletes };
}

function makeApp(env: Env, caller: { orgId?: string; userId?: string }) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (caller.orgId) c.set('orgId', caller.orgId);
    if (caller.userId) c.set('userId', caller.userId);
    c.set('requestId', 'test-req');
    await next();
  });
  app.route('/', api);
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  return (path: string, body: unknown) =>
    app.request(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      { ...({} as Env), ...env } as Env,
      ctx,
    );
}

const FILES = [{ path: 'index.html', content: '<h1>x</h1>' }];
const CHAT = { messages: [], description: 'X', exportDate: '2026-01-01' };

describe('POST /api/publish/bolt — cross-org overwrite guard', () => {
  it('404s + writes nothing when a DIFFERENT org publishes over an existing site', async () => {
    const { env, r2Puts, kvDeletes } = makeEnv({ siteBySlugOrg: 'victim-org' });
    const res = await makeApp(env, { orgId: 'attacker-org', userId: 'attacker' })(
      '/api/publish/bolt',
      {
        files: FILES,
        chat: CHAT,
        slug: 'victim-slug',
      },
    );
    expect(res.status).toBe(404);
    expect(r2Puts).toEqual([]); // never touched the victim's R2
    expect(kvDeletes).toEqual([]); // never purged the victim's cache
  });

  it('404s + writes nothing when an UNAUTHENTICATED caller publishes over an existing site', async () => {
    const { env, r2Puts } = makeEnv({ siteBySlugOrg: 'victim-org' });
    const res = await makeApp(env, {})('/api/publish/bolt', {
      files: FILES,
      chat: CHAT,
      slug: 'victim-slug',
    });
    expect(res.status).toBe(404);
    expect(r2Puts).toEqual([]);
  });

  it('allows the OWNING org to re-publish its own existing site', async () => {
    const { env, r2Puts } = makeEnv({ siteBySlugOrg: 'victim-org' });
    const res = await makeApp(env, { orgId: 'victim-org', userId: 'owner' })('/api/publish/bolt', {
      files: FILES,
      chat: CHAT,
      slug: 'victim-slug',
    });
    expect(res.status).toBe(201);
    expect(r2Puts.some((k) => k.startsWith('sites/victim-slug/'))).toBe(true);
  });

  it('allows anonymous publish to a BRAND-NEW slug (no existing site row)', async () => {
    const { env, r2Puts } = makeEnv({ siteBySlugOrg: null });
    const res = await makeApp(env, {})('/api/publish/bolt', {
      files: FILES,
      chat: CHAT,
      slug: 'brand-new-slug',
    });
    expect(res.status).toBe(201);
    expect(r2Puts.some((k) => k.startsWith('sites/brand-new-slug/'))).toBe(true);
  });
});

describe('POST /api/sites/:id/publish-bolt — write target is the OWNED slug, not the body slug', () => {
  it('ignores an attacker-supplied body slug and writes only to the owned site slug', async () => {
    const { env, r2Puts, kvDeletes } = makeEnv({
      siteById: {
        id: 'site-a-id',
        slug: 'site-a-slug',
        org_id: 'attacker-org',
        business_name: 'A',
      },
    });
    const res = await makeApp(env, { orgId: 'attacker-org', userId: 'attacker' })(
      '/api/sites/site-a-id/publish-bolt',
      { files: FILES, chat: CHAT, slug: 'victim-slug' },
    );
    expect(res.status).toBe(200);
    // Every R2 write + cache purge targets the OWNED slug, never the body slug.
    expect(r2Puts.every((k) => k.startsWith('sites/site-a-slug/'))).toBe(true);
    expect(r2Puts.some((k) => k.includes('victim-slug'))).toBe(false);
    expect(kvDeletes.every((k) => !k.includes('victim-slug'))).toBe(true);
  });
});
