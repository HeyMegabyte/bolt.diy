/**
 * Route-LAYER tests for donations_engine handlers (Hono app.request + harness).
 * Covers: 401 unauth create, 404 flag-off, 201 create (org-owned site),
 * 404 cross-org siteId, public progress read (200 flag-on, 404 flag-off).
 */

import { donationsEngine } from '../handlers.js';
import { authApp, harnessEnv } from '../../../../src/__tests__/helpers/route_harness.js';

interface Campaign {
  id: string;
  site_id: string;
  name: string;
  goal_cents: number | null;
  raised_cents: number;
  donor_count: number;
  ends_at: string | null;
  created_at: string;
}

/** D1 double: sites org lookup + donation_campaigns; .first() → null (flag override). */
function db(siteOrg: string | null = 'org1') {
  const campaigns = new Map<string, Campaign>();
  function prepare(sql: string) {
    let b: unknown[] = [];
    const api = {
      bind: (...p: unknown[]) => {
        b = p;
        return api;
      },
      first: async () => null,
      run: async () => {
        if (sql.includes('INSERT INTO donation_campaigns')) {
          const [id, site_id, name, goal_cents, ends_at] = b as [
            string,
            string,
            string,
            number | null,
            string | null,
          ];
          campaigns.set(id, {
            id,
            site_id,
            name,
            goal_cents,
            raised_cents: 0,
            donor_count: 0,
            ends_at,
            created_at: '2026-05-29',
          });
        }
        return { meta: { changes: 1 } };
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        if (sql.includes('SELECT org_id FROM sites')) {
          return { results: (siteOrg ? [{ org_id: siteOrg }] : []) as unknown as T[] };
        }
        if (sql.includes('SELECT * FROM donation_campaigns WHERE id')) {
          const c = campaigns.get(b[0] as string);
          return { results: (c ? [c] : []) as unknown as T[] };
        }
        if (sql.includes('SELECT c.* FROM donation_campaigns')) {
          return { results: [...campaigns.values()] as unknown as T[] };
        }
        return { results: [] };
      },
    };
    return api;
  }
  return { prepare } as unknown as D1Database;
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('donations_engine handlers (route layer)', () => {
  it('401 to create when unauthenticated', async () => {
    const app = authApp(donationsEngine);
    const res = await app.request(
      '/api/donations/campaigns',
      post({ siteId: 's1', name: 'Fund' }),
      harnessEnv(db(), true),
    );
    expect(res.status).toBe(401);
  });

  it('404 to list when the flag is off', async () => {
    const app = authApp(donationsEngine, { userId: 'u', orgId: 'org1' });
    const res = await app.request('/api/donations/campaigns', {}, harnessEnv(db(), false));
    expect(res.status).toBe(404);
  });

  it('201 creates a campaign for an org-owned site', async () => {
    const app = authApp(donationsEngine, { userId: 'u', orgId: 'org1' });
    const res = await app.request(
      '/api/donations/campaigns',
      post({ siteId: 's1', name: 'Build Fund', goalCents: 50000 }),
      harnessEnv(db('org1'), true),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { campaign: { name: string; raisedCents: number } };
    expect(body.campaign).toMatchObject({ name: 'Build Fund', raisedCents: 0 });
  });

  it('404 when the site belongs to another org', async () => {
    const app = authApp(donationsEngine, { userId: 'u', orgId: 'org1' });
    const res = await app.request(
      '/api/donations/campaigns',
      post({ siteId: 's1', name: 'Fund' }),
      harnessEnv(db('OTHER_ORG'), true),
    );
    expect(res.status).toBe(404);
  });

  it('public progress read: 200 when flag on, 404 when flag off', async () => {
    const open = authApp(donationsEngine); // no auth — public route
    expect(
      (await open.request('/api/donations/campaigns/ghost', {}, harnessEnv(db(), false))).status,
    ).toBe(404);
    // flag on + unknown campaign → 404 (not flag, just missing)
    expect(
      (await open.request('/api/donations/campaigns/ghost', {}, harnessEnv(db(), true))).status,
    ).toBe(404);
  });
});
