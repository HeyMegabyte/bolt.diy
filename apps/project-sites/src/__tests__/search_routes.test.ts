jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/advanced_features.js', () => ({
  newsletterSubscribe: jest
    .fn()
    .mockResolvedValue({ id: 'sub-1', confirm_email_sent: true, double_opt_in_required: true }),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { search, isProxyableImageUrl } from '../routes/search.js';
import { dbQuery, dbQueryOne, dbInsert } from '../services/db.js';
import { writeAuditLog } from '../services/audit.js';
import { newsletterSubscribe } from '../services/advanced_features.js';

const mockDbQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockDbQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockDbInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockNewsletterSubscribe = newsletterSubscribe as jest.MockedFunction<
  typeof newsletterSubscribe
>;

const mockQueueSend = jest.fn().mockResolvedValue(undefined);

const mockDb = {} as D1Database;

const mockSitesBucket = {
  get: jest.fn().mockResolvedValue(null),
  put: jest.fn().mockResolvedValue({}),
} as unknown as R2Bucket;

const mockEnv = {
  GOOGLE_PLACES_API_KEY: 'test-google-key',
  ENVIRONMENT: 'test',
  QUEUE: { send: mockQueueSend },
  DB: mockDb,
  SITES_BUCKET: mockSitesBucket,
} as unknown as Env;

// ─── App setup ──────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.route('/', search);

function makeRequest(path: string, options?: RequestInit) {
  return app.request(path, options, mockEnv);
}

