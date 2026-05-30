/**
 * Unit tests for the reputation feature module (ideas #10, #11, #13).
 *
 * All external dependencies (D1, fetch, LLM, Places, Twilio) are mocked — no
 * real network or DB calls. Covers: review-request send (email + SMS), reply
 * draft generation, snapshot threshold logic, and the flag-off 404 path.
 */

import { Hono } from 'hono';

// ─── Mocks (must precede service/handler imports) ───────────────────────────

const mockDbQuery = jest.fn();
const mockDbQueryOne = jest.fn();
const mockDbInsert = jest.fn();
jest.mock('../../../../src/services/db.js', () => ({
  dbQuery: (...a: unknown[]) => mockDbQuery(...a),
  dbQueryOne: (...a: unknown[]) => mockDbQueryOne(...a),
  dbInsert: (...a: unknown[]) => mockDbInsert(...a),
}));

const mockLLM = jest.fn();
jest.mock('../../../../src/services/external_llm.js', () => ({
  callExternalLLM: (...a: unknown[]) => mockLLM(...a),
}));

const mockLookup = jest.fn();
jest.mock('../../../../src/services/google_places.js', () => ({
  lookupBusiness: (...a: unknown[]) => mockLookup(...a),
}));

const mockSendSms = jest.fn();
jest.mock('../../../../src/services/twilio.js', () => ({
  sendSms: (...a: unknown[]) => mockSendSms(...a),
}));

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

import { sendReviewRequest, draftReviewReply, getReputationSnapshot } from '../service.js';
import { reputation } from '../handlers.js';

const SITE = {
  id: 'site_1',
  org_id: 'org_1',
  business_name: "Vito's Mens Salon",
  google_place_id: 'place_abc',
};

const env = { DB: {}, RESEND_API_KEY: 'rk_test', GOOGLE_PLACES_API_KEY: 'gk_test' } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockDbInsert.mockResolvedValue({ error: null });
  mockDbQuery.mockResolvedValue({ data: [] });
  mockDbQueryOne.mockResolvedValue(SITE);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;
});

// ─── #10 — review-request engine ────────────────────────────────────────────

describe('sendReviewRequest (#10)', () => {
  test('emails an LLM-personalized ask with the Google link and logs status=sent', async () => {
    mockLLM.mockResolvedValue({ output: 'Thanks for visiting! https://search.google.com/local/writereview?placeid=place_abc', model_used: 'gpt-4o-mini', token_count: 40, cost_estimate: 0.0001 });

    const rec = await sendReviewRequest(env, { siteId: 'site_1', channel: 'email', recipient: 'a@b.com' });

    expect(rec.status).toBe('sent');
    expect(rec.channel).toBe('email');
    expect(rec.link).toContain('writereview?placeid=place_abc');
    expect(global.fetch).toHaveBeenCalledWith('https://api.resend.com/emails', expect.any(Object));
    expect(mockDbInsert).toHaveBeenCalledWith({}, 'review_requests', expect.objectContaining({ status: 'sent' }));
  });

  test('sends SMS from the active site number when channel=sms', async () => {
    mockLLM.mockResolvedValue({ output: 'Quick review? link', model_used: 'gpt-4o-mini', token_count: 10, cost_estimate: 0 });
    // first dbQueryOne = site, second = voice number
    mockDbQueryOne.mockResolvedValueOnce(SITE).mockResolvedValueOnce({ phone_number: '+18558225267' });
    mockSendSms.mockResolvedValue({ sid: 'SM1', status: 'queued', num_segments: 1, price: null });

    const rec = await sendReviewRequest(env, { siteId: 'site_1', channel: 'sms', recipient: '+19735551234', jobContext: 'Haircut' });

    expect(rec.status).toBe('sent');
    expect(mockSendSms).toHaveBeenCalledWith(env, expect.objectContaining({ from: '+18558225267', to: '+19735551234' }));
  });

  test('records status=failed when delivery throws (no SMS number)', async () => {
    mockLLM.mockResolvedValue({ output: 'msg link', model_used: 'm', token_count: 1, cost_estimate: 0 });
    mockDbQueryOne.mockResolvedValueOnce(SITE).mockResolvedValueOnce(null); // no active number

    const rec = await sendReviewRequest(env, { siteId: 'site_1', channel: 'sms', recipient: '+19735551234' });

    expect(rec.status).toBe('failed');
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockDbInsert).toHaveBeenCalledWith({}, 'review_requests', expect.objectContaining({ status: 'failed' }));
  });

  test('falls back to a templated ask when the LLM fails', async () => {
    mockLLM.mockRejectedValue(new Error('llm down'));
    const rec = await sendReviewRequest(env, { siteId: 'site_1', channel: 'email', recipient: 'a@b.com' });
    expect(rec.status).toBe('sent');
    expect(rec.message).toContain("Vito's Mens Salon");
    expect(rec.message).toContain('writereview?placeid=place_abc');
  });
});

