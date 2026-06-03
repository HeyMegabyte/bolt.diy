/**
 * Route coverage for the **conversational_editing** Hono routes (convergence r38).
 *
 * Exercises every handler end-to-end through the real {@link conversationalEdits}
 * sub-app + the shared {@link errorHandler}, mocking only the boundaries:
 * the feature-flag gate ({@link isFlagOn}), the multi-tenant ownership guard
 * ({@link assertSiteOwned}), the AI intent extractor, and the changeset service.
 *
 * Sibling `conversational_edits_ownership.test.ts` unit-tests the
 * `assertSiteOwned` helper in isolation; THIS spec covers the route handlers:
 * auth (401), flag gate (404, non-leak), Zod validation (400), cross-tenant
 * ownership (404, non-leak), and the success + error dispatch paths.
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));
jest.mock('../services/site_ownership.js', () => ({
  assertSiteOwned: jest.fn(),
}));
jest.mock('../services/edit_intent_extractor.js', () => ({
  extractEditIntent: jest.fn(),
}));
jest.mock('../services/changeset_service.js', () => ({
  createChangeset: jest.fn(),
  revertChangeset: jest.fn(),
  getHistory: jest.fn(),
  getChangesetDiff: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { conversationalEdits } from '../routes/conversational_edits.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assertSiteOwned } from '../services/site_ownership.js';
import { extractEditIntent } from '../services/edit_intent_extractor.js';
import {
  createChangeset,
  revertChangeset,
  getHistory,
  getChangesetDiff,
} from '../services/changeset_service.js';

const mockIsFlagOn = isFlagOn as unknown as jest.Mock;
const mockAssertSiteOwned = assertSiteOwned as unknown as jest.Mock;
const mockExtractEditIntent = extractEditIntent as unknown as jest.Mock;
const mockCreateChangeset = createChangeset as unknown as jest.Mock;
const mockRevertChangeset = revertChangeset as unknown as jest.Mock;
const mockGetHistory = getHistory as unknown as jest.Mock;
const mockGetChangesetDiff = getChangesetDiff as unknown as jest.Mock;

// ─── App harness ─────────────────────────────────────────────────────────────

function makeEnv(): Env {
  return { ENVIRONMENT: 'test', DB: {} as D1Database } as unknown as Env;
}

/**
 * Build the app mounted at `/api/conversational-edits` with a middleware that
 * seeds the auth context vars (`userId`, `orgId`). Passing no `userId`
 * simulates an unauthenticated request.
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
  app.route('/api/conversational-edits', conversationalEdits);
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
  body: unknown,
  env: Env,
) {
  return app.request(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
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

// ─── POST /:siteId/intent ──────────────────────────────────────────────────

describe('POST /api/conversational-edits/:siteId/intent', () => {
  it('returns 401 when unauthenticated (no flag/ownership/AI hit)', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'POST', '/api/conversational-edits/site-1/intent', { prompt: 'darker' }, env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockIsFlagOn).not.toHaveBeenCalled();
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
    expect(mockExtractEditIntent).not.toHaveBeenCalled();
  });

  it('returns 404 (NOT_FOUND, non-leak) when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/conversational-edits/site-1/intent', { prompt: 'darker' }, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
    expect(mockExtractEditIntent).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) when the site is not owned by the caller org', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/conversational-edits/site-X/intent', { prompt: 'darker' }, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    // Ownership checked with the caller's org + the path siteId.
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', 'site-X');
    expect(mockExtractEditIntent).not.toHaveBeenCalled();
  });

  it('returns 400 (BAD_REQUEST) when the body fails Zod (empty prompt)', async () => {
    allowGates();
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/conversational-edits/site-1/intent', { prompt: '' }, env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(mockExtractEditIntent).not.toHaveBeenCalled();
  });

  it('returns 200 with the extracted intent on success', async () => {
    allowGates();
    const intent = { rationale: 'darken hero bg', targetFiles: ['index.html'], operations: [], confidence: 0.9 };
    mockExtractEditIntent.mockResolvedValue(intent);
    const env = makeEnv();
    const res = await req(
      makeApp(AUTH),
      'POST',
      '/api/conversational-edits/site-1/intent',
      { prompt: 'make the hero darker', fileList: ['index.html'] },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { intent: typeof intent };
    expect(json.intent).toEqual(intent);
    expect(mockExtractEditIntent).toHaveBeenCalledWith(env, {
      prompt: 'make the hero darker',
      fileList: ['index.html'],
    });
  });

  it('returns 502 (AI_GENERATION_ERROR) when the extractor throws', async () => {
    allowGates();
    mockExtractEditIntent.mockRejectedValue(new Error('AI gateway 503'));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/conversational-edits/site-1/intent', { prompt: 'darker' }, env);
    expect(res.status).toBe(502);
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(json.error?.code).toBe('AI_GENERATION_ERROR');
    expect(json.error?.message).toBe('AI gateway 503');
  });
});

// ─── POST /:siteId/apply ─────────────────────────────────────────────────────

describe('POST /api/conversational-edits/:siteId/apply', () => {
  const validBody = {
    prompt: 'make the hero darker',
    files: [{ path: 'index.html', content: '<html></html>' }],
  };

  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'POST', '/api/conversational-edits/site-1/apply', validBody, env);
    expect(res.status).toBe(401);
    expect(mockCreateChangeset).not.toHaveBeenCalled();
  });

  it('returns 404 when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/conversational-edits/site-1/apply', validBody, env);
    expect(res.status).toBe(404);
    expect(mockCreateChangeset).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) on cross-tenant access', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/conversational-edits/site-Y/apply', validBody, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockCreateChangeset).not.toHaveBeenCalled();
  });

  it('returns 400 when the files array is empty (Zod)', async () => {
    allowGates();
    const env = makeEnv();
    const res = await req(
      makeApp(AUTH),
      'POST',
      '/api/conversational-edits/site-1/apply',
      { prompt: 'x', files: [] },
      env,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(mockCreateChangeset).not.toHaveBeenCalled();
  });

  it('returns 201 with the new changeset id on success', async () => {
    allowGates();
    mockCreateChangeset.mockResolvedValue('cs-123');
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/conversational-edits/site-1/apply', validBody, env);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; changesetId: string; status: string };
    expect(json).toMatchObject({ ok: true, changesetId: 'cs-123', status: 'applied' });
    // userId from auth context only; chatId defaults to null.
    expect(mockCreateChangeset).toHaveBeenCalledWith(env, {
      siteId: 'site-1',
      chatId: null,
      userId: 'user-1',
      prompt: validBody.prompt,
      files: validBody.files,
    });
  });
});

// ─── POST /:siteId/revert/:changesetId ───────────────────────────────────────

describe('POST /api/conversational-edits/:siteId/revert/:changesetId', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'POST', '/api/conversational-edits/site-1/revert/cs-1', {}, env);
    expect(res.status).toBe(401);
    expect(mockRevertChangeset).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) on cross-tenant access', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/conversational-edits/site-Z/revert/cs-1', {}, env);
    expect(res.status).toBe(404);
    expect(mockRevertChangeset).not.toHaveBeenCalled();
  });

  it('returns 400 when reason exceeds the Zod max length', async () => {
    allowGates();
    const env = makeEnv();
    const res = await req(
      makeApp(AUTH),
      'POST',
      '/api/conversational-edits/site-1/revert/cs-1',
      { reason: 'x'.repeat(2001) },
      env,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(mockRevertChangeset).not.toHaveBeenCalled();
  });

  it('returns 201 with the revert changeset id on success', async () => {
    allowGates();
    mockRevertChangeset.mockResolvedValue('cs-revert-9');
    const env = makeEnv();
    const res = await req(
      makeApp(AUTH),
      'POST',
      '/api/conversational-edits/site-1/revert/cs-1',
      { reason: 'undo the dark hero' },
      env,
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; revertChangesetId: string; status: string };
    expect(json).toMatchObject({ ok: true, revertChangesetId: 'cs-revert-9', status: 'reverted' });
    expect(mockRevertChangeset).toHaveBeenCalledWith(env, {
      siteId: 'site-1',
      changesetId: 'cs-1',
      userId: 'user-1',
      reason: 'undo the dark hero',
    });
  });

  it('maps a "Changeset not found" service error to 404', async () => {
    allowGates();
    mockRevertChangeset.mockRejectedValue(new Error('Changeset not found: cs-missing'));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/conversational-edits/site-1/revert/cs-missing', {}, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('maps a generic service error to 400 (BAD_REQUEST)', async () => {
    allowGates();
    mockRevertChangeset.mockRejectedValue(new Error('Cannot revert an already-reverted changeset'));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/conversational-edits/site-1/revert/cs-1', {}, env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
  });
});

// ─── GET /:siteId/history ────────────────────────────────────────────────────

describe('GET /api/conversational-edits/:siteId/history', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'GET', '/api/conversational-edits/site-1/history', undefined, env);
    expect(res.status).toBe(401);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it('returns 404 when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/conversational-edits/site-1/history', undefined, env);
    expect(res.status).toBe(404);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) on cross-tenant access', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/conversational-edits/site-Q/history', undefined, env);
    expect(res.status).toBe(404);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it('returns 200 with the ordered changesets + total on success', async () => {
    allowGates();
    const changesets = [
      { id: 'cs-2', siteId: 'site-1', status: 'applied' },
      { id: 'cs-1', siteId: 'site-1', status: 'reverted' },
    ];
    mockGetHistory.mockResolvedValue(changesets);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/conversational-edits/site-1/history', undefined, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { changesets: unknown[]; total: number };
    expect(json.changesets).toEqual(changesets);
    expect(json.total).toBe(2);
    expect(mockGetHistory).toHaveBeenCalledWith(env, 'site-1');
  });
});

// ─── GET /changesets/:changesetId/diff ───────────────────────────────────────

describe('GET /api/conversational-edits/changesets/:changesetId/diff', () => {
  const diff = { changeset: { siteId: 'site-1', id: 'cs-1' }, files: [] };

  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'GET', '/api/conversational-edits/changesets/cs-1/diff', undefined, env);
    expect(res.status).toBe(401);
    expect(mockGetChangesetDiff).not.toHaveBeenCalled();
  });

  it('returns 404 when the changeset does not exist (before flag/ownership)', async () => {
    mockGetChangesetDiff.mockResolvedValue(null);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/conversational-edits/changesets/missing/diff', undefined, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockIsFlagOn).not.toHaveBeenCalled();
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
  });

  it('returns 404 when the flag is off (diff exists)', async () => {
    mockGetChangesetDiff.mockResolvedValue(diff);
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/conversational-edits/changesets/cs-1/diff', undefined, env);
    expect(res.status).toBe(404);
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
  });

  it("returns 404 (non-leak) when the changeset's site is owned by another org", async () => {
    mockGetChangesetDiff.mockResolvedValue(diff);
    mockIsFlagOn.mockResolvedValue(true);
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/conversational-edits/changesets/cs-1/diff', undefined, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    // Ownership resolved from the changeset's siteId, not a path param.
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', 'site-1');
  });

  it('returns 200 with the diff on success', async () => {
    mockGetChangesetDiff.mockResolvedValue(diff);
    mockIsFlagOn.mockResolvedValue(true);
    mockAssertSiteOwned.mockResolvedValue(true);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/conversational-edits/changesets/cs-1/diff', undefined, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as typeof diff;
    expect(json).toEqual(diff);
    expect(mockGetChangesetDiff).toHaveBeenCalledWith(env, 'cs-1');
  });
});
