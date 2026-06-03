/**
 * Route coverage for the PUBLIC, token-gated Review/Approval Link endpoints
 * (`src/routes/review_public.ts`, convergence r39).
 *
 * The unguessable UUID in `/api/review/:id` IS the bearer credential — there is
 * NO session auth on these routes. Coverage exercises the handlers end-to-end
 * through a real Hono app, mocking only the two boundaries the route imports:
 * the `review_approval` service (the #4 state machine + D1) and `isFlagOn`
 * (the owning-org flag gate). The per-IP rate limiter runs for real against an
 * in-memory KV.
 *
 * Covers: valid token → review view, missing token → 404, flag-off → 404
 * (never leaks), each decision action (approve/reject/comment) success, the
 * double-decision guard (`already_decided`), the expired/used rejection,
 * Zod 400 (bad action / unknown key), malformed JSON, and the rate-limit 429.
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/review_approval.js', () => ({
  MAX_REVIEW_COMMENT_LEN: 2000,
  getReviewLink: jest.fn(),
  recordReviewDecision: jest.fn(),
  recordReviewComment: jest.fn(),
  // Pure helper the route calls directly — re-implement the real derivation so
  // the GET view reflects expiry without us mocking the clock everywhere.
  effectiveApprovalStatus: jest.fn(
    (link: { status: string; expiresAt: string | null }, nowIso: string) =>
      link.status === 'pending' && link.expiresAt !== null && link.expiresAt <= nowIso
        ? 'expired'
        : link.status,
  ),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { reviewPublic } from '../routes/review_public.js';
import {
  getReviewLink,
  recordReviewDecision,
  recordReviewComment,
} from '../services/review_approval.js';
import { isFlagOn } from '../modules/feature_flags/services.js';

const mockGetReviewLink = getReviewLink as unknown as jest.Mock;
const mockRecordDecision = recordReviewDecision as unknown as jest.Mock;
const mockRecordComment = recordReviewComment as unknown as jest.Mock;
const mockIsFlagOn = isFlagOn as unknown as jest.Mock;

// ─── Boundary mocks ──────────────────────────────────────────────────────────

/** In-memory KV mock driving the per-IP rate limiter. */
function makeKv(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    put: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    _store: store,
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    CACHE_KV: makeKv(),
    ...overrides,
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.route('/', reviewPublic);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function getReview(app: ReturnType<typeof makeApp>, id: string, env: Env) {
  return app.request(`/api/review/${id}`, { method: 'GET' }, env, makeCtx());
}

function postDecision(
  app: ReturnType<typeof makeApp>,
  id: string,
  body: unknown,
  env: Env,
  rawBody?: string,
) {
  return app.request(
    `/api/review/${id}/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    makeCtx(),
  );
}

const ROW = {
  id: 'rev-1',
  site_id: 'site-1',
  agency_org_id: 'org-1',
  decision: null as string | null,
  expires_at: '2099-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsFlagOn.mockResolvedValue(true);
});

// ─── GET /api/review/:id ─────────────────────────────────────────────────────

describe('GET /api/review/:id', () => {
  it('returns the review view for a valid pending token', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    const res = await getReview(makeApp(), 'rev-1', makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; review: Record<string, unknown> };
    expect(json.ok).toBe(true);
    expect(json.review).toMatchObject({
      id: 'rev-1',
      site_id: 'site-1',
      status: 'pending',
      expires_at: '2099-01-01T00:00:00.000Z',
    });
    expect(mockGetReviewLink).toHaveBeenCalledWith(expect.anything(), 'rev-1');
  });

  it('surfaces a terminal stored decision as the effective status', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW, decision: 'approved' });
    const res = await getReview(makeApp(), 'rev-1', makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { review: { status: string } };
    expect(json.review.status).toBe('approved');
  });

  it('reads a pending-but-past-expiry token as expired', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW, expires_at: '2000-01-01T00:00:00.000Z' });
    const res = await getReview(makeApp(), 'rev-1', makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { review: { status: string } };
    expect(json.review.status).toBe('expired');
  });

  it('returns 404 when the token does not exist', async () => {
    mockGetReviewLink.mockResolvedValue(null);
    const res = await getReview(makeApp(), 'missing', makeEnv());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('404s (never 403) when the owning org lacks the approval_workflow flag', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    mockIsFlagOn.mockResolvedValue(false);
    const res = await getReview(makeApp(), 'rev-1', makeEnv());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
    expect(mockIsFlagOn).toHaveBeenCalledWith(expect.anything(), 'approval_workflow', { orgId: 'org-1' });
  });
});

// ─── POST /api/review/:id/decision ───────────────────────────────────────────

describe('POST /api/review/:id/decision', () => {
  it('approves a pending link and returns the new status', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    mockRecordDecision.mockResolvedValue({ ok: true, status: 'approved' });
    const res = await postDecision(makeApp(), 'rev-1', { action: 'approve' }, makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; status: string };
    expect(json).toMatchObject({ ok: true, status: 'approved' });
    expect(mockRecordDecision).toHaveBeenCalledWith(
      expect.anything(),
      'rev-1',
      'approve',
      expect.any(String),
      undefined,
    );
  });

  it('rejects a pending link (carries an optional comment to the service)', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    mockRecordDecision.mockResolvedValue({ ok: true, status: 'rejected' });
    const res = await postDecision(
      makeApp(),
      'rev-1',
      { action: 'reject', comment: 'Needs a clearer hero CTA.' },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('rejected');
    expect(mockRecordDecision).toHaveBeenCalledWith(
      expect.anything(),
      'rev-1',
      'reject',
      expect.any(String),
      'Needs a clearer hero CTA.',
    );
  });

  it('records a comment WITHOUT transitioning state (action=comment)', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    mockRecordComment.mockResolvedValue({ ok: true });
    const res = await postDecision(
      makeApp(),
      'rev-1',
      { action: 'comment', comment: 'Looks great so far.' },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; commented: boolean };
    expect(json).toMatchObject({ ok: true, commented: true });
    expect(mockRecordComment).toHaveBeenCalledWith(
      expect.anything(),
      'rev-1',
      'Looks great so far.',
      expect.any(String),
    );
    expect(mockRecordDecision).not.toHaveBeenCalled();
  });

  it('400s on action=comment with no comment body', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    const res = await postDecision(makeApp(), 'rev-1', { action: 'comment' }, makeEnv());
    // Zod strips the comment requirement to the handler-level guard -> 400.
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('BAD_REQUEST');
    expect(mockRecordComment).not.toHaveBeenCalled();
  });

  it('guards a double-decision (service returns already_decided)', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW, decision: 'approved' });
    mockRecordDecision.mockResolvedValue({ ok: false, error: 'already_decided' });
    const res = await postDecision(makeApp(), 'rev-1', { action: 'reject' }, makeEnv());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('BAD_REQUEST');
    expect(json.error.message).toBe('already_decided');
  });

  it('rejects a decision on an expired/used link (service returns a guard error)', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    mockRecordDecision.mockResolvedValue({ ok: false, error: 'link is expired; only a pending link can be approved' });
    const res = await postDecision(makeApp(), 'rev-1', { action: 'approve' }, makeEnv());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toContain('expired');
  });

  it('returns 404 when the token does not exist', async () => {
    mockGetReviewLink.mockResolvedValue(null);
    const res = await postDecision(makeApp(), 'missing', { action: 'approve' }, makeEnv());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
    expect(mockRecordDecision).not.toHaveBeenCalled();
  });

  it('404s (never 403) when the owning org lacks the flag', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    mockIsFlagOn.mockResolvedValue(false);
    const res = await postDecision(makeApp(), 'rev-1', { action: 'approve' }, makeEnv());
    expect(res.status).toBe(404);
    expect(mockRecordDecision).not.toHaveBeenCalled();
  });

  it('400s on an unknown action value (Zod enum)', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    const res = await postDecision(makeApp(), 'rev-1', { action: 'nuke' }, makeEnv());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('BAD_REQUEST');
    expect(mockRecordDecision).not.toHaveBeenCalled();
  });

  it('400s on an unknown extra key (Zod .strict())', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    const res = await postDecision(makeApp(), 'rev-1', { action: 'approve', evil: true }, makeEnv());
    expect(res.status).toBe(400);
    expect(mockRecordDecision).not.toHaveBeenCalled();
  });

  it('400s on a malformed (non-JSON) body', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    const res = await postDecision(makeApp(), 'rev-1', undefined, makeEnv(), 'not-json{');
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('BAD_REQUEST');
    expect(mockRecordDecision).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-IP rate limit is already saturated', async () => {
    mockGetReviewLink.mockResolvedValue({ ...ROW });
    // Pre-seed the KV key the limiter checks (10/min, prefix rl:review-decision).
    const env = makeEnv({ CACHE_KV: makeKv({ 'rl:review-decision:9.9.9.9': '10' }) });
    const res = await makeApp().request(
      '/api/review/rev-1/decision',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '9.9.9.9' },
        body: JSON.stringify({ action: 'approve' }),
      },
      env,
      makeCtx(),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('RATE_LIMITED');
    // Rate-limited before the link is even loaded.
    expect(mockGetReviewLink).not.toHaveBeenCalled();
    expect(mockRecordDecision).not.toHaveBeenCalled();
  });
});