// ─── #11 — review responder ─────────────────────────────────────────────────

describe('draftReviewReply (#11)', () => {
  test('returns an on-brand LLM draft with the model name', async () => {
    mockLLM.mockResolvedValue({ output: 'Thank you so much!', model_used: 'gpt-4o-mini', token_count: 12, cost_estimate: 0.0002 });
    const d = await draftReviewReply(env, { siteId: 'site_1', reviewText: 'Great cut!', rating: 5 });
    expect(d.draft).toBe('Thank you so much!');
    expect(d.aiModel).toBe('gpt-4o-mini');
    expect(d.tone).toBe('warm and professional');
  });

  test('falls back to a templated reply (null aiModel) when the LLM fails', async () => {
    mockLLM.mockRejectedValue(new Error('boom'));
    const d = await draftReviewReply(env, { siteId: 'site_1', reviewText: 'Slow service', rating: 2, tone: 'sincere' });
    expect(d.aiModel).toBeNull();
    expect(d.draft.length).toBeGreaterThan(0);
    expect(d.tone).toBe('sincere');
  });
});

// ─── #13 — reputation monitor ───────────────────────────────────────────────

describe('getReputationSnapshot (#13)', () => {
  test('flags needsAttention when total review count < 20', async () => {
    mockLookup.mockResolvedValue({ rating: 4.9, review_count: 8, reviews: [] });
    const snap = await getReputationSnapshot(env, 'site_1');
    expect(snap.totalReviews).toBe(8);
    expect(snap.averageRating).toBe(4.9);
    expect(snap.needsAttention).toBe(true); // count < 20
  });

  test('flags needsAttention when weighted average < 4.5', async () => {
    mockLookup.mockResolvedValue({ rating: 4.2, review_count: 50, reviews: [] });
    const snap = await getReputationSnapshot(env, 'site_1');
    expect(snap.averageRating).toBe(4.2);
    expect(snap.needsAttention).toBe(true); // avg < 4.5
  });

  test('healthy when avg >= 4.5 AND count >= 20, blending cached platforms', async () => {
    mockLookup.mockResolvedValue({ rating: 4.8, review_count: 40, reviews: [{ text: 'A+', author: 'Sam', rating: 5, time: '1 week ago' }] });
    mockDbQuery
      .mockResolvedValueOnce({ data: [{ platform: 'yelp', rating: 4.6, review_count: 30 }] }) // reputation_platforms
      .mockResolvedValueOnce({ data: [] }); // reputation_reviews_cache
    const snap = await getReputationSnapshot(env, 'site_1');
    expect(snap.totalReviews).toBe(70);
    expect(snap.platforms).toHaveLength(2);
    expect(snap.needsAttention).toBe(false);
    expect(snap.recent[0]?.platform).toBe('google');
  });
});

// ─── flag-off 404 path (handlers) ───────────────────────────────────────────

describe('handlers flag gating', () => {
  const app = new Hono();
  // inject userId so the auth gate passes; flag gate is the unit under test
  app.use('*', async (c, next) => { c.set('userId', 'u1'); await next(); });
  app.route('/', reputation);

  test('GET monitor → 404 when reputation_monitor flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await app.request('/api/sites/site_1/reputation/monitor');
    expect(res.status).toBe(404);
  });

  test('POST review-request → 404 when review_requests flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await app.request('/api/sites/site_1/reputation/review-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'email', recipient: 'a@b.com' }),
    });
    expect(res.status).toBe(404);
  });

  test('GET monitor → 200 snapshot when flag is on', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockLookup.mockResolvedValue({ rating: 4.9, review_count: 100, reviews: [] });
    const res = await app.request('/api/sites/site_1/reputation/monitor', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { snapshot: { needsAttention: boolean } };
    expect(body.snapshot.needsAttention).toBe(false);
  });
});
