import { Hono } from 'hono';

import { adminLeads } from '../routes/admin_leads';
import { isFlagOn } from '../modules/feature_flags/services.js';

/**
 * Super-Admin lead scanner route (#9) — the HTTP transport guards layered on the
 * pure lead-scanner cores (scanResultsToLeads / searchPlacesByQuery / createLead,
 * each unit-proven separately). These lock the route's own contract: auth-required
 * (401), flag-gated `lead_scanner` (404 not 403), Zod body (400), and the
 * search→score→store wiring on the happy path. The flag service + the Places
 * search + createLead are mocked so no KV/D1/network is touched; scanResultsToLeads
 * runs for real over the mocked search results.
 */
jest.mock('../modules/feature_flags/services.js', () => ({ isFlagOn: jest.fn() }));
jest.mock('../services/places_search.js', () => ({ searchPlacesByQuery: jest.fn() }));
jest.mock('../services/lead_store.js', () => ({ createLead: jest.fn() }));

const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockSearch = require('../services/places_search.js').searchPlacesByQuery as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockCreateLead = require('../services/lead_store.js').createLead as jest.Mock;

/** Mount the route behind a middleware that injects the authed-session vars. */
function makeApp(auth: { userId?: string; orgId?: string }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('requestId', 'req-test');
    if (auth.userId) c.set('userId', auth.userId);
    if (auth.orgId) c.set('orgId', auth.orgId);
    await next();
  });
  app.route('/', adminLeads);
  return app;
}

const env = { DB: {}, GOOGLE_PLACES_API_KEY: 'k' } as never;

function post(app: Hono, body: unknown) {
  return app.request(
    '/api/admin/leads/scan',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

function hit(over: Record<string, unknown> = {}) {
  return {
    place_id: 'p1',
    name: 'Joe Plumbing',
    formatted_address: '1 Main St',
    types: ['plumber'],
    rating: 4.5,
    reviewCount: 12,
    businessStatus: 'OPERATIONAL',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsFlagOn.mockResolvedValue(true);
  mockSearch.mockResolvedValue([]);
  mockCreateLead.mockResolvedValue({ leadId: 'lead_1' });
});

describe('POST /api/admin/leads/scan', () => {
  it('401s when unauthenticated', async () => {
    const res = await post(makeApp({}), { query: 'plumbers austin tx' });
    expect(res.status).toBe(401);
  });

  it('404s when the lead_scanner flag is off (existence not leaked)', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await post(makeApp({ userId: 'u1', orgId: 'o1' }), { query: 'plumbers austin tx' });
    expect(res.status).toBe(404);
  });

  it('400s on an invalid body (query too short)', async () => {
    const res = await post(makeApp({ userId: 'u1', orgId: 'o1' }), { query: 'x' });
    expect(res.status).toBe(400);
  });

  it('400s on a malformed JSON body', async () => {
    const app = makeApp({ userId: 'u1', orgId: 'o1' });
    const res = await app.request(
      '/api/admin/leads/scan',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json' },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('200s and creates leads for no-website results on the happy path', async () => {
    mockSearch.mockResolvedValue([
      hit({ place_id: 'p1' }),
      hit({ place_id: 'p2', name: 'Bob HVAC' }),
    ]);
    const res = await post(makeApp({ userId: 'u1', orgId: 'o1' }), { query: 'plumbers austin tx' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: { scanned: number; created: number } };
    expect(body.summary.scanned).toBe(2);
    expect(body.summary.created).toBe(2);
    expect(mockCreateLead).toHaveBeenCalledTimes(2);
    // The Places API key is forwarded to the search core.
    expect(mockSearch).toHaveBeenCalledWith('k', 'plumbers austin tx');
  });

  it('dedupes repeated place_id within one scan', async () => {
    mockSearch.mockResolvedValue([hit({ place_id: 'dup' }), hit({ place_id: 'dup' })]);
    const res = await post(makeApp({ userId: 'u1', orgId: 'o1' }), { query: 'roofers newark nj' });
    const body = (await res.json()) as { summary: { created: number; skippedDuplicate: number } };
    expect(body.summary.created).toBe(1);
    expect(body.summary.skippedDuplicate).toBe(1);
  });
});