function makeAuthenticatedApp(vars: Partial<Variables> = {}) {
  const authedApp = new Hono<{ Bindings: Env; Variables: Variables }>();
  authedApp.onError(errorHandler);
  authedApp.use('*', async (c, next) => {
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  authedApp.route('/', search);
  return authedApp;
}

// ─── Fetch interception (for Google Places only) ─────────────────────────────

const originalFetch = global.fetch;
let mockFetch: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch = jest.fn();
  global.fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ─── Google Places response helpers ─────────────────────────────────────────

function makePlacesResponse(
  places: Array<{
    id: string;
    name: string;
    address: string;
    types?: string[];
    lat?: number;
    lng?: number;
  }>,
) {
  return {
    places: places.map((p) => ({
      id: p.id,
      displayName: { text: p.name, languageCode: 'en' },
      formattedAddress: p.address,
      types: p.types ?? ['establishment'],
      ...(p.lat != null && p.lng != null
        ? { location: { latitude: p.lat, longitude: p.lng } }
        : {}),
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/search/businesses
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/search/businesses', () => {
  it('returns 400 when q parameter is missing', async () => {
    const res = await makeRequest('/api/search/businesses');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('Missing required query parameter: q');
  });

  it('returns 400 when q parameter is empty', async () => {
    const res = await makeRequest('/api/search/businesses?q=');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns business results from Google Places API', async () => {
    const placesPayload = makePlacesResponse([
      { id: 'place_1', name: 'Coffee House', address: '123 Main St' },
      { id: 'place_2', name: 'Tea Room', address: '456 Oak Ave', types: ['cafe', 'food'] },
      { id: 'place_3', name: 'Bakery', address: '789 Elm Blvd' },
    ]);

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(placesPayload), { status: 200 }));

    const res = await makeRequest('/api/search/businesses?q=coffee+shops');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(3);

    expect(body.data[0]).toEqual({
      place_id: 'place_1',
      name: 'Coffee House',
      address: '123 Main St',
      types: ['establishment'],
      lat: null,
      lng: null,
      phone: null,
      website: null,
    });
    expect(body.data[1]).toEqual({
      place_id: 'place_2',
      name: 'Tea Room',
      address: '456 Oak Ave',
      types: ['cafe', 'food'],
      lat: null,
      lng: null,
      phone: null,
      website: null,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toMatchObject({ 'X-Goog-Api-Key': 'test-google-key' });
    expect(JSON.parse(calledInit.body as string)).toEqual({ textQuery: 'coffee shops' });
  });

  it('returns max 10 results even if API returns more', async () => {
    const fifteenPlaces = Array.from({ length: 15 }, (_, i) => ({
      id: `place_${i}`,
      name: `Business ${i}`,
      address: `${i} Test St`,
    }));
    const placesPayload = makePlacesResponse(fifteenPlaces);

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(placesPayload), { status: 200 }));

    const res = await makeRequest('/api/search/businesses?q=lots+of+results');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(10);
    expect(body.data[0].place_id).toBe('place_0');
    expect(body.data[9].place_id).toBe('place_9');
  });

  it('returns empty array when Google API returns no places', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const res = await makeRequest('/api/search/businesses?q=nonexistent+place');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('handles Google API errors gracefully and returns empty results', async () => {
    mockFetch.mockResolvedValueOnce(new Response('API key invalid', { status: 403 }));

    const res = await makeRequest('/api/search/businesses?q=test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('carries a stable SEARCH_PROVIDER_UNAVAILABLE code on an upstream failure (not a silent empty)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('You must enable Billing on the Google Cloud Project', { status: 403 }),
    );
    const res = await makeRequest('/api/search/businesses?q=pizza');
    expect(res.status).toBe(200); // 5xx would fire the frontend's rethrowing error handler → console noise
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body._error.code).toBe('SEARCH_PROVIDER_UNAVAILABLE');
    expect(body._error.status).toBe(403);
  });

  it('short-circuits with SEARCH_PROVIDER_NOT_CONFIGURED when the Places key is unset (no fetch)', async () => {
    const noKeyApp = new Hono<{ Bindings: Env; Variables: Variables }>();
    noKeyApp.route('/', search);
    const noKeyEnv = { ...mockEnv, GOOGLE_PLACES_API_KEY: undefined } as unknown as Env;
    const res = await noKeyApp.request('/api/search/businesses?q=pizza', undefined, noKeyEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body._error.code).toBe('SEARCH_PROVIDER_NOT_CONFIGURED');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/search/address  (Autocomplete → Text-Search fallback)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/search/address', () => {
  it('carries SEARCH_PROVIDER_UNAVAILABLE when BOTH Autocomplete and the Text-Search fallback fail (not a silent empty)', async () => {
    // Autocomplete 403 → falls back to Text Search → also 403 → must surface _error
    // (the caller renders "address lookup unavailable" instead of a blank dropdown).
    mockFetch
      .mockResolvedValueOnce(new Response('autocomplete denied', { status: 403 }))
      .mockResolvedValueOnce(
        new Response('You must enable Billing on the Google Cloud Project', { status: 403 }),
      );
    const res = await makeRequest('/api/search/address?q=350+Fifth+Avenue+New+York');
    expect(res.status).toBe(200); // 5xx would trip the frontend's rethrowing error handler
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body._error.code).toBe('SEARCH_PROVIDER_UNAVAILABLE');
    expect(body._error.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(2); // autocomplete + fallback
  });

  it('stays honest-empty (NO _error) when both APIs return 200 with zero matches', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ suggestions: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ places: [] }), { status: 200 }));
    const res = await makeRequest('/api/search/address?q=zzqx+nowhere+place');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body._error).toBeUndefined();
  });

  it('returns Autocomplete suggestions without hitting the fallback when it succeeds', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          suggestions: [
            { placePrediction: { placeId: 'p1', text: { text: '350 5th Ave, New York, NY' } } },
          ],
        }),
        { status: 200 },
      ),
    );
    const res = await makeRequest('/api/search/address?q=350+Fifth');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].description).toBe('350 5th Ave, New York, NY');
    expect(body._error).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1); // fallback not needed
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sites/lookup
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/sites/lookup', () => {
  it('returns 400 when neither place_id nor slug is provided', async () => {
    const res = await makeRequest('/api/sites/lookup');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('Missing required query parameter: place_id or slug');
  });

  it('returns exists: false when no site is found by place_id', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);

    const res = await makeRequest('/api/sites/lookup?place_id=ChIJ_unknown');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ exists: false });
  });

  it('returns exists: true with site details when found by place_id', async () => {
    mockDbQueryOne.mockResolvedValueOnce({
      id: 'site-uuid-1',
      slug: 'joes-pizza',
      status: 'active',
      current_build_version: 'v3',
    });

    const res = await makeRequest('/api/sites/lookup?place_id=ChIJ_abc123');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      exists: true,
      site_id: 'site-uuid-1',
      slug: 'joes-pizza',
      status: 'active',
      has_build: true,
    });
  });

  it('returns exists: true when found by slug', async () => {
    mockDbQueryOne.mockResolvedValueOnce({
      id: 'site-uuid-2',
      slug: 'bobs-bakery',
      status: 'active',
      current_build_version: 'v1',
    });

    const res = await makeRequest('/api/sites/lookup?slug=bobs-bakery');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      exists: true,
      site_id: 'site-uuid-2',
      slug: 'bobs-bakery',
      status: 'active',
      has_build: true,
    });
  });

  it('correctly reports has_build: false when current_build_version is null', async () => {
    mockDbQueryOne.mockResolvedValueOnce({
      id: 'site-uuid-4',
      slug: 'pending-site',
      status: 'queued',
      current_build_version: null,
    });

    const res = await makeRequest('/api/sites/lookup?place_id=ChIJ_pending');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.has_build).toBe(false);
    expect(body.data.exists).toBe(true);
    expect(body.data.status).toBe('queued');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sites/create-from-search
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/sites/create-from-search', () => {
  it('returns 401 when not authenticated (no orgId)', async () => {
    const res = await makeRequest('/api/sites/create-from-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name: 'Test Biz' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 when business_name is missing', async () => {
    const authedApp = makeAuthenticatedApp({ orgId: 'org-123', userId: 'user-456' });

    const res = await authedApp.request(
      '/api/sites/create-from-search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain(
      'Missing required field: business_name (or business.name)',
    );
  });

  it('creates site, enqueues workflow, and returns 201', async () => {
    mockDbInsert.mockResolvedValueOnce({ error: null });

    const authedApp = makeAuthenticatedApp({
      orgId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      requestId: 'req-789',
    });

    const requestBody = {
      business_name: "Joe's Pizza Palace",
      business_address: '100 Broadway, New York',
      google_place_id: 'ChIJ_joes_pizza',
      additional_context: 'Italian restaurant, family owned',
    };

    const res = await authedApp.request(
      '/api/sites/create-from-search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
      mockEnv,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toHaveProperty('site_id');
    expect(body.data).toHaveProperty('slug');
    expect(body.data.status).toBe('building');
    expect(body.data.slug).toBe('joes-pizza-palace');

    // Verify workflow was queued
    expect(mockQueueSend).toHaveBeenCalledTimes(1);
    expect(mockQueueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        job_name: 'generate_site',
        site_id: body.data.site_id,
        business_name: "Joe's Pizza Palace",
        google_place_id: 'ChIJ_joes_pizza',
        additional_context: 'Italian restaurant, family owned',
      }),
    );

    // Verify DB insert was called
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockDbInsert).toHaveBeenCalledWith(
      mockDb,
      'sites',
      expect.objectContaining({
        business_name: "Joe's Pizza Palace",
        org_id: '00000000-0000-4000-8000-000000000001',
        status: 'building',
        google_place_id: 'ChIJ_joes_pizza',
        business_address: '100 Broadway, New York',
      }),
    );

    // Verify audit log was written
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it('creates site from nested v2 payload format (business object)', async () => {
    mockDbInsert.mockResolvedValueOnce({ error: null });

    const authedApp = makeAuthenticatedApp({
      orgId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      requestId: 'req-v2-001',
    });

    const requestBody = {
      mode: 'business',
      additional_context: 'We specialize in wood-fired pizza',
      business: {
        name: 'Napoli Pizza',
        address: '200 Market St, San Francisco',
        place_id: 'ChIJ_napoli',
        phone: '+1-415-555-0100',
        website: 'https://napolipizza.example.com',
        types: ['restaurant', 'food'],
      },
    };

    const res = await authedApp.request(
      '/api/sites/create-from-search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
      mockEnv,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toHaveProperty('site_id');
    expect(body.data.status).toBe('building');
    expect(body.data.slug).toBe('napoli-pizza');

    // Verify DB insert was called with fields extracted from nested business object
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockDbInsert).toHaveBeenCalledWith(
      mockDb,
      'sites',
      expect.objectContaining({
        business_name: 'Napoli Pizza',
        business_address: '200 Market St, San Francisco',
        google_place_id: 'ChIJ_napoli',
        business_phone: '+1-415-555-0100',
        org_id: '00000000-0000-4000-8000-000000000001',
        status: 'building',
      }),
    );

    // Verify workflow was queued with correct data
    expect(mockQueueSend).toHaveBeenCalledTimes(1);
    expect(mockQueueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        job_name: 'generate_site',
        business_name: 'Napoli Pizza',
        google_place_id: 'ChIJ_napoli',
        additional_context: 'We specialize in wood-fired pizza',
      }),
    );

    // Verify audit log includes mode
    expect(writeAuditLog).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        action: 'site.created_from_search',
        metadata_json: expect.objectContaining({
          business_name: 'Napoli Pizza',
          google_place_id: 'ChIJ_napoli',
          mode: 'business',
        }),
      }),
    );
  });

  it('returns 400 when nested business.name is also empty', async () => {
    const authedApp = makeAuthenticatedApp({ orgId: 'org-123', userId: 'user-456' });

    const res = await authedApp.request(
      '/api/sites/create-from-search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'business', business: { name: '' } }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('Missing required field');
  });
});

