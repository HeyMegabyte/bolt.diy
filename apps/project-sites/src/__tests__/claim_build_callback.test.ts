import { maybeCompleteClaimBuild } from '../services/claim_build_callback';

/**
 * #1 claim completion glue. The lookup + completion are INJECTED (the @swc/jest
 * module-mock of claim_session_store / claim_build_completion is unreliable in
 * this file — documented pattern). resolveSiteUrl runs the REAL dbQueryOne
 * against a D1-stub (so previewUrl is built from the stub's slug row).
 */
function makeDb(slug: string | null) {
  const stmt = {
    bind: () => stmt,
    all: async () => ({ results: slug ? [{ slug }] : [] }),
    run: async () => ({ meta: { changes: 0 } }),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}
const env = (slug: string | null = 'acme-abc123') => ({ DB: makeDb(slug) }) as never;

const claimSession = { sessionId: 'claim_x', leadId: 'lead_9', siteId: 'site_x' } as never;

describe('maybeCompleteClaimBuild', () => {
  it('is a no-op for a non-terminal status (does NOT even look up the session)', async () => {
    const getSession = jest.fn();
    const complete = jest.fn();
    const res = await maybeCompleteClaimBuild(env(), 'site_x', 'running', { getSession, complete });
    expect(res).toEqual({ handled: false });
    expect(getSession).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('is a no-op when the siteId has no claim session (a normal build)', async () => {
    const getSession = jest.fn<never, never[]>().mockResolvedValue(null);
    const complete = jest.fn();
    const res = await maybeCompleteClaimBuild(env(), 'site_normal', 'complete', {
      getSession,
      complete,
    });
    expect(res).toEqual({ handled: false });
    expect(complete).not.toHaveBeenCalled();
  });

  it('completes a claim build on "complete" — ok:true + the resolved previewUrl', async () => {
    const getSession = jest.fn<never, never[]>().mockResolvedValue(claimSession);
    const complete = jest
      .fn<never, never[]>()
      .mockResolvedValue({ status: 'completed', emailed: true });
    const res = await maybeCompleteClaimBuild(env('acme-abc123'), 'site_x', 'complete', {
      getSession,
      complete,
    });
    expect(res).toEqual({ handled: true, outcome: 'completed' });
    const [, result] = (complete as jest.Mock).mock.calls[0];
    expect(result).toEqual(
      expect.objectContaining({
        sessionId: 'claim_x',
        leadId: 'lead_9',
        ok: true,
        previewUrl: 'https://acme-abc123.projectsites.dev',
      }),
    );
  });

  it('marks a claim build failed on "error" — ok:false, no previewUrl', async () => {
    const getSession = jest.fn<never, never[]>().mockResolvedValue(claimSession);
    const complete = jest
      .fn<never, never[]>()
      .mockResolvedValue({ status: 'failed', emailed: false });
    const res = await maybeCompleteClaimBuild(env(null), 'site_x', 'error', {
      getSession,
      complete,
    });
    expect(res).toEqual({ handled: true, outcome: 'failed' });
    const [, result] = (complete as jest.Mock).mock.calls[0];
    expect(result.ok).toBe(false);
    expect(result.previewUrl).toBeUndefined();
  });

  it('treats "published" as a successful terminal status', async () => {
    const getSession = jest.fn<never, never[]>().mockResolvedValue(claimSession);
    const complete = jest
      .fn<never, never[]>()
      .mockResolvedValue({ status: 'completed', emailed: false });
    const res = await maybeCompleteClaimBuild(env('s'), 'site_x', 'published', {
      getSession,
      complete,
    });
    expect(res.outcome).toBe('completed');
    expect((complete as jest.Mock).mock.calls[0][1].ok).toBe(true);
  });
});
