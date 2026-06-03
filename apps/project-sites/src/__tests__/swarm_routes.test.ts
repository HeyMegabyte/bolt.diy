/**
 * Additive route coverage for `routes/swarm.ts` (convergence r37).
 *
 * The swarm editor + live-stream preview routes (#5 + #6) had ZERO test
 * coverage. This spec is the first — exercising every handler end-to-end
 * through the real Hono app + the shared {@link errorHandler}, mocking only
 * the boundaries (D1 flag lookup, `assertSiteOwned`, `ide_sandbox` services).
 *
 * Routes + branches covered:
 *   POST /api/swarm/:siteId/start
 *     - 401 unauthenticated (no userId)
 *     - 404 flag off (swarm_editor disabled / row absent)
 *     - 400 Zod (agents:[] empty, bad enum, prompt too long)
 *     - 404 foreign site (assertSiteOwned false — non-leak: code/message identical)
 *     - 201 success dispatch (startMultiAgentRun mocked)
 *
 *   GET /api/swarm/:siteId/stream
 *     - 401 unauthenticated
 *     - 404 flag off (swarm_editor / progressive_skeleton_build per mode)
 *     - 404 foreign site
 *     - 200 SSE swarm mode + 200 SSE progressive mode (correct headers)
 *
 *   GET /api/swarm/:siteId/runs
 *     - 401, 404 flag off (multi_agent_concurrent), 404 foreign, 200 list
 *
 *   GET /api/swarm/:siteId/run/:runId
 *     - 401, 404 flag off, 404 foreign, 200 detail
 *
 * Tenant is NEVER derived from a client header — orgId comes from the auth
 * context only; we assert the foreign-site 404 does not leak existence.
 * Boundaries mocked; never hits a real API. ts-jest global `jest`.
 */

