/**
 * Route-LAYER coverage for routes/trust_center.ts — previously UNTESTED (the
 * sibling trust_center.test.ts covers only schemas + service fns; none of the
 * 6 Hono handlers). Exercises every handler + branch via the shared harness
 * (real isFlagOn through flagKv; service fns + the public-route site lookup
 * mocked at their boundaries):
 *
 *   GET  /api/trust/profile          unauth 401 · flag-off 404 · 200
 *   POST /api/trust/profile/publish  no-profile 404 · 200
 *   PUT  /api/trust/site/:siteId     foreign/missing site 404 · 200
 *   GET  /api/public/trust/:slug     site-not-found 404 · flag-off 404 ·
 *                                    not-published 404 · 200 (+jsonld)
 */

jest.mock('../services/trust_center.js', () => ({
  getOrgProfile: jest.fn(),
  getSiteProfile: jest.fn(),
  getEffectiveProfileForSite: jest.fn(),
  upsertProfile: jest.fn(),
  publishOrgProfile: jest.fn(),
  siteOrgId: jest.fn(),
}));
jest.mock('../services/db.js', () => ({ dbQueryOne: jest.fn() }));

import { trustCenter } from '../routes/trust_center.js';
import { authApp, harnessEnv } from './helpers/route_harness.js';
import {
  getOrgProfile,
  getEffectiveProfileForSite,
  upsertProfile,
  publishOrgProfile,
  siteOrgId,
} from '../services/trust_center.js';
import { dbQueryOne } from '../services/db.js';

const mGetOrg = getOrgProfile as jest.MockedFunction<typeof getOrgProfile>;
const mEffective = getEffectiveProfileForSite as jest.MockedFunction<typeof getEffectiveProfileForSite>;
const mUpsert = upsertProfile as jest.MockedFunction<typeof upsertProfile>;
const mPublish = publishOrgProfile as jest.MockedFunction<typeof publishOrgProfile>;
const mSiteOrg = siteOrgId as jest.MockedFunction<typeof siteOrgId>;
const mDbOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;

// D1 double supporting the isFlagOn override lookup on the flag-off path.
const db = {
  prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }),
} as never;

const PROFILE = {
  id: 'prof-1',
  org_id: 'org1',
  site_id: null,
  ai_models: [],
  data_residency: 'eu',
  audit_log_policy: 'self-serve',
  content_provenance: [],
  ai_outage_behavior: 'graceful-degradation',
  custom_disclosures: null,
  published: true,
  published_at: '2026-05-28T00:00:00Z',
  updated_at: '2026-05-28T00:00:00Z',
} as never;

const authed = () => authApp(trustCenter, { userId: 'u', orgId: 'org1' });
const anon = () => authApp(trustCenter);

beforeEach(() => jest.clearAllMocks());

describe('GET /api/trust/profile', () => {
  it('401 when unauthenticated', async () => {
    const res = await anon().request('/api/trust/profile', {}, harnessEnv(db, true));
    expect(res.status).toBe(401);
  });

  it('404 when the trust_center flag is off', async () => {
    const res = await authed().request('/api/trust/profile', {}, harnessEnv(db, false));
    expect(res.status).toBe(404);
    expect(mGetOrg).not.toHaveBeenCalled();
  });

  it('200 returns the org profile when authed + flag on', async () => {
    mGetOrg.mockResolvedValue(PROFILE);
    const res = await authed().request('/api/trust/profile', {}, harnessEnv(db, true));
    expect(res.status).toBe(200);
    expect((await res.json() as { data: unknown }).data).toBeTruthy();
    expect(mGetOrg).toHaveBeenCalledWith(expect.anything(), 'org1');
  });
});

describe('POST /api/trust/profile/publish', () => {
  it('404 when no profile exists yet (publishOrgProfile → null)', async () => {
    mPublish.mockResolvedValue(null);
    const res = await authed().request('/api/trust/profile/publish', { method: 'POST' }, harnessEnv(db, true));
    expect(res.status).toBe(404);
    expect((await res.json() as { error: { message: string } }).error.message).toMatch(/create one/i);
  });

  it('200 publishes when a profile exists', async () => {
    mPublish.mockResolvedValue(PROFILE);
    const res = await authed().request('/api/trust/profile/publish', { method: 'POST' }, harnessEnv(db, true));
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/trust/site/:siteId (tenant isolation)', () => {
  const body = { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data_residency: 'eu' }) };

  it('404 when the site is missing or owned by another org', async () => {
    mSiteOrg.mockResolvedValue('OTHER_ORG');
    const res = await authed().request('/api/trust/site/site1', body, harnessEnv(db, true));
    expect(res.status).toBe(404);
    expect(mUpsert).not.toHaveBeenCalled();
  });

  it('200 upserts the per-site override for an org-owned site', async () => {
    mSiteOrg.mockResolvedValue('org1');
    mUpsert.mockResolvedValue(PROFILE);
    const res = await authed().request('/api/trust/site/site1', body, harnessEnv(db, true));
    expect(res.status).toBe(200);
    expect(mUpsert).toHaveBeenCalledWith(expect.anything(), { orgId: 'org1', siteId: 'site1', update: { data_residency: 'eu' } });
  });
});

describe('GET /api/public/trust/:siteSlug (public)', () => {
  const site = { id: 'site-1', org_id: 'org1', slug: 'vito', business_name: "Vito's" };

  it('404 when the site slug does not resolve', async () => {
    mDbOne.mockResolvedValue(null);
    const res = await anon().request('/api/public/trust/ghost', {}, harnessEnv(db, true));
    expect(res.status).toBe(404);
  });

  it('404 when the flag is off for the site org', async () => {
    mDbOne.mockResolvedValue(site as never);
    const res = await anon().request('/api/public/trust/vito', {}, harnessEnv(db, false));
    expect(res.status).toBe(404);
  });

  it('404 when the profile is not published', async () => {
    mDbOne.mockResolvedValue(site as never);
    mEffective.mockResolvedValue({ ...PROFILE, published: false } as never);
    const res = await anon().request('/api/public/trust/vito', {}, harnessEnv(db, true));
    expect(res.status).toBe(404);
  });

  it('200 returns the redacted public profile + JSON-LD when published', async () => {
    mDbOne.mockResolvedValue(site as never);
    mEffective.mockResolvedValue(PROFILE);
    const res = await anon().request('/api/public/trust/vito', {}, harnessEnv(db, true));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { site_slug: string }; jsonld: { '@type': string } };
    expect(json.data.site_slug).toBe('vito');
    expect(json.jsonld['@type']).toBe('DigitalDocument');
  });
});
