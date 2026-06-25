import {
  createBuildSession,
  reduceBuildSession,
  canStartBuild,
  BuildSessionSchema,
  type BuildSession,
} from '../services/claim_build_session';

/**
 * #1 claimyour.site — the idempotent build-session state machine (the endorsed
 * first slice). Pure reducer, no D1/network, so every transition + the
 * idempotency guarantees are unit-provable:
 *  - a claim-link click starts ONE build; a refresh / double-click never starts
 *    a second (the page-leave-survives + no-dup-on-refresh guarantee).
 *  - edits while building are stashed as pending rebuild context, never lost.
 *  - "Rebuild with my changes" only fires from a finished (completed/failed)
 *    session and folds the pending edits into the next build.
 */

const fresh = (): BuildSession => createBuildSession('sess_1', 'lead_1');

describe('createBuildSession', () => {
  it('starts pending with no preview / no pending rebuild, attempts 0', () => {
    const s = fresh();
    expect(s.status).toBe('pending');
    expect(s.previewUrl).toBeNull();
    expect(s.pendingRebuild).toBe(false);
    expect(s.attempts).toBe(0);
    expect(BuildSessionSchema.safeParse(s).success).toBe(true);
  });
});

describe('canStartBuild (idempotency guard the route uses on claim-link hit)', () => {
  it('is true only for pending / failed; false while building or completed', () => {
    expect(canStartBuild(fresh())).toBe(true);
    expect(canStartBuild({ ...fresh(), status: 'building' })).toBe(false);
    expect(canStartBuild({ ...fresh(), status: 'completed' })).toBe(false);
    expect(canStartBuild({ ...fresh(), status: 'failed' })).toBe(true); // retry allowed
  });
});

describe('reduceBuildSession — START_BUILD idempotency', () => {
  it('pending → building, attempts incremented', () => {
    const s = reduceBuildSession(fresh(), { type: 'START_BUILD', siteId: 'site_9' });
    expect(s.status).toBe('building');
    expect(s.attempts).toBe(1);
    expect(s.siteId).toBe('site_9');
  });

  it('a second START_BUILD while building is a NO-OP (no dup build on refresh)', () => {
    const building = reduceBuildSession(fresh(), { type: 'START_BUILD' });
    const again = reduceBuildSession(building, { type: 'START_BUILD' });
    expect(again.status).toBe('building');
    expect(again.attempts).toBe(1); // NOT 2 — the refresh did not restart
    expect(again).toEqual(building);
  });

  it('START_BUILD on a completed session is a NO-OP (rebuild goes via REQUEST_REBUILD)', () => {
    const done = reduceBuildSession(reduceBuildSession(fresh(), { type: 'START_BUILD' }), {
      type: 'BUILD_COMPLETED',
      previewUrl: 'https://x.projectsites.dev',
    });
    expect(reduceBuildSession(done, { type: 'START_BUILD' })).toEqual(done);
  });
});

describe('reduceBuildSession — completion / failure', () => {
  it('building → completed sets the preview url; clears pending context', () => {
    let s = reduceBuildSession(fresh(), { type: 'START_BUILD' });
    s = reduceBuildSession(s, { type: 'EDIT_RECEIVED', context: { tone: 'warm' } });
    s = reduceBuildSession(s, {
      type: 'BUILD_COMPLETED',
      previewUrl: 'https://p.projectsites.dev',
    });
    expect(s.status).toBe('completed');
    expect(s.previewUrl).toBe('https://p.projectsites.dev');
    expect(s.pendingContext).toBeNull(); // consumed by the completed build
  });

  it('building → failed records the error; a retry START_BUILD is then allowed', () => {
    let s = reduceBuildSession(fresh(), { type: 'START_BUILD' });
    s = reduceBuildSession(s, { type: 'BUILD_FAILED', error: 'render_timeout' });
    expect(s.status).toBe('failed');
    expect(s.error).toBe('render_timeout');
    expect(canStartBuild(s)).toBe(true);
    expect(reduceBuildSession(s, { type: 'START_BUILD' }).status).toBe('building');
  });

  it('a stray BUILD_COMPLETED on a pending session is ignored', () => {
    const s = fresh();
    expect(reduceBuildSession(s, { type: 'BUILD_COMPLETED', previewUrl: 'x' })).toEqual(s);
  });

  it('a replayed BUILD_COMPLETED on an already-completed session is a no-op (#28 callback idempotency)', () => {
    const built = reduceBuildSession(reduceBuildSession(fresh(), { type: 'START_BUILD' }), {
      type: 'BUILD_COMPLETED',
      previewUrl: 'https://x.test',
    });
    expect(built.status).toBe('completed');
    // A duplicate terminal build-status callback must NOT re-transition (→ no
    // second owner email). Guard: reducer ignores BUILD_COMPLETED unless building.
    expect(
      reduceBuildSession(built, { type: 'BUILD_COMPLETED', previewUrl: 'https://y.test' }),
    ).toEqual(built);
    // Same for a stray BUILD_FAILED after completion.
    expect(reduceBuildSession(built, { type: 'BUILD_FAILED', error: 'late' })).toEqual(built);
  });
});

describe('reduceBuildSession — edits + rebuild', () => {
  it('EDIT_RECEIVED while building stashes pending context, status stays building', () => {
    let s = reduceBuildSession(fresh(), { type: 'START_BUILD' });
    s = reduceBuildSession(s, { type: 'EDIT_RECEIVED', context: { businessName: 'Acme' } });
    expect(s.status).toBe('building');
    expect(s.pendingRebuild).toBe(true);
    expect(s.pendingContext).toEqual({ businessName: 'Acme' });
  });

  it('EDIT_RECEIVED merges successive edits (last write wins per key)', () => {
    let s = reduceBuildSession(fresh(), { type: 'START_BUILD' });
    s = reduceBuildSession(s, { type: 'EDIT_RECEIVED', context: { tone: 'warm', phone: '1' } });
    s = reduceBuildSession(s, { type: 'EDIT_RECEIVED', context: { phone: '2' } });
    expect(s.pendingContext).toEqual({ tone: 'warm', phone: '2' });
  });

  it('REQUEST_REBUILD from completed re-enters building with the pending context applied', () => {
    let s = reduceBuildSession(fresh(), { type: 'START_BUILD' });
    s = reduceBuildSession(s, { type: 'BUILD_COMPLETED', previewUrl: 'https://p' });
    s = reduceBuildSession(s, { type: 'EDIT_RECEIVED', context: { hours: '9-5' } });
    s = reduceBuildSession(s, { type: 'REQUEST_REBUILD' });
    expect(s.status).toBe('building');
    expect(s.attempts).toBe(2);
    expect(s.pendingRebuild).toBe(false); // consumed — now in progress
    expect(s.pendingContext).toEqual({ hours: '9-5' }); // builder reads it until completion
  });

  it('REQUEST_REBUILD while building is a NO-OP (edits already stashed for later)', () => {
    const building = reduceBuildSession(fresh(), { type: 'START_BUILD' });
    expect(reduceBuildSession(building, { type: 'REQUEST_REBUILD' })).toEqual(building);
  });
});
