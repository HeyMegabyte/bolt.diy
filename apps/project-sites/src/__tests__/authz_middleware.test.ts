/**
 * Convergence §61/§67 — requireAuthz enforcement middleware.
 *
 * allowed → next (200); denied → 403 FORBIDDEN; unauthenticated → 401; all via
 * the shared taxonomy. Object id is derived per-request (BOLA prevention).
 */
import { Hono } from 'hono';
import { requireAuthz, getAuthorizationProvider } from '../middleware/authz.js';
import { FakeAuthorizationProvider, DenyAllAuthorizationProvider } from '../platform/authorization.js';
import type { Env, Variables } from '../types/env.js';

function app(provider: FakeAuthorizationProvider, withUser: string | null = 'user-1') {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use('*', async (c, next) => {
    if (withUser) c.set('userId', withUser);
    await next();
  });
  a.post(
    '/api/sites/:id/publish',
    requireAuthz('can_publish', (c) => `site:${c.req.param('id')}`, () => provider),
    (c) => c.json({ data: 'published' }),
  );
  return a;
}

describe('requireAuthz', () => {
  it('allows when the user holds the permission (200)', async () => {
    const p = new FakeAuthorizationProvider();
    await p.writeRelationship({ user: 'user-1', relation: 'owner', object: 'site:a' });
    const res = await app(p).request('/api/sites/a/publish', { method: 'POST' }, {} as Env);
    expect(res.status).toBe(200);
    expect((await res.json() as { data: string }).data).toBe('published');
  });

  it('denies a different site the user does not own (403 FORBIDDEN)', async () => {
    const p = new FakeAuthorizationProvider();
    await p.writeRelationship({ user: 'user-1', relation: 'owner', object: 'site:a' });
    const res = await app(p).request('/api/sites/b/publish', { method: 'POST' }, {} as Env);
    expect(res.status).toBe(403);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('denies an editor (no publish permission) on their own site', async () => {
    const p = new FakeAuthorizationProvider();
    await p.writeRelationship({ user: 'user-1', relation: 'editor', object: 'site:a' });
    expect((await app(p).request('/api/sites/a/publish', { method: 'POST' }, {} as Env)).status).toBe(403);
  });

  it('401 when unauthenticated', async () => {
    const res = await app(new FakeAuthorizationProvider(), null).request('/api/sites/a/publish', { method: 'POST' }, {} as Env);
    expect(res.status).toBe(401);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });
});

describe('getAuthorizationProvider', () => {
  it('defaults to DenyAll (fail-closed) until OpenFGA is configured', () => {
    expect(getAuthorizationProvider({} as Env)).toBeInstanceOf(DenyAllAuthorizationProvider);
  });
  it('uses an injected provider', () => {
    const p = new FakeAuthorizationProvider();
    expect(getAuthorizationProvider({} as Env, { provider: p })).toBe(p);
  });
});
