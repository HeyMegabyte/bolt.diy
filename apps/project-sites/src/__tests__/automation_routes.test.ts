/**
 * Route coverage for the Automation Builder API (convergence r37).
 *
 * Exercises every handler end-to-end through the real Hono app + the shared
 * {@link errorHandler}, mocking only the boundaries: the `automation_builder`
 * service (D1-backed), the feature-flag gate, and the site-ownership check.
 *
 * Handlers covered (mounted at `/`):
 *   GET    /api/sites/:siteId/recipes
 *   POST   /api/sites/:siteId/recipes
 *   DELETE /api/sites/:siteId/recipes/:id
 *
 * For each: auth (401), flag gate (404 when off), ownership (404 on foreign /
 * missing), Zod (400 on bad body), and the service success + error paths.
 */

jest.mock('../services/automation_builder.js', () => ({
  createRecipe: jest.fn(),
  listRecipes: jest.fn(),
  deleteRecipe: jest.fn(),
}));
jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));
jest.mock('../services/site_ownership.js', () => ({
  assertSiteOwned: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { automation } from '../routes/automation.js';
import { createRecipe, listRecipes, deleteRecipe } from '../services/automation_builder.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assertSiteOwned } from '../services/site_ownership.js';

const mockCreateRecipe = createRecipe as unknown as jest.Mock;
const mockListRecipes = listRecipes as unknown as jest.Mock;
const mockDeleteRecipe = deleteRecipe as unknown as jest.Mock;
const mockIsFlagOn = isFlagOn as unknown as jest.Mock;
const mockAssertSiteOwned = assertSiteOwned as unknown as jest.Mock;

// ─── Harness ───────────────────────────────────────────────────────────────

function makeEnv(): Env {
  return { ENVIRONMENT: 'test', DB: {} as D1Database } as unknown as Env;
}

/**
 * Build the app with a middleware that seeds the auth context vars the gate
 * reads (`userId`, `orgId`). Passing no vars simulates an unauthenticated
 * request.
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
  app.route('/', automation);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };
const SITE = 'site-1';
const RECIPES_PATH = `/api/sites/${SITE}/recipes`;

const VALID_RECIPE = {
  name: 'On form submit, email me',
  enabled: true,
  trigger: { type: 'form.submitted' },
  actions: [{ type: 'send_email', config: { to: 'me@example.com' } }],
};

function req(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  method: string,
  env: Env,
  body?: unknown,
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

beforeEach(() => {
  jest.clearAllMocks();
  // Default happy-path gate: flag on + site owned.
  mockIsFlagOn.mockResolvedValue(true);
  mockAssertSiteOwned.mockResolvedValue(true);
});

// ─── Shared gate behavior (asserted on every handler) ────────────────────────

describe('Automation Builder API — gate', () => {
  it.each([
    ['GET', RECIPES_PATH, undefined],
    ['POST', RECIPES_PATH, VALID_RECIPE],
    ['DELETE', `${RECIPES_PATH}/rec-1`, undefined],
  ])('%s %s → 401 when unauthenticated', async (method, path, body) => {
    const env = makeEnv();
    const res = await req(makeApp(), path, method, env, body);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    // Short-circuits before touching the flag, ownership, or service.
    expect(mockIsFlagOn).not.toHaveBeenCalled();
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
    expect(mockListRecipes).not.toHaveBeenCalled();
    expect(mockCreateRecipe).not.toHaveBeenCalled();
    expect(mockDeleteRecipe).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', RECIPES_PATH, undefined],
    ['POST', RECIPES_PATH, VALID_RECIPE],
    ['DELETE', `${RECIPES_PATH}/rec-1`, undefined],
  ])('%s %s → 404 when the feature flag is off (never leak)', async (method, path, body) => {
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), path, method, env, body);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockIsFlagOn).toHaveBeenCalledWith(env, 'automation_builder', { siteId: SITE, orgId: 'org-1' });
    // Never reaches ownership or the service when the flag is off.
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
    expect(mockListRecipes).not.toHaveBeenCalled();
    expect(mockCreateRecipe).not.toHaveBeenCalled();
    expect(mockDeleteRecipe).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', RECIPES_PATH, undefined],
    ['POST', RECIPES_PATH, VALID_RECIPE],
    ['DELETE', `${RECIPES_PATH}/rec-1`, undefined],
  ])('%s %s → 404 when the site is not owned by the caller org', async (method, path, body) => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), path, method, env, body);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', SITE);
    expect(mockListRecipes).not.toHaveBeenCalled();
    expect(mockCreateRecipe).not.toHaveBeenCalled();
    expect(mockDeleteRecipe).not.toHaveBeenCalled();
  });
});

// ─── GET /api/sites/:siteId/recipes ──────────────────────────────────────────

describe('GET /api/sites/:siteId/recipes', () => {
  it('returns 200 with the org+site-scoped recipe list', async () => {
    const stored = [
      { id: 'rec-1', name: 'A', enabled: true, trigger: { type: 'form.submitted' }, actions: [{ type: 'notify' }] },
    ];
    mockListRecipes.mockResolvedValue(stored);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), RECIPES_PATH, 'GET', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; recipes: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.recipes).toEqual(stored);
    expect(mockListRecipes).toHaveBeenCalledWith(env, 'org-1', SITE);
  });

  it('returns 200 with an empty list when the site has no recipes', async () => {
    mockListRecipes.mockResolvedValue([]);
    const res = await req(makeApp(AUTH), RECIPES_PATH, 'GET', makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; recipes: unknown[] };
    expect(json.recipes).toEqual([]);
  });

  it('surfaces a thrown service error through the shared error handler (500)', async () => {
    mockListRecipes.mockRejectedValue(new Error('D1 unavailable'));
    const res = await req(makeApp(AUTH), RECIPES_PATH, 'GET', makeEnv());
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/sites/:siteId/recipes ─────────────────────────────────────────

describe('POST /api/sites/:siteId/recipes', () => {
  it('returns 201 with the new id on a valid recipe', async () => {
    mockCreateRecipe.mockResolvedValue({ ok: true, id: 'rec-new' });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), RECIPES_PATH, 'POST', env, VALID_RECIPE);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; id: string };
    expect(json).toEqual({ ok: true, id: 'rec-new' });
    expect(mockCreateRecipe).toHaveBeenCalledWith(
      env,
      'org-1',
      SITE,
      expect.objectContaining({ name: VALID_RECIPE.name, trigger: VALID_RECIPE.trigger }),
    );
  });

  it('returns 400 when the body fails route Zod validation (missing name)', async () => {
    const res = await req(makeApp(AUTH), RECIPES_PATH, 'POST', makeEnv(), {
      trigger: { type: 'form.submitted' },
      actions: [{ type: 'notify' }],
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    // Route-level Zod rejects before the service runs.
    expect(mockCreateRecipe).not.toHaveBeenCalled();
  });

  it('returns 400 when actions is empty (min(1))', async () => {
    const res = await req(makeApp(AUTH), RECIPES_PATH, 'POST', makeEnv(), {
      name: 'No actions',
      trigger: { type: 'form.submitted' },
      actions: [],
    });
    expect(res.status).toBe(400);
    expect(mockCreateRecipe).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const env = makeEnv();
    const res = await makeApp(AUTH).request(
      RECIPES_PATH,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' },
      env,
      makeCtx(),
    );
    expect(res.status).toBe(400);
    expect(mockCreateRecipe).not.toHaveBeenCalled();
  });

  it('returns 400 when the service rejects the recipe (allowlist failure)', async () => {
    mockCreateRecipe.mockResolvedValue({ ok: false, errors: ['unknown trigger type: bogus'] });
    const res = await req(makeApp(AUTH), RECIPES_PATH, 'POST', makeEnv(), VALID_RECIPE);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string; details?: unknown } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(json.error?.details).toEqual(['unknown trigger type: bogus']);
  });

  it('surfaces a thrown service error through the shared error handler (500)', async () => {
    mockCreateRecipe.mockRejectedValue(new Error('insert failed'));
    const res = await req(makeApp(AUTH), RECIPES_PATH, 'POST', makeEnv(), VALID_RECIPE);
    expect(res.status).toBe(500);
  });
});

// ─── DELETE /api/sites/:siteId/recipes/:id ────────────────────────────────────

describe('DELETE /api/sites/:siteId/recipes/:id', () => {
  it('returns 200 when a recipe is deleted', async () => {
    mockDeleteRecipe.mockResolvedValue({ ok: true });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), `${RECIPES_PATH}/rec-1`, 'DELETE', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(mockDeleteRecipe).toHaveBeenCalledWith(env, 'org-1', SITE, 'rec-1');
  });

  it('returns 404 when no matching recipe was found', async () => {
    mockDeleteRecipe.mockResolvedValue({ ok: false });
    const res = await req(makeApp(AUTH), `${RECIPES_PATH}/missing`, 'DELETE', makeEnv());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('surfaces a thrown service error through the shared error handler (500)', async () => {
    mockDeleteRecipe.mockRejectedValue(new Error('update failed'));
    const res = await req(makeApp(AUTH), `${RECIPES_PATH}/rec-1`, 'DELETE', makeEnv());
    expect(res.status).toBe(500);
  });
});
