/**
 * Tests for the Integration Directory feature (#30).
 *
 * Two layers:
 *  - Unit: pure slug canonicalization + `siteOrgId` + `generatePages` pairing
 *    logic (dedupe, alphabetical canonicalization, cap, explicit pairs) against
 *    a configurable mock D1.
 *  - Route layer: full auth → requireOrgFlag → site-ownership → handler path via
 *    the shared harness. Asserts 401 unauth / 404 flag-off / 404 cross-org /
 *    200 owned / 400 bad body — proving the multi-tenant isolation guard.
 */

import { integrationDirectoryRoutes } from '../../../../src/routes/integration_directory.js';
import {
  generatePages,
  listServices,
  siteOrgId,
} from '../../../../src/services/integration_directory.js';
import { integrationRouteSlug } from '../feature.schemas.js';
import { authApp, harnessEnv } from '../../../../src/__tests__/helpers/route_harness.js';

/**
 * Configurable D1 double. Routes by SQL substring through `.all()` (every read
 * helper funnels through `dbQuery → .all()`) and records inserts via `.run()`.
 *
 * @param opts.siteOwner - org_id returned for `SELECT org_id FROM sites` (null = no row).
 * @param opts.services  - rows returned for the `integration_services` list.
 * @param opts.existingPages - when true, the pair-existence check returns a row (→ skip).
 */
function db(
  opts: {
    siteOwner?: string | null;
    services?: Array<{ slug: string; name: string }>;
    existingPages?: boolean;
  } = {},
) {
  const { siteOwner = 'org1', services = [], existingPages = false } = opts;
  const inserts: Array<{ sql: string }> = [];
  function prepare(sql: string) {
    const api = {
      bind: () => api,
      first: async () => null,
      run: async () => {
        if (sql.startsWith('INSERT')) inserts.push({ sql });
        return { meta: { changes: 1 } };
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        if (sql.includes('SELECT org_id FROM sites')) {
          return { results: (siteOwner ? [{ org_id: siteOwner }] : []) as unknown as T[] };
        }
        if (sql.includes('FROM integration_services')) {
          return { results: services as unknown as T[] };
        }
        if (sql.includes('FROM integration_pages')) {
          return { results: (existingPages ? [{ id: 'p1' }] : []) as unknown as T[] };
        }
        return { results: [] };
      },
    };
    return api;
  }
  return { db: { prepare } as unknown as D1Database, inserts };
}

const SVC = (slug: string) => ({ slug, name: slug.toUpperCase() });

// ─── Unit: pure helper ───────────────────────────────────────────────

describe('integrationRouteSlug', () => {
  it('canonicalizes pairs alphabetically (order-independent)', () => {
    expect(integrationRouteSlug('stripe', 'mailchimp')).toBe('/integrations/mailchimp/stripe');
    expect(integrationRouteSlug('mailchimp', 'stripe')).toBe('/integrations/mailchimp/stripe');
  });
});

// ─── Unit: service ───────────────────────────────────────────────────

describe('siteOrgId', () => {
  it('returns the owning org for an existing site', async () => {
    const { db: d } = db({ siteOwner: 'org7' });
    expect(await siteOrgId(harnessEnv(d, true), 'site1')).toBe('org7');
  });

  it('returns undefined for a missing site', async () => {
    const { db: d } = db({ siteOwner: null });
    expect(await siteOrgId(harnessEnv(d, true), 'ghost')).toBeUndefined();
  });
});

describe('listServices', () => {
  it('maps rows to validated IntegrationService objects', async () => {
    const { db: d } = db({ services: [SVC('stripe'), SVC('hubspot')] });
    const out = await listServices(harnessEnv(d, true), 'site1');
    expect(out.map((s) => s.slug)).toEqual(['stripe', 'hubspot']);
  });
});

