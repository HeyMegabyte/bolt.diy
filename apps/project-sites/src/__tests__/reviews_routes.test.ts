/**
 * Route coverage for the **review_synthesis** Hono routes (convergence r39).
 *
 * Exercises every handler end-to-end through the real {@link reviewRoutes}
 * sub-app + the shared {@link errorHandler}, mocking only the boundaries:
 * the feature-flag gate ({@link isFlagOn}), the multi-tenant ownership guard
 * ({@link assertSiteOwned}), and the review-synthesis service.
 *
 * The convergence ledger flagged that this route was hardened with the shared
 * `assertSiteOwned` guard (404 non-leak on cross-tenant access) — so every
 * handler is covered for: auth (401), flag gate (404, non-leak), cross-tenant
 * ownership (404, non-leak), and the success + error/empty dispatch paths.
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));
jest.mock('../services/site_ownership.js', () => ({
  assertSiteOwned: jest.fn(),
}));
jest.mock('../services/review_synthesis.js', () => ({
  synthesizeReviews: jest.fn(),
  getLatestSynthesis: jest.fn(),
  buildReviewJsonLd: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { reviewRoutes } from '../routes/reviews.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assertSiteOwned } from '../services/site_ownership.js';
import {
  synthesizeReviews,
  getLatestSynthesis,
  buildReviewJsonLd,
} from '../services/review_synthesis.js';

const mockIsFlagOn = isFlagOn as unknown as jest.Mock;
const mockAssertSiteOwned = assertSiteOwned as unknown as jest.Mock;
const mockSynthesizeReviews = synthesizeReviews as unknown as jest.Mock;
const mockGetLatestSynthesis = getLatestSynthesis as unknown as jest.Mock;
const mockBuildReviewJsonLd = buildReviewJsonLd as unknown as jest.Mock;

// ─── App harness ─────────────────────────────────────────────────────────────

function makeEnv(): Env {
  return { ENVIRONMENT: 'test', DB: {} as D1Database } as unknown as Env;
}

/**
 * Build the app mounted at `/api/reviews` with a middleware that seeds the auth
 * context vars (`userId`, `orgId`). Passing no `userId` simulates an
 * unauthenticated request.
 */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/api/reviews', reviewRoutes);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function req(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  method: 'GET' | 'POST',
  path: string,
  env: Env,
) {
  return app.request(
    path,
    { method, headers: { 'Content-Type': 'application/json' } },
    env,
    makeCtx(),
  );
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

/** Flag ON + site owned — the precondition every "deeper" assertion needs. */
function allowGates() {
  mockIsFlagOn.mockResolvedValue(true);
  mockAssertSiteOwned.mockResolvedValue(true);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── POST /:siteId/synthesize ────────────────────────────────────────────────

describe('POST /api/reviews/:siteId/synthesize', () => {
  it('returns 401 when unauthenticated (no flag/ownership/service hit)', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'POST', '/api/reviews/site-1/synthesize', env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockIsFlagOn).not.toHaveBeenCalled();
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
    expect(mockSynthesizeReviews).not.toHaveBeenCalled();
  });

  it('returns 404 (NOT_FOUND, non-leak) when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/reviews/site-1/synthesize', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
    expect(mockSynthesizeReviews).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) when the site is not owned by the caller org', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/reviews/site-X/synthesize', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    // Ownership checked with the caller's org + the path siteId.
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', 'site-X');
    expect(mockSynthesizeReviews).not.toHaveBeenCalled();
  });

  it('returns 400 (BAD_REQUEST) when the synthesis service reports failure', async () => {
    allowGates();
    mockSynthesizeReviews.mockResolvedValue({ ok: false, error: 'No place_id for site' });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/reviews/site-1/synthesize', env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(json.error?.message).toBe('No place_id for site');
    expect(mockSynthesizeReviews).toHaveBeenCalledWith(env, 'site-1');
  });

  it('returns 400 with a default message when failure carries no error string', async () => {
    allowGates();
    mockSynthesizeReviews.mockResolvedValue({ ok: false });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/reviews/site-1/synthesize', env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toBe('Synthesis failed');
  });

  it('returns 200 with the synthesis + jsonld on success', async () => {
    allowGates();
    const synthesis = { id: 'rs-1', siteId: 'site-1', rating: 4.7, count: 132 };
    const jsonld = { '@type': 'AggregateRating', ratingValue: 4.7 };
    mockSynthesizeReviews.mockResolvedValue({ ok: true, synthesis, jsonld });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/reviews/site-1/synthesize', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; synthesis: unknown; jsonld: unknown };
    expect(json).toEqual({ ok: true, synthesis, jsonld });
  });

  it('returns 200 with jsonld null when the success result omits jsonld', async () => {
    allowGates();
    const synthesis = { id: 'rs-2', siteId: 'site-1', rating: 5, count: 1 };
    mockSynthesizeReviews.mockResolvedValue({ ok: true, synthesis });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/reviews/site-1/synthesize', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; synthesis: unknown; jsonld: unknown };
    expect(json).toEqual({ ok: true, synthesis, jsonld: null });
  });

  it('maps a thrown service error to 500 (INTERNAL_ERROR) via the handler', async () => {
    allowGates();
    mockSynthesizeReviews.mockRejectedValue(new Error('Places API 503'));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/reviews/site-1/synthesize', env);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('INTERNAL_ERROR');
  });
});

