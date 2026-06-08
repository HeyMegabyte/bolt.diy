/**
 * Supplemental route-layer tests for the site_analytics handler — covers two
 * branches the existing handler spec leaves untested:
 *   - the `windowDays` query clamp (`Number.isInteger && >0 && <=365 ? : 30`)
 *   - the nonexistent-site path (`siteOrgId` → null → 404), distinct from the
 *     wrong-org 404 the sibling spec already covers.
 *
 * New file (not an edit of the existing spec) for clean isolation. Reuses the
 * shared route harness; the D1 double echoes zeroed analytics so the response
 * `windowDays` reflects exactly what the handler resolved.
 */

import { siteAnalytics } from '../handlers.js';
import { authApp, harnessEnv } from '../../../../src/__tests__/helpers/route_harness.js';

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
        if (sql.includes('GROUP BY')) return { results: [] };
        if (sql.includes('COUNT')) return { results: [{ n: 0 }] as unknown as T[] };
        return { results: [] };
      },
    };
    return api;
  }
  return { prepare } as unknown as D1Database;
}

const ownedApp = () => authApp(siteAnalytics, { userId: 'u', orgId: 'org1' });
const windowOf = async (query: string): Promise<number> => {
  const res = await ownedApp().request(`/api/sites/site1/analytics${query}`, {}, harnessEnv(db('org1'), true));
  expect(res.status).toBe(200);
  return ((await res.json()) as { windowDays: number }).windowDays;
};

describe('site_analytics handler — windowDays clamp', () => {
  it('defaults to 30 when no windowDays query is given', async () => {
    expect(await windowOf('')).toBe(30);
  });

  it('passes a valid in-range windowDays through', async () => {
    expect(await windowOf('?windowDays=90')).toBe(90);
    expect(await windowOf('?windowDays=365')).toBe(365);
  });

  it('clamps out-of-range / invalid windowDays back to 30', async () => {
    expect(await windowOf('?windowDays=0')).toBe(30); // not > 0
    expect(await windowOf('?windowDays=-5')).toBe(30); // negative
    expect(await windowOf('?windowDays=999')).toBe(30); // > 365
    expect(await windowOf('?windowDays=abc')).toBe(30); // NaN
    expect(await windowOf('?windowDays=10.5')).toBe(30); // non-integer
  });
});

describe('site_analytics handler — nonexistent site', () => {
  it('404s when the site does not exist (siteOrgId → null), not just when owned by another org', async () => {
    const res = await ownedApp().request('/api/sites/ghost/analytics', {}, harnessEnv(db(null), true));
    expect(res.status).toBe(404);
  });
});