describe('generatePages', () => {
  const env = (o: Parameters<typeof db>[0]) => harnessEnv(db(o).db, true);

  it('no-ops when fewer than 2 services exist', async () => {
    const res = await generatePages(env({ services: [SVC('stripe')] }), 's', 'org1', {
      maxPairs: 200,
    });
    expect(res).toEqual({ inserted: 0, skipped: 0 });
  });

  it('generates the full cross-product when no explicit pairs are given', async () => {
    const res = await generatePages(
      env({ services: [SVC('a'), SVC('b'), SVC('c')] }),
      's',
      'org1',
      { maxPairs: 200 },
    );
    // 3 choose 2 = 3 pairs, none pre-existing
    expect(res).toEqual({ inserted: 3, skipped: 0 });
  });

  it('honors maxPairs as a cap on the cross-product', async () => {
    const res = await generatePages(
      env({ services: [SVC('a'), SVC('b'), SVC('c'), SVC('d')] }),
      's',
      'org1',
      { maxPairs: 2 },
    );
    expect(res.inserted).toBe(2);
  });

  it('skips self-pairs and dedupes against existing rows', async () => {
    const res = await generatePages(
      env({ services: [SVC('a'), SVC('b')], existingPages: true }),
      's',
      'org1',
      {
        pairs: [
          ['a', 'a'],
          ['a', 'b'],
        ],
        maxPairs: 200,
      },
    );
    // a==a dropped; a/b already exists → skipped
    expect(res).toEqual({ inserted: 0, skipped: 1 });
  });
});

// ─── Route layer: auth + flag + tenant isolation ─────────────────────

describe('integration_directory handler (route layer)', () => {
  const URL = '/site1/integrations/services';

  it('401 when unauthenticated', async () => {
    const app = authApp(integrationDirectoryRoutes);
    const res = await app.request(URL, {}, harnessEnv(db().db, true));
    expect(res.status).toBe(401);
  });

  it('404 when the flag is off', async () => {
    const app = authApp(integrationDirectoryRoutes, { userId: 'u', orgId: 'org1' });
    const res = await app.request(URL, {}, harnessEnv(db().db, false));
    expect(res.status).toBe(404);
  });

  it('404 when the site belongs to another org (tenant isolation)', async () => {
    const app = authApp(integrationDirectoryRoutes, { userId: 'u', orgId: 'org1' });
    const res = await app.request(URL, {}, harnessEnv(db({ siteOwner: 'OTHER_ORG' }).db, true));
    expect(res.status).toBe(404);
  });

  it('404 when the site does not exist', async () => {
    const app = authApp(integrationDirectoryRoutes, { userId: 'u', orgId: 'org1' });
    const res = await app.request(URL, {}, harnessEnv(db({ siteOwner: null }).db, true));
    expect(res.status).toBe(404);
  });

  it('200 lists services for an org-owned site', async () => {
    const app = authApp(integrationDirectoryRoutes, { userId: 'u', orgId: 'org1' });
    const res = await app.request(
      URL,
      {},
      harnessEnv(db({ siteOwner: 'org1', services: [SVC('stripe')] }).db, true),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { services: Array<{ slug: string }> };
    expect(body.services[0]?.slug).toBe('stripe');
  });

  it('400 on an invalid seed body (owned site, flag on)', async () => {
    const app = authApp(integrationDirectoryRoutes, { userId: 'u', orgId: 'org1' });
    const res = await app.request(
      '/site1/integrations/seed',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ services: [] }), // min(1) violated
      },
      harnessEnv(db({ siteOwner: 'org1' }).db, true),
    );
    expect(res.status).toBe(400);
  });

  it('cross-org seed is blocked BEFORE any write (404, no insert)', async () => {
    const app = authApp(integrationDirectoryRoutes, { userId: 'u', orgId: 'org1' });
    const { db: d, inserts } = db({ siteOwner: 'OTHER_ORG' });
    const res = await app.request(
      '/site1/integrations/seed',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ services: [SVC('stripe')] }),
      },
      harnessEnv(d, true),
    );
    expect(res.status).toBe(404);
    expect(inserts).toHaveLength(0);
  });
});