// ─── GET /:siteId ────────────────────────────────────────────────────────────

describe('GET /api/reviews/:siteId', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'GET', '/api/reviews/site-1', env);
    expect(res.status).toBe(401);
    expect(mockGetLatestSynthesis).not.toHaveBeenCalled();
  });

  it('returns 404 when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/reviews/site-1', env);
    expect(res.status).toBe(404);
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
    expect(mockGetLatestSynthesis).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) on cross-tenant access', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/reviews/site-Y', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', 'site-Y');
    expect(mockGetLatestSynthesis).not.toHaveBeenCalled();
  });

  it('returns 404 (No synthesis found) when none persisted yet', async () => {
    allowGates();
    mockGetLatestSynthesis.mockResolvedValue(null);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/reviews/site-1', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(json.error?.message).toBe('No synthesis found');
    expect(mockBuildReviewJsonLd).not.toHaveBeenCalled();
  });

  it('returns 200 with the synthesis + built jsonld on success', async () => {
    allowGates();
    const synthesis = { id: 'rs-1', siteId: 'site-1', rating: 4.5, count: 88 };
    const jsonld = { '@type': 'AggregateRating', ratingValue: 4.5 };
    mockGetLatestSynthesis.mockResolvedValue(synthesis);
    mockBuildReviewJsonLd.mockReturnValue(jsonld);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/reviews/site-1', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { synthesis: unknown; jsonld: unknown };
    expect(json).toEqual({ synthesis, jsonld });
    expect(mockGetLatestSynthesis).toHaveBeenCalledWith(env, 'site-1');
    expect(mockBuildReviewJsonLd).toHaveBeenCalledWith(synthesis);
  });
});

// ─── GET /:siteId/jsonld ─────────────────────────────────────────────────────

describe('GET /api/reviews/:siteId/jsonld', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'GET', '/api/reviews/site-1/jsonld', env);
    expect(res.status).toBe(401);
    expect(mockGetLatestSynthesis).not.toHaveBeenCalled();
  });

  it('returns 404 when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/reviews/site-1/jsonld', env);
    expect(res.status).toBe(404);
    expect(mockGetLatestSynthesis).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) on cross-tenant access', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/reviews/site-Z/jsonld', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', 'site-Z');
    expect(mockGetLatestSynthesis).not.toHaveBeenCalled();
  });

  it('returns 404 (No synthesis found) when none persisted yet', async () => {
    allowGates();
    mockGetLatestSynthesis.mockResolvedValue(null);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/reviews/site-1/jsonld', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toBe('No synthesis found');
    expect(mockBuildReviewJsonLd).not.toHaveBeenCalled();
  });

  it('returns 200 with only the jsonld block on success', async () => {
    allowGates();
    const synthesis = { id: 'rs-9', siteId: 'site-1', rating: 4.9, count: 240 };
    const jsonld = { '@type': 'AggregateRating', ratingValue: 4.9, reviewCount: 240 };
    mockGetLatestSynthesis.mockResolvedValue(synthesis);
    mockBuildReviewJsonLd.mockReturnValue(jsonld);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/reviews/site-1/jsonld', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { jsonld: unknown; synthesis?: unknown };
    expect(json).toEqual({ jsonld });
    // The jsonld-only route must NOT leak the full synthesis payload.
    expect(json.synthesis).toBeUndefined();
    expect(mockBuildReviewJsonLd).toHaveBeenCalledWith(synthesis);
  });
});
