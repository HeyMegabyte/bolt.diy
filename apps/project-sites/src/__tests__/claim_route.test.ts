import { Hono } from 'hono';
import { resolveLeadByShortlink, markClaimLinkClicked } from '../services/claim_links.js';
import {
  loadOrCreateSession,
  applyClaimEvent,
  getSession,
} from '../services/claim_session_store.js';
import { getLead } from '../services/lead_store.js';
import { claimRoutes, PLATFORM_CLAIMS_ORG_ID } from '../routes/claim';
import { createBuildSession } from '../services/claim_build_session';

/**
 * #1 claimyour.site — the GET /api/claim/:shortlink funnel route. Stitches the
 * proven cores (resolve → click → session START → provision a platform-org site
 * → kick the workflow → redirect to the prefilled /create). claim_links + the
 * session store + lead_store are mocked; createSite runs FOR REAL against a
 * D1-stub (the @swc/jest module-mock of site_create doesn't intercept in this
 * file — see _LOOP_LEDGER fire-v2.51 — so we control its input via the stub).
 */
jest.mock('../services/claim_links.js', () => ({
  resolveLeadByShortlink: jest.fn(),
  markClaimLinkClicked: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/claim_session_store.js', () => ({
  loadOrCreateSession: jest.fn(),
  applyClaimEvent: jest.fn(),
  getSession: jest.fn(),
}));
jest.mock('../services/lead_store.js', () => ({ getLead: jest.fn() }));

const mockResolve = resolveLeadByShortlink as jest.Mock;
const mockClicked = markClaimLinkClicked as jest.Mock;
const mockLoad = loadOrCreateSession as jest.Mock;
const mockApply = applyClaimEvent as jest.Mock;
const mockGetSession = getSession as jest.Mock;
const mockGetLead = getLead as jest.Mock;

/** D1 stub — createSite's dbInsert + writeAuditLog run against it. `insertFails`
 *  makes `.run()` throw so dbInsert surfaces an error → createSite throws. */
function makeDb(opts: { insertFails?: boolean } = {}) {
  const stmt = {
    bind: () => stmt,
    run: async () => {
      if (opts.insertFails) throw new Error('insert failed');
      return { meta: { changes: 1 } };
    },
    all: async () => ({ results: [] }),
    first: async () => null,
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

function app() {
  const a = new Hono();
  a.route('/', claimRoutes);
  return a;
}
const get = (path: string, db: D1Database = makeDb()) =>
  app().request(path, {}, { DB: db } as never);

beforeEach(() => {
  mockResolve.mockReset();
  mockClicked.mockReset().mockResolvedValue(undefined);
  mockLoad.mockReset();
  mockApply.mockReset().mockResolvedValue(undefined);
  mockGetSession.mockReset().mockResolvedValue(null);
  mockGetLead.mockReset().mockResolvedValue(null);
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

  it('provisions a platform-org site + STARTs the build with its siteId on a fresh session', async () => {
    mockResolve.mockResolvedValue({ token: 'abc12345', leadId: 'lead_9' });
    mockLoad.mockResolvedValue(createBuildSession('claim_abc12345', 'lead_9')); // pending → canStartBuild
    mockGetLead.mockResolvedValue({
      leadId: 'lead_9',
      profile: { businessName: 'Acme Roofing', phone: '555', address: '1 Main St' },
    });

    await get('/api/claim/abc12345');

    // createSite ran for real (D1-stub) → START_BUILD records the new siteId (a
    // uuid) — the link the build-status callback later resolves to complete it.
    expect(mockApply).toHaveBeenCalledTimes(1);
    const [, sessionId, leadId, event] = mockApply.mock.calls[0];
    expect(sessionId).toBe('claim_abc12345');
    expect(leadId).toBe('lead_9');
    expect(event.type).toBe('START_BUILD');
    expect(typeof event.siteId).toBe('string');
    expect(event.siteId.length).toBeGreaterThan(0);
  });

  it('does NOT start the build when the lead is gone (still 302)', async () => {
    mockResolve.mockResolvedValue({ token: 'abc12345', leadId: 'lead_9' });
    mockLoad.mockResolvedValue(createBuildSession('claim_abc12345', 'lead_9')); // pending
    mockGetLead.mockResolvedValue(null); // lead deleted
    const res = await get('/api/claim/abc12345');
    expect(res.status).toBe(302);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('leaves the session pending (no START) when site creation fails — re-click retries', async () => {
    mockResolve.mockResolvedValue({ token: 'abc12345', leadId: 'lead_9' });
    mockLoad.mockResolvedValue(createBuildSession('claim_abc12345', 'lead_9'));
    mockGetLead.mockResolvedValue({ leadId: 'lead_9', profile: { businessName: 'Acme' } });
    // D1 insert fails → createSite throws → caught → no START.
    const res = await get('/api/claim/abc12345', makeDb({ insertFails: true }));
    expect(res.status).toBe(302);
    expect(mockApply).not.toHaveBeenCalled();
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

describe('GET /api/claim/:shortlink/profile', () => {
  it('404s an unknown shortlink', async () => {
    mockResolve.mockResolvedValue(null);
    const res = await get('/api/claim/nope/profile');
    expect(res.status).toBe(404);
    expect(mockGetLead).not.toHaveBeenCalled();
  });

  it('404s when the lead is gone', async () => {
    mockResolve.mockResolvedValue({ token: 'abc12345', leadId: 'lead_9' });
    mockGetLead.mockResolvedValue(null);
    const res = await get('/api/claim/abc12345/profile');
    expect(res.status).toBe(404);
  });

  it('returns the flat /create prefill + session id + build status', async () => {
    mockResolve.mockResolvedValue({ token: 'abc12345', leadId: 'lead_9' });
    mockGetLead.mockResolvedValue({
      leadId: 'lead_9',
      profile: { businessName: 'Acme Roofing', phone: '555', services: ['roofing'] },
    });
    mockGetSession.mockResolvedValue({ status: 'building', previewUrl: null });
    const res = await get('/api/claim/abc12345/profile');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { prefill: Record<string, unknown>; sessionId: string; buildStatus: string };
    };
    expect(json.data.prefill.businessName).toBe('Acme Roofing');
    expect(json.data.sessionId).toBe('claim_abc12345');
    expect(json.data.buildStatus).toBe('building');
  });

  it('defaults buildStatus to pending when no session exists yet', async () => {
    mockResolve.mockResolvedValue({ token: 'abc12345', leadId: 'lead_9' });
    mockGetLead.mockResolvedValue({ leadId: 'lead_9', profile: { businessName: 'Acme' } });
    mockGetSession.mockResolvedValue(null);
    const res = await get('/api/claim/abc12345/profile');
    const json = (await res.json()) as { data: { buildStatus: string } };
    expect(json.data.buildStatus).toBe('pending');
  });
});
