/**
 * Unit tests for the shared feature-guard helpers (src/lib/feature_guard.ts).
 * Covers: envelope shape + request_id propagation for each error helper, and
 * requireOrgFlag's unauthenticated short-circuit (which returns before any flag
 * lookup, so no isFlagOn mock is needed).
 */

import {
  unauthorized,
  notFound,
  badRequest,
  requireOrgFlag,
  type AppCtx,
} from '../lib/feature_guard.js';

/** Minimal Hono context double: get() reads a bag, json() echoes (body,status). */
function ctx(vars: Record<string, unknown>): AppCtx {
  return {
    get: (k: string) => vars[k],
    env: {},
    json: (body: unknown, status?: number) => ({ body, status: status ?? 200 }),
  } as unknown as AppCtx;
}

describe('feature_guard envelopes', () => {
  it('unauthorized → 401 with code + request_id', () => {
    const r = unauthorized(ctx({ requestId: 'req-1' })) as unknown as { body: any; status: number };
    expect(r.status).toBe(401);
    expect(r.body.error).toMatchObject({ code: 'UNAUTHORIZED', request_id: 'req-1' });
  });

  it('notFound → 404', () => {
    const r = notFound(ctx({})) as unknown as { body: any; status: number };
    expect(r.status).toBe(404);
    expect(r.body.error).toMatchObject({ code: 'NOT_FOUND', request_id: null });
  });

  it('badRequest → 400 and includes details only when provided', () => {
    const withD = badRequest(ctx({ requestId: 'r' }), { field: 'x' }) as unknown as { body: any };
    expect(withD.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'x' } });
    const noD = badRequest(ctx({})) as unknown as { body: any };
    expect('details' in noD.body.error).toBe(false);
  });
});

describe('requireOrgFlag', () => {
  it('returns a 401 Response when unauthenticated (no flag lookup)', async () => {
    const r = await requireOrgFlag(ctx({ requestId: 'r' }), 'any_flag');
    // The double's json() returns a plain object, not a real Response, but the
    // helper returns whatever c.json yields — assert it's the 401 envelope.
    expect((r as unknown as { status: number }).status).toBe(401);
  });

  it('returns 401 when userId present but orgId missing', async () => {
    const r = await requireOrgFlag(ctx({ userId: 'u' }), 'any_flag');
    expect((r as unknown as { status: number }).status).toBe(401);
  });
});
