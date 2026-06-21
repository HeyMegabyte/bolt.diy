import { describe, it, expect, beforeEach } from '@jest/globals';

// --- module mocks (must come before imports) ---
// NOTE: use the GLOBAL `jest` (do NOT import it from '@jest/globals') — the
// @swc/jest transform only hoists `jest.mock(...)` above the imports when it
// sees the global `jest` identifier. Importing `jest` leaves the mock call
// below the handler import, so the real feature_flags module loads first and
// the mock silently no-ops (isFlagOn runs for real → undefined.get).

jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../../../../src/types/env.js';
import { isFlagOn } from '../../../../src/modules/feature_flags/services.js';
import { figmaImport } from '../handlers.js';

const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;

// --- test app wiring ---

type AppContext = { Bindings: Env; Variables: Variables };

// `null` (not `undefined`) signals "no authenticated user": passing `undefined`
// to a defaulted param triggers the default ('user-123'), which silently
// authenticated the 401 test.
function buildApp(userId: string | null = 'user-123') {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    if (userId) c.set('userId' as keyof Variables, userId as Variables[keyof Variables]);
    await next();
  });
  app.route('/', figmaImport);
  return app;
}

const stubEnv = {} as Env;

// --- tests ---

describe('figma_import handlers', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns 404 when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);

    const app = buildApp();
    const res = await app.request(
      '/api/figma/import',
      {
        method: 'POST',
        body: JSON.stringify({ token: 'figd_abcdefghij', fileKey: 'XyZ123' }),
        headers: { 'Content-Type': 'application/json' },
      },
      stubEnv,
    );

    expect(res.status).toBe(404);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 401 when userId is missing', async () => {
    const app = buildApp(null);
    const res = await app.request(
      '/api/figma/import',
      {
        method: 'POST',
        body: JSON.stringify({ token: 'figd_abcdefghij', fileKey: 'XyZ123' }),
        headers: { 'Content-Type': 'application/json' },
      },
      stubEnv,
    );

    expect(res.status).toBe(401);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 when token is too short', async () => {
    mockIsFlagOn.mockResolvedValue(true);

    const app = buildApp();
    const res = await app.request(
      '/api/figma/import',
      {
        method: 'POST',
        body: JSON.stringify({ token: 'short', fileKey: 'XyZ123' }),
        headers: { 'Content-Type': 'application/json' },
      },
      stubEnv,
    );

    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when fileKey is too short', async () => {
    mockIsFlagOn.mockResolvedValue(true);

    const app = buildApp();
    const res = await app.request(
      '/api/figma/import',
      {
        method: 'POST',
        body: JSON.stringify({ token: 'figd_abcdefghij', fileKey: 'ab' }),
        headers: { 'Content-Type': 'application/json' },
      },
      stubEnv,
    );

    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with tokens and components on a valid request', async () => {
    mockIsFlagOn.mockResolvedValue(true);

    const app = buildApp();
    const res = await app.request(
      '/api/figma/import',
      {
        method: 'POST',
        body: JSON.stringify({ token: 'figd_abcdefghij', fileKey: 'XyZ123' }),
        headers: { 'Content-Type': 'application/json' },
      },
      stubEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; tokens: Record<string, string>; components: string[] };
    expect(json.ok).toBe(true);
    expect(json.tokens).toEqual({});
    expect(json.components).toEqual([]);
  });
});
