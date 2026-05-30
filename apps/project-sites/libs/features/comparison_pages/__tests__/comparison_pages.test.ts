/**
 * Tests for the Comparison Pages Engine (#31).
 *
 * Two layers:
 *  - Unit: pure route-slug derivation + `siteOrgId` + `listCompetitors` mapping
 *    + `generatePages` (skip-unknown-competitor, per-kind dedupe, cap) against a
 *    configurable mock D1.
 *  - Route layer: full auth → requireOrgFlag → site-ownership → handler via the
 *    shared harness. Asserts 401 / 404-flag-off / 404-cross-org / 404-missing /
 *    200-owned / 400-bad-body / cross-org-seed-blocked-before-write — proving
 *    the multi-tenant isolation guard.
 */

import { comparisonPagesRoutes } from '../../../../src/routes/comparison_pages.js';
import {
  generatePages,
  listCompetitors,
  siteOrgId,
} from '../../../../src/services/comparison_pages.js';
import { comparisonRouteSlug } from '../feature.schemas.js';
import { authApp, harnessEnv } from '../../../../src/__tests__/helpers/route_harness.js';

/**
 * Configurable D1 double. Routes by SQL substring through `.all()` (every read
 * helper funnels through `dbQuery → .all()`) and records inserts via `.run()`.
 *
 * @param opts.siteOwner       - org_id for `SELECT org_id FROM sites` (null = no row).
 * @param opts.competitors     - rows for the `competitors` list query.
 * @param opts.knownCompetitor - when true, the per-slug existence check finds a competitor.
 * @param opts.existingPages   - when true, the per-kind dedupe check finds a page (→ skip).
 */
function db(
  opts: {
    siteOwner?: string | null;
    competitors?: Array<{ slug: string; name: string }>;
    knownCompetitor?: boolean;
    existingPages?: boolean;
  } = {},
) {
  const {
    siteOwner = 'org1',
    competitors = [],
    knownCompetitor = false,
    existingPages = false,
  } = opts;
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
        // generatePages: competitor-exists check (SELECT id) vs page-dedupe check.
        if (sql.includes('FROM comparison_pages')) {
          return { results: (existingPages ? [{ id: 'pg1' }] : []) as unknown as T[] };
        }
        if (sql.includes('SELECT id FROM competitors')) {
          return { results: (knownCompetitor ? [{ id: 'c1' }] : []) as unknown as T[] };
        }
        if (sql.includes('FROM competitors')) {
          return { results: competitors as unknown as T[] };
        }
        return { results: [] };
      },
    };
    return api;
  }
  return { db: { prepare } as unknown as D1Database, inserts };
}

const CMP = (slug: string) => ({ slug, name: slug.toUpperCase() });

// ─── Unit: pure helper ───────────────────────────────────────────────

describe('comparisonRouteSlug', () => {
  it('routes vs vs alternatives correctly', () => {
    expect(comparisonRouteSlug('wix', 'vs')).toBe('/vs/wix');
    expect(comparisonRouteSlug('wix', 'alternatives')).toBe('/alternatives/wix');
  });
});

// ─── Unit: service ───────────────────────────────────────────────────

describe('siteOrgId', () => {
  it('returns the owning org for an existing site', async () => {
    expect(await siteOrgId(harnessEnv(db({ siteOwner: 'org9' }).db, true), 'site1')).toBe('org9');
  });
  it('returns undefined for a missing site', async () => {
    expect(await siteOrgId(harnessEnv(db({ siteOwner: null }).db, true), 'ghost')).toBeUndefined();
  });
});

describe('listCompetitors', () => {
  it('maps rows to Competitor objects', async () => {
    const { db: d } = db({ competitors: [CMP('wix'), CMP('squarespace')] });
    const out = await listCompetitors(harnessEnv(d, true), 'site1');
    expect(out.map((c) => c.slug)).toEqual(['wix', 'squarespace']);
  });
});

describe('generatePages', () => {
  it('skips slugs that are not seeded competitors', async () => {
    const { db: d } = db({ knownCompetitor: false });
    const res = await generatePages(harnessEnv(d, true), 'site1', 'org1', {
      competitorSlugs: ['ghost'],
      kinds: ['vs', 'alternatives'],
    });
    expect(res).toEqual({ inserted: 0, skipped: 1 });
  });

  it('inserts one page per kind for a known competitor', async () => {
    const { db: d, inserts } = db({ knownCompetitor: true, existingPages: false });
    const res = await generatePages(harnessEnv(d, true), 'site1', 'org1', {
      competitorSlugs: ['wix'],
      kinds: ['vs', 'alternatives'],
    });
    expect(res).toEqual({ inserted: 2, skipped: 0 });
    expect(inserts).toHaveLength(2);
  });

  it('dedupes against existing pages of the same kind', async () => {
    const { db: d } = db({ knownCompetitor: true, existingPages: true });
    const res = await generatePages(harnessEnv(d, true), 'site1', 'org1', {
      competitorSlugs: ['wix'],
      kinds: ['vs'],
    });
    expect(res).toEqual({ inserted: 0, skipped: 1 });
  });
});

// ─── Route layer: auth + flag + tenant isolation ─────────────────────

describe('comparison_pages handler (route layer)', () => {
  const URL = '/site1/comparisons/competitors';

  it('401 when unauthenticated', async () => {
    const app = authApp(comparisonPagesRoutes);
    expect((await app.request(URL, {}, harnessEnv(db().db, true))).status).toBe(401);
  });

  it('404 when the flag is off', async () => {
    const app = authApp(comparisonPagesRoutes, { userId: 'u', orgId: 'org1' });
    expect((await app.request(URL, {}, harnessEnv(db().db, false))).status).toBe(404);
  });

  it('404 when the site belongs to another org (tenant isolation)', async () => {
    const app = authApp(comparisonPagesRoutes, { userId: 'u', orgId: 'org1' });
    expect(
      (await app.request(URL, {}, harnessEnv(db({ siteOwner: 'OTHER_ORG' }).db, true))).status,
    ).toBe(404);
  });

  it('404 when the site does not exist', async () => {
    const app = authApp(comparisonPagesRoutes, { userId: 'u', orgId: 'org1' });
    expect((await app.request(URL, {}, harnessEnv(db({ siteOwner: null }).db, true))).status).toBe(
      404,
    );
  });

  it('200 lists competitors for an org-owned site', async () => {
    const app = authApp(comparisonPagesRoutes, { userId: 'u', orgId: 'org1' });
    const res = await app.request(
      URL,
      {},
      harnessEnv(db({ siteOwner: 'org1', competitors: [CMP('wix')] }).db, true),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { competitors: Array<{ slug: string }> };
    expect(body.competitors[0]?.slug).toBe('wix');
  });

  it('400 on an invalid seed body (owned site, flag on)', async () => {
    const app = authApp(comparisonPagesRoutes, { userId: 'u', orgId: 'org1' });
    const res = await app.request(
      '/site1/comparisons/competitors',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ competitors: [] }), // min(1) violated
      },
      harnessEnv(db({ siteOwner: 'org1' }).db, true),
    );
    expect(res.status).toBe(400);
  });

  it('cross-org seed is blocked BEFORE any write (404, no insert)', async () => {
    const app = authApp(comparisonPagesRoutes, { userId: 'u', orgId: 'org1' });
    const { db: d, inserts } = db({ siteOwner: 'OTHER_ORG' });
    const res = await app.request(
      '/site1/comparisons/competitors',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ competitors: [CMP('wix')] }),
      },
      harnessEnv(d, true),
    );
    expect(res.status).toBe(404);
    expect(inserts).toHaveLength(0);
  });
});
