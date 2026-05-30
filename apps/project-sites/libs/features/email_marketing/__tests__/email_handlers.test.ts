/**
 * Route-LAYER tests for email_marketing handlers (Hono app.request + harness).
 * Covers the shared-guard + campaign-ownership gate on /recipients (401/404/200/
 * cross-org-404) and the public unsubscribe route (400 on a bad token). The send
 * pipeline's logic is unit-covered in email_marketing.test.ts.
 */

import { emailMarketing } from '../handlers.js';
import { authApp, harnessEnv } from '../../../../src/__tests__/helpers/route_harness.js';

/** D1 double: campaign join (configurable owner) + zeroed recipient counts; .first()→null. */
function db(campaignOrg: string | null = 'org1') {
  function prepare(sql: string) {
    const api = {
      bind: () => api,
      first: async () => null,
      run: async () => ({ meta: { changes: 0 } }),
      all: async <T>(): Promise<{ results: T[] }> => {
        if (sql.includes('FROM newsletter_campaigns nc JOIN sites')) {
          return {
            results: (campaignOrg
              ? [
                  {
                    id: 'camp1',
                    site_id: 'site1',
                    org_id: campaignOrg,
                    subject: 'Hi',
                    body_html: '<p>Hi</p>',
                    status: 'draft',
                  },
                ]
              : []) as unknown as T[],
          };
        }
        if (sql.includes('COUNT(')) return { results: [{ n: 0 }] as unknown as T[] };
        return { results: [] }; // DISTINCT email selects + flag override
      },
    };
    return api;
  }
  return { prepare } as unknown as D1Database;
}

const RECIPIENTS = '/api/marketing/campaigns/camp1/recipients';

describe('email_marketing handlers (route layer)', () => {
  it('401 on recipients when unauthenticated', async () => {
    const app = authApp(emailMarketing);
    expect((await app.request(RECIPIENTS, {}, harnessEnv(db(), true))).status).toBe(401);
  });

  it('404 on recipients when the flag is off', async () => {
    const app = authApp(emailMarketing, { userId: 'u', orgId: 'org1' });
    expect((await app.request(RECIPIENTS, {}, harnessEnv(db(), false))).status).toBe(404);
  });

  it('200 recipients for an org-owned campaign', async () => {
    const app = authApp(emailMarketing, { userId: 'u', orgId: 'org1' });
    const res = await app.request(RECIPIENTS, {}, harnessEnv(db('org1'), true));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(0);
  });

  it('404 when the campaign belongs to another org', async () => {
    const app = authApp(emailMarketing, { userId: 'u', orgId: 'org1' });
    expect((await app.request(RECIPIENTS, {}, harnessEnv(db('OTHER_ORG'), true))).status).toBe(404);
  });

  it('public unsubscribe returns 400 on a bad/missing token (and never 404s away)', async () => {
    const app = authApp(emailMarketing); // public route, no auth
    const res = await app.request('/api/marketing/unsubscribe', {}, harnessEnv(db(), true));
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid');
  });
});