jest.mock('../services/site_ownership.js', () => ({
  assertSiteOwned: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/ide_sandbox.js', () => ({
  SPECIALIST_PARTITION: {
    visual: { file_glob: '**/*.tsx', focus: 'visual', estimated_duration_ms: 1000 },
    copy: { file_glob: '**/*.md', focus: 'copy', estimated_duration_ms: 1000 },
    seo: { file_glob: '**/*.html', focus: 'seo', estimated_duration_ms: 1000 },
    a11y: { file_glob: '**/*.tsx', focus: 'a11y', estimated_duration_ms: 1000 },
    motion: { file_glob: '**/*.css', focus: 'motion', estimated_duration_ms: 1000 },
    media: { file_glob: '**/*.{png,jpg}', focus: 'media', estimated_duration_ms: 1000 },
    qa: { file_glob: '**/*', focus: 'qa', estimated_duration_ms: 1000 },
  },
  startMultiAgentRun: jest.fn(),
  listMultiAgentRuns: jest.fn(),
  getMultiAgentRunDetail: jest.fn(),
  buildSwarmSseStream: jest.fn(),
  buildProgressiveSseStream: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { swarm } from '../routes/swarm.js';
import { assertSiteOwned } from '../services/site_ownership.js';
import {
  startMultiAgentRun,
  listMultiAgentRuns,
  getMultiAgentRunDetail,
  buildSwarmSseStream,
  buildProgressiveSseStream,
} from '../services/ide_sandbox.js';

const mockAssertSiteOwned = assertSiteOwned as unknown as jest.Mock;
const mockStartRun = startMultiAgentRun as unknown as jest.Mock;
const mockListRuns = listMultiAgentRuns as unknown as jest.Mock;
const mockRunDetail = getMultiAgentRunDetail as unknown as jest.Mock;
const mockSwarmStream = buildSwarmSseStream as unknown as jest.Mock;
const mockProgressiveStream = buildProgressiveSseStream as unknown as jest.Mock;

// ─── Boundary mocks ──────────────────────────────────────────────────────────

/**
 * D1 mock whose `prepare().first()` returns a flag row. `flagEnabled`:
 *   - true  → `{ enabled: 1 }`
 *   - false → `{ enabled: 0 }`
 *   - null  → no row (`.first()` resolves null) — flag-absent path
 */
function makeDb(flagEnabled: boolean | null) {
  const first = jest.fn(async () => {
    if (flagEnabled === null) return null;
    return { enabled: flagEnabled ? 1 : 0 };
  });
  return {
    prepare: jest.fn(() => ({
      bind: jest.fn(function (this: unknown) {
        return this;
      }),
      first,
    })),
    _first: first,
  };
}

function makeEnv(flagEnabled: boolean | null = true): Env {
  return {
    ENVIRONMENT: 'test',
    DB: makeDb(flagEnabled),
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

/**
 * Build the app with a middleware that seeds the auth context vars the handler
 * reads (`userId`, `orgId`). No vars → unauthenticated. orgId is the ONLY
 * tenant source — never a client header.
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
  app.route('/', swarm);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function postStart(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  siteId: string,
  body: unknown,
  env: Env,
) {
  return app.request(
    `/api/swarm/${siteId}/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    makeCtx(),
  );
}

function get(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  env: Env,
) {
  return app.request(path, { method: 'GET' }, env, makeCtx());
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockAssertSiteOwned.mockResolvedValue(true);
  mockStartRun.mockResolvedValue({ run_id: 'run-1', status: 'queued' });
  mockListRuns.mockResolvedValue([{ run_id: 'run-1' }]);
  mockRunDetail.mockResolvedValue({ run_id: 'run-1', events: [] });
  mockSwarmStream.mockReturnValue(new ReadableStream());
  mockProgressiveStream.mockReturnValue(new ReadableStream());
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/swarm/:siteId/start
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/swarm/:siteId/start', () => {
  it('returns 401 when unauthenticated and never dispatches a run', async () => {
    const env = makeEnv(true);
    const res = await postStart(makeApp(), 'site-1', { prompt: 'go' }, env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockStartRun).not.toHaveBeenCalled();
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
  });

  it('returns 404 (not 403) when the swarm_editor flag is disabled', async () => {
    const env = makeEnv(false);
    const res = await postStart(makeApp(AUTH), 'site-1', { prompt: 'go' }, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it('returns 404 when the flag row is absent entirely', async () => {
    const env = makeEnv(null);
    const res = await postStart(makeApp(AUTH), 'site-1', { prompt: 'go' }, env);
    expect(res.status).toBe(404);
  });

  it('returns 400 when agents is an empty array (Zod min(1))', async () => {
    const env = makeEnv(true);
    const res = await postStart(makeApp(AUTH), 'site-1', { agents: [] }, env);
    // The route guards the body via `zValidator('json', ...)` middleware, which
    // short-circuits with its own 400 before the handler runs — so we assert the
    // status, not the errorHandler's `error.code` envelope.
    expect(res.status).toBe(400);
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it('returns 400 when an agent is not in the allowed enum', async () => {
    const env = makeEnv(true);
    const res = await postStart(makeApp(AUTH), 'site-1', { agents: ['hacker'] }, env);
    expect(res.status).toBe(400);
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it('returns 400 when the prompt exceeds the 4000-char Zod cap', async () => {
    const env = makeEnv(true);
    const res = await postStart(makeApp(AUTH), 'site-1', { prompt: 'x'.repeat(4001) }, env);
    expect(res.status).toBe(400);
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it('returns 404 for a foreign site without leaking existence', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv(true);
    const res = await postStart(makeApp(AUTH), 'foreign-site', { prompt: 'go' }, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    // Non-leak: identical envelope to a genuinely-missing site (the shared NOT_FOUND).
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(json.error?.message).toBe('Not found');
    // Ownership is checked against the AUTH context orgId, not any client input.
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', 'foreign-site');
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it('returns 201 and dispatches the run on a valid owned request', async () => {
    const env = makeEnv(true);
    const res = await postStart(
      makeApp(AUTH),
      'site-1',
      { prompt: 'Improve hero', agents: ['visual', 'copy'] },
      env,
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { run_id?: string };
    expect(json.run_id).toBe('run-1');
    expect(mockStartRun).toHaveBeenCalledTimes(1);
    expect(mockStartRun.mock.calls[0][1]).toMatchObject({
      siteId: 'site-1',
      agents: ['visual', 'copy'],
      prompt: 'Improve hero',
    });
  });

  it('defaults to all seven specialists + canned prompt when body is empty', async () => {
    const env = makeEnv(true);
    const res = await postStart(makeApp(AUTH), 'site-1', {}, env);
    expect(res.status).toBe(201);
    expect(mockStartRun).toHaveBeenCalledTimes(1);
    const arg = mockStartRun.mock.calls[0][1] as { agents: string[]; prompt: string };
    expect(arg.agents).toEqual(['visual', 'copy', 'seo', 'a11y', 'motion', 'media', 'qa']);
    expect(arg.prompt).toBe('Improve the site with all specialists in parallel');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/swarm/:siteId/stream
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/swarm/:siteId/stream', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv(true);
    const res = await get(makeApp(), '/api/swarm/site-1/stream', env);
    expect(res.status).toBe(401);
    expect(mockSwarmStream).not.toHaveBeenCalled();
  });

  it('returns 404 when the swarm_editor flag is off (default mode)', async () => {
    const env = makeEnv(false);
    const res = await get(makeApp(AUTH), '/api/swarm/site-1/stream', env);
    expect(res.status).toBe(404);
    expect(mockSwarmStream).not.toHaveBeenCalled();
  });

  it('returns 404 for a foreign site (non-leak)', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv(true);
    const res = await get(makeApp(AUTH), '/api/swarm/foreign/stream', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', 'foreign');
    expect(mockSwarmStream).not.toHaveBeenCalled();
  });

  it('returns 200 SSE for swarm mode with event-stream headers', async () => {
    const env = makeEnv(true);
    const res = await get(makeApp(AUTH), '/api/swarm/site-1/stream?run_id=run-1', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-store');
    expect(mockSwarmStream).toHaveBeenCalledWith(env, 'site-1', 'run-1');
    expect(mockProgressiveStream).not.toHaveBeenCalled();
  });

  it('returns 200 SSE for progressive mode using the progressive flag + stream', async () => {
    const env = makeEnv(true);
    const res = await get(makeApp(AUTH), '/api/swarm/site-1/stream?mode=progressive', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(mockProgressiveStream).toHaveBeenCalledWith(env, 'site-1');
    expect(mockSwarmStream).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/swarm/:siteId/runs
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/swarm/:siteId/runs', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv(true);
    const res = await get(makeApp(), '/api/swarm/site-1/runs', env);
    expect(res.status).toBe(401);
    expect(mockListRuns).not.toHaveBeenCalled();
  });

  it('returns 404 when the multi_agent_concurrent flag is off', async () => {
    const env = makeEnv(false);
    const res = await get(makeApp(AUTH), '/api/swarm/site-1/runs', env);
    expect(res.status).toBe(404);
    expect(mockListRuns).not.toHaveBeenCalled();
  });

  it('returns 404 for a foreign site (non-leak)', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv(true);
    const res = await get(makeApp(AUTH), '/api/swarm/foreign/runs', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', 'foreign');
    expect(mockListRuns).not.toHaveBeenCalled();
  });

  it('returns 200 with runs + specialist partition on success', async () => {
    const env = makeEnv(true);
    const res = await get(makeApp(AUTH), '/api/swarm/site-1/runs', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { runs?: unknown[]; specialists?: Record<string, unknown> };
    expect(json.runs).toEqual([{ run_id: 'run-1' }]);
    expect(json.specialists).toBeDefined();
    expect(mockListRuns).toHaveBeenCalledWith(env, 'site-1');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/swarm/:siteId/run/:runId
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/swarm/:siteId/run/:runId', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv(true);
    const res = await get(makeApp(), '/api/swarm/site-1/run/run-1', env);
    expect(res.status).toBe(401);
    expect(mockRunDetail).not.toHaveBeenCalled();
  });

  it('returns 404 when the multi_agent_concurrent flag is off', async () => {
    const env = makeEnv(false);
    const res = await get(makeApp(AUTH), '/api/swarm/site-1/run/run-1', env);
    expect(res.status).toBe(404);
    expect(mockRunDetail).not.toHaveBeenCalled();
  });

  it('returns 404 for a foreign site (non-leak)', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv(true);
    const res = await get(makeApp(AUTH), '/api/swarm/foreign/run/run-1', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', 'foreign');
    expect(mockRunDetail).not.toHaveBeenCalled();
  });

  it('returns 200 with run detail on success', async () => {
    const env = makeEnv(true);
    const res = await get(makeApp(AUTH), '/api/swarm/site-1/run/run-1', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { run_id?: string };
    expect(json.run_id).toBe('run-1');
    expect(mockRunDetail).toHaveBeenCalledWith(env, 'run-1');
  });
});
