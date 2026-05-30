/**
 * Route-LAYER tests for site_analytics handler (Hono app.request + harness).
 * Covers: 401 unauth, 404 flag-off, 404 site-not-owned, 200 owned summary.
 */

import { siteAnalytics } from '../handlers.js';
import { authApp, harnessEnv } from '../../../../src/__tests__/helpers/route_harness.js';

/** D1 double: site→org lookup (configurable) + zeroed analytics counts; .first()→null. */
function db(siteOwner: string | null = 'org1') {
  function prepare(sql: string) {
    const api = {
      bind: () => api,
      first: async () => null,
      run: async () => ({ meta: { changes: 0 } }),
      all: async <T>(): Promise<{ results: T[] }> => {
        if (sql.includes('SELECT org_id FROM sites')) {
          return { results: (siteOwner ? [{ org_id: siteOwner }] : []) as unknown as T[] };
        }
        // GROUP BY breakdowns (bySource/topPaths/byType) also contain COUNT(*) —
        // return [] BEFORE the scalar COUNT branch, else a {n:0} row with no
        // grouped column fails schema parse.
        if (sql.includes('GROUP BY')) return { results: [] };
        if (sql.includes('COUNT')) return { results: [{ n: 0 }] as unknown as T[] };
        return { results: [] }; // visitor_events scalars + flag override
      },
    };
    return api;
  }
  return { prepare } as unknown as D1Database;
}

const URL = '/api/sites/site1/analytics';

describe('site_analytics handler (route layer)', () => {
  it('401 when unauthenticated', async () => {
    const app = authApp(siteAnalytics);
    expect((await app.request(URL, {}, harnessEnv(db(), true))).status).toBe(401);
  });

  it('404 when the flag is off', async () => {
    const app = authApp(siteAnalytics, { userId: 'u', orgId: 'org1' });
    expect((await app.request(URL, {}, harnessEnv(db(), false))).status).toBe(404);
  });

  it('404 when the site belongs to another org', async () => {
    const app = authApp(siteAnalytics, { userId: 'u', orgId: 'org1' });
    expect((await app.request(URL, {}, harnessEnv(db('OTHER_ORG'), true))).status).toBe(404);
  });

  it('200 returns the summary for an org-owned site', async () => {
    const app = authApp(siteAnalytics, { userId: 'u', orgId: 'org1' });
    const res = await app.request(URL, {}, harnessEnv(db('org1'), true));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      siteId: string;
      contacts: { total: number };
      traffic: { pageviews: number };
    };
    expect(body.siteId).toBe('site1');
    expect(body.contacts.total).toBe(0);
    expect(body.traffic.pageviews).toBe(0);
  });
});