describe('isProxyableImageUrl (image-proxy SSRF guard)', () => {
  it('allows public http + https image hosts', () => {
    expect(isProxyableImageUrl('https://images.unsplash.com/photo-1.jpg')).toBe(true);
    expect(isProxyableImageUrl('http://legacy-cloned-site.com/logo.png')).toBe(true);
    expect(isProxyableImageUrl('https://172.15.0.1/x.jpg')).toBe(true); // just outside 172.16-31
  });

  it('rejects non-http(s) schemes', () => {
    expect(isProxyableImageUrl('file:///etc/passwd')).toBe(false);
    expect(isProxyableImageUrl('ftp://x/y')).toBe(false);
    expect(isProxyableImageUrl('not a url')).toBe(false);
  });

  it('rejects localhost / .local / .localhost', () => {
    expect(isProxyableImageUrl('http://localhost/x')).toBe(false);
    expect(isProxyableImageUrl('http://printer.local/x')).toBe(false);
    expect(isProxyableImageUrl('https://api.localhost/x')).toBe(false);
  });

  it('rejects private/reserved IPv4 + the cloud metadata endpoint', () => {
    for (const h of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '0.0.0.0',
      '100.64.0.1',
      '169.254.169.254',
    ]) {
      expect(isProxyableImageUrl(`http://${h}/x`)).toBe(false);
    }
  });

  it('rejects IPv6 loopback / link-local / ULA / IPv4-mapped', () => {
    expect(isProxyableImageUrl('http://[::1]/x')).toBe(false);
    expect(isProxyableImageUrl('http://[fe80::1]/x')).toBe(false);
    expect(isProxyableImageUrl('http://[fd00::1]/x')).toBe(false);
    expect(isProxyableImageUrl('http://[::ffff:169.254.169.254]/x')).toBe(false);
  });
});

