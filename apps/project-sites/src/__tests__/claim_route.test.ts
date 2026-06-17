import { Hono } from 'hono';
import { resolveLeadByShortlink, markClaimLinkClicked } from '../services/claim_links.js';
import { loadOrCreateSession, applyClaimEvent } from '../services/claim_session_store.js';
import { claimRoutes } from '../routes/claim';
import { createBuildSession } from '../services/claim_build_session';

/**
 * #1 claimyour.site — the GET /api/claim/:shortlink funnel route. Stitches the
 * proven cores (resolve → click → attribution → session START → redirect to the
 * prefilled /create). claim_links + the session store are mocked (no D1); the
 * pure reducer/attribution run for real.
 */
jest.mock('../services/claim_links.js', () => ({
  resolveLeadByShortlink: jest.fn(),
  markClaimLinkClicked: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/claim_session_store.js', () => ({
  loadOrCreateSession: jest.fn(),
  applyClaimEvent: jest.fn(),
}));

const mockResolve = resolveLeadByShortlink as jest.Mock;
const mockClicked = markClaimLinkClicked as jest.Mock;
const mockLoad = loadOrCreateSession as jest.Mock;
const mockApply = applyClaimEvent as jest.Mock;

function app() {
  const a = new Hono();
  a.route('/', claimRoutes);
  return a;
}
const get = (path: string) => app().request(path, {}, { DB: {} } as never);

beforeEach(() => {
  mockResolve.mockReset();
  mockClicked.mockReset().mockResolvedValue(undefined);
  mockLoad.mockReset();
  mockApply.mockReset().mockResolvedValue(undefined);
});

describe('GET /api/claim/:shortlink', () => {
  it('404s an unknown shortlink (no session, no redirect)', async () => {
    mockResolve.mockResolvedValue(null);
    const res = await get('/api/claim/nope');
    expect(res.status).toBe(404);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('a valid claim link records the click + 302-redirects to the prefilled /create', async () => {
    mockResolve.mockResolvedValue({ token: 'abc12345', leadId: 'lead_9' });
    mockLoad.mockResolvedValue(createBuildSession('claim_abc12345', 'lead_9')); // pending
    mockApply.mockResolvedValue({
      ...createBuildSession('claim_abc12345', 'lead_9'),
      status: 'building',
      attempts: 1,
    });
    const res = await get('/api/claim/abc12345');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/create?claim=abc12345');
    expect(mockClicked).toHaveBeenCalledWith(expect.anything(), 'abc12345');
  });

  it('starts the build on a fresh (pending) session', async () => {
    mockResolve.mockResolvedValue({ token: 'abc12345', leadId: 'lead_9' });
    mockLoad.mockResolvedValue(createBuildSession('claim_abc12345', 'lead_9')); // pending → canStartBuild
    mockApply.mockResolvedValue({ status: 'building' });
    await get('/api/claim/abc12345');
    expect(mockApply).toHaveBeenCalledWith(
      expect.anything(),
      'claim_abc12345',
      'lead_9',
      expect.objectContaining({ type: 'START_BUILD' }),
    );
  });

  it('a refresh on an already-building session does NOT start a second build (idempotent), still 302', async () => {
    mockResolve.mockResolvedValue({ token: 'abc12345', leadId: 'lead_9' });
    mockLoad.mockResolvedValue({
      ...createBuildSession('claim_abc12345', 'lead_9'),
      status: 'building',
      attempts: 1,
    });
    const res = await get('/api/claim/abc12345');
    expect(res.status).toBe(302);
    expect(mockApply).not.toHaveBeenCalled(); // canStartBuild=false → no dup build
  });
});
