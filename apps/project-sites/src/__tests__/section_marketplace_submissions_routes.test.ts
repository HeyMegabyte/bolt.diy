/**
 * Route-LAYER coverage for routes/section_marketplace_submissions.ts — the
 * creator-submit + admin-curation routes (flag `section_marketplace`) had NO
 * test file at all. Exercises all 3 handlers + every branch via the shared
 * harness (real isFlagOn + real SectionSubmissionSchema; only the 3 service
 * write/read fns mocked at their boundary):
 *
 *   POST /api/marketplace/sections             401 · 404 · bad-JSON 400 ·
 *                                              validation 400 · 201 · 500
 *   GET  /api/marketplace/sections/pending     200 (+ limit NaN→100)
 *   POST /api/marketplace/sections/:id/review  bad decision 400 · 200 ·
 *                                              NOT_FOUND 404 · NOT_PENDING 409
 */

jest.mock('../services/section_marketplace_submissions.js', () => ({
  ...jest.requireActual('../services/section_marketplace_submissions.js'),
  submitSection: jest.fn(),
  reviewSubmission: jest.fn(),
  listPendingSubmissions: jest.fn(),
}));

import { sectionMarketplaceSubmissions } from '../routes/section_marketplace_submissions.js';
import { authApp, harnessEnv } from './helpers/route_harness.js';
import {
  submitSection,
  reviewSubmission,
  listPendingSubmissions,
} from '../services/section_marketplace_submissions.js';

const mSubmit = submitSection as jest.MockedFunction<typeof submitSection>;
const mReview = reviewSubmission as jest.MockedFunction<typeof reviewSubmission>;
const mPending = listPendingSubmissions as jest.MockedFunction<typeof listPendingSubmissions>;

const db = {
  prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }),
} as never;

const authed = () => authApp(sectionMarketplaceSubmissions, { userId: 'u', orgId: 'org1' });
const anon = () => authApp(sectionMarketplaceSubmissions);

const VALID = {
  industry: 'restaurant',
  name: 'Cinematic Hero',
  slot: 'hero',
  html_template: '<section data-hero>'.padEnd(25, 'x'),
  css_template: '',
  price_cents: 0,
};
const jsonReq = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

beforeEach(() => jest.clearAllMocks());

describe('POST /api/marketplace/sections (creator submit)', () => {
  it('401 when unauthenticated', async () => {
    const res = await anon().request('/api/marketplace/sections', jsonReq(VALID), harnessEnv(db, true));
    expect(res.status).toBe(401);
  });

  it('404 when the section_marketplace flag is off', async () => {
    const res = await authed().request('/api/marketplace/sections', jsonReq(VALID), harnessEnv(db, false));
    expect(res.status).toBe(404);
    expect(mSubmit).not.toHaveBeenCalled();
  });

  it('400 on invalid JSON', async () => {
    const res = await authed().request(
      '/api/marketplace/sections',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json' },
      harnessEnv(db, true),
    );
    expect(res.status).toBe(400);
  });

  it('400 on schema validation failure', async () => {
    const res = await authed().request('/api/marketplace/sections', jsonReq({ name: 'x' }), harnessEnv(db, true));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
    expect(mSubmit).not.toHaveBeenCalled();
  });

  it('201 on a valid submission', async () => {
    mSubmit.mockResolvedValue({ ok: true, id: 'sub-1', submission_status: 'pending' });
    const res = await authed().request('/api/marketplace/sections', jsonReq(VALID), harnessEnv(db, true));
    expect(res.status).toBe(201);
    expect(mSubmit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'Cinematic Hero' }), 'u');
  });

  it('500 when the service throws', async () => {
    mSubmit.mockRejectedValue(new Error('db down'));
    const res = await authed().request('/api/marketplace/sections', jsonReq(VALID), harnessEnv(db, true));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/marketplace/sections/pending (admin queue)', () => {
  it('200 returns the pending submissions + count', async () => {
    mPending.mockResolvedValue([{ id: 'sub-1' }] as never);
    const res = await authed().request('/api/marketplace/sections/pending', {}, harnessEnv(db, true));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { submissions: unknown[]; count: number };
    expect(json.count).toBe(1);
  });

  it('defaults the limit to 100 for a non-numeric ?limit', async () => {
    mPending.mockResolvedValue([] as never);
    await authed().request('/api/marketplace/sections/pending?limit=abc', {}, harnessEnv(db, true));
    expect(mPending).toHaveBeenCalledWith(expect.anything(), 100);
  });
});

describe('POST /api/marketplace/sections/:id/review (admin curate)', () => {
  it('400 on an invalid decision', async () => {
    const res = await authed().request('/api/marketplace/sections/sub-1/review', jsonReq({ decision: 'maybe' }), harnessEnv(db, true));
    expect(res.status).toBe(400);
    expect(mReview).not.toHaveBeenCalled();
  });

  it('200 on a valid approve', async () => {
    mReview.mockResolvedValue({ ok: true, id: 'sub-1', submission_status: 'approved' } as never);
    const res = await authed().request('/api/marketplace/sections/sub-1/review', jsonReq({ decision: 'approve', quality_score: 9 }), harnessEnv(db, true));
    expect(res.status).toBe(200);
    expect(mReview).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'sub-1', decision: 'approve', reviewer_user_id: 'u', quality_score: 9 }));
  });

  it('404 when the submission does not exist (SUBMISSION_NOT_FOUND)', async () => {
    mReview.mockRejectedValue(new Error('SUBMISSION_NOT_FOUND'));
    const res = await authed().request('/api/marketplace/sections/ghost/review', jsonReq({ decision: 'reject' }), harnessEnv(db, true));
    expect(res.status).toBe(404);
  });

  it('409 when the submission was already reviewed (SUBMISSION_NOT_PENDING)', async () => {
    mReview.mockRejectedValue(new Error('SUBMISSION_NOT_PENDING'));
    const res = await authed().request('/api/marketplace/sections/sub-1/review', jsonReq({ decision: 'approve' }), harnessEnv(db, true));
    expect(res.status).toBe(409);
  });
});
