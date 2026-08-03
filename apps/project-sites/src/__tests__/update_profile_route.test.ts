/**
 * Value-domain coverage (TDD Contract #10) for `PATCH /api/admin/profile` — the
 * display-name forward-sync that persists `users.display_name`.
 *
 * The frontend (`AdminUserSettingsComponent`) is LOCAL-FIRST and already fully
 * validates via `displayNameError()` before calling; this server Zod
 * (`updateProfileSchema`) is defense-in-depth and MUST mirror that rule EXACTLY
 * (1-80 chars, no markup / `javascript:` / inline-handler; unicode + emoji ok).
 * Asserts every value class + 401-when-unauthenticated + that the D1 UPDATE is
 * issued only on a valid, authenticated request.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../lib/posthog.js', () => ({
  capture: jest.fn(),
  trackAuth: jest.fn(),
  trackSite: jest.fn(),
  trackError: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
import { dbExecute } from '../services/db.js';

const mockExec = dbExecute as jest.Mock;

function authedApp(userId: string | null = 'usr_test') {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (userId) c.set('userId', userId);
    await next();
  });
  app.route('/', api);
  return app;
}

const env = { DB: {} } as unknown as Env;

async function patchProfile(app: ReturnType<typeof authedApp>, body: unknown): Promise<Response> {
  return app.request(
    '/api/admin/profile',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe('PATCH /api/admin/profile — display-name value domains (TDD #10)', () => {
  beforeEach(() => mockExec.mockClear());

  it('VALID: persists the trimmed name to users.display_name → 200', async () => {
    const res = await patchProfile(authedApp(), { name: 'Brian Zalewski' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { display_name: string } };
    expect(json.data.display_name).toBe('Brian Zalewski');
    expect(mockExec).toHaveBeenCalledTimes(1);
    const call = mockExec.mock.calls[0];
    expect(String(call[1])).toContain('UPDATE users SET display_name');
    expect(call[2]).toEqual(['Brian Zalewski', 'usr_test']);
  });

  it('trims surrounding whitespace before persisting', async () => {
    const res = await patchProfile(authedApp(), { name: '  Brian  ' });
    expect(res.status).toBe(200);
    expect(mockExec.mock.calls[0][2][0]).toBe('Brian');
  });

  it('UNAUTHENTICATED: 401, no DB write', async () => {
    const res = await patchProfile(authedApp(null), { name: 'Brian' });
    expect(res.status).toBe(401);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('EMPTY name: 400, no DB write', async () => {
    const res = await patchProfile(authedApp(), { name: '' });
    expect(res.status).toBe(400);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('WHITESPACE-only name: 400 (trims to empty)', async () => {
    const res = await patchProfile(authedApp(), { name: '   ' });
    expect(res.status).toBe(400);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('MISSING name field: 400', async () => {
    const res = await patchProfile(authedApp(), {});
    expect(res.status).toBe(400);
  });

  it('BOUNDARY: 80 chars ok (200), 81 rejected (400)', async () => {
    const ok = await patchProfile(authedApp(), { name: 'x'.repeat(80) });
    expect(ok.status).toBe(200);
    const bad = await patchProfile(authedApp(), { name: 'x'.repeat(81) });
    expect(bad.status).toBe(400);
  });

  it('OVERLONG (500 chars): 400', async () => {
    const res = await patchProfile(authedApp(), { name: 'y'.repeat(500) });
    expect(res.status).toBe(400);
  });

  it('MARKUP / script-like shapes: rejected 400', async () => {
    for (const name of [
      '<script>alert(1)</script>',
      'a javascript:alert(1)',
      'x onerror=alert(1)',
      'Bob <b>bold</b>',
    ]) {
      const res = await patchProfile(authedApp(), { name });
      expect(res.status).toBe(400);
    }
  });

  it('UNICODE + emoji (valid length): accepted 200', async () => {
    const res = await patchProfile(authedApp(), { name: '日本語 のなまえ 🎉' });
    expect(res.status).toBe(200);
  });

  it('SQL-injection-shaped free text (no markup): accepted 200 — bound param stores it literally', async () => {
    const res = await patchProfile(authedApp(), { name: 'Robert; DROP TABLE users' });
    expect(res.status).toBe(200);
    expect(mockExec.mock.calls[0][2][0]).toBe('Robert; DROP TABLE users');
  });
});