// The dedicated native newsletter-subscriber ingest that feeds the
// `newsletter_subscribers` table + the /admin analytics "Newsletter" tile. Before
// this route existed, POST /api/newsletter/subscribe 404'd (the widget's endpoint
// was never mounted) and the tile had no live writer.
describe('POST /api/newsletter/subscribe', () => {
  const post = (body: unknown) =>
    makeRequest('/api/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('returns 400 on an invalid email', async () => {
    const res = await post({ email: 'not-an-email', siteId: 'e2e-site-1' });
    expect(res.status).toBe(400);
    expect(mockNewsletterSubscribe).not.toHaveBeenCalled();
  });

  it('returns 400 when siteId is missing', async () => {
    const res = await post({ email: 'sub@example.com' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the site does not exist', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);
    const res = await post({ email: 'sub@example.com', siteId: 'ghost-site' });
    expect(res.status).toBe(404);
    expect(mockNewsletterSubscribe).not.toHaveBeenCalled();
  });

  it('persists a subscriber and returns 200 with double_opt_in_required', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: 'e2e-site-1' } as never);
    mockNewsletterSubscribe.mockResolvedValueOnce({
      id: 'sub-1',
      siteId: 'e2e-site-1',
      email: 'sub@example.com',
      confirm_email_sent: true,
      double_opt_in_required: true,
      error: undefined,
    } as never);
    const res = await post({ email: 'sub@example.com', siteId: 'e2e-site-1' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { subscribed: boolean; double_opt_in_required: boolean };
    };
    expect(json.data).toMatchObject({ subscribed: true, double_opt_in_required: true });
    expect(mockNewsletterSubscribe).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ siteId: 'e2e-site-1', email: 'sub@example.com' }),
    );
  });

  it('returns 500 (not a lying-success) when the persist reports an error', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: 'e2e-site-1' } as never);
    mockNewsletterSubscribe.mockResolvedValueOnce({
      id: 'sub-1',
      siteId: 'e2e-site-1',
      email: 'sub@example.com',
      confirm_email_sent: true,
      double_opt_in_required: true,
      error: 'D1_ERROR: no such table',
    } as never);
    const res = await post({ email: 'sub@example.com', siteId: 'e2e-site-1' });
    expect(res.status).toBe(500);
  });
});
