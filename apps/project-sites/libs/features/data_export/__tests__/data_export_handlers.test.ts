/**
 * Route-LAYER tests for data_export handler (Hono app.request + harness).
 * Covers: 401 unauth, 404 flag-off, 200 CSV download (text/csv + header row).
 */

import { dataExport } from '../handlers.js';
import { authApp, harnessEnv } from '../../../../src/__tests__/helpers/route_harness.js';

/** D1 double: contacts export query → [] (header-only CSV); .first()→null (flag override). */
function db() {
  function prepare(_sql: string) {
    const api = {
      bind: () => api,
      first: async () => null,
      run: async () => ({ meta: { changes: 0 } }),
      all: async <T>(): Promise<{ results: T[] }> => ({ results: [] as unknown as T[] }),
    };
    return api;
  }
  return { prepare } as unknown as D1Database;
}

const URL = '/api/exports/contacts.csv';

describe('data_export handler (route layer)', () => {
  it('401 when unauthenticated', async () => {
    const app = authApp(dataExport);
    expect((await app.request(URL, {}, harnessEnv(db(), true))).status).toBe(401);
  });

  it('404 when the flag is off', async () => {
    const app = authApp(dataExport, { userId: 'u', orgId: 'org1' });
    expect((await app.request(URL, {}, harnessEnv(db(), false))).status).toBe(404);
  });

  it('200 returns a CSV download with the header row', async () => {
    const app = authApp(dataExport, { userId: 'u', orgId: 'org1' });
    const res = await app.request(URL, {}, harnessEnv(db(), true));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const text = await res.text();
    expect(text.split('\r\n')[0]).toBe(
      'email,name,phone,source,tags,consent_email,consent_sms,created_at,last_seen_at',
    );
  });
});
