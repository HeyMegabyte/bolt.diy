import { dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import {
  loadOrCreateSession,
  applyClaimEvent,
  getSession,
  getSessionBySiteId,
} from '../services/claim_session_store';

/**
 * #1 claimyour.site — D1 persistence shell around the pure build-session reducer.
 * D1 is mocked (the established `jest.mock('../services/db.js')` pattern), so this
 * proves the load → reduce → persist round-trip + the key idempotency property
 * (a no-op reduce must NOT write) without a real database.
 */
jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

const mockQueryOne = dbQueryOne as jest.Mock;
const mockInsert = dbInsert as jest.Mock;
const mockUpdate = dbUpdate as jest.Mock;
const db = {} as never;

beforeEach(() => {
  mockQueryOne.mockReset();
  mockInsert.mockReset().mockResolvedValue({ error: null });
  mockUpdate.mockReset().mockResolvedValue({ error: null, changes: 1 });
});

describe('loadOrCreateSession', () => {
  it('inserts a fresh pending session when no row exists', async () => {
    mockQueryOne.mockResolvedValue(null);
    const s = await loadOrCreateSession(db, 'sess_1', 'lead_1');
    expect(s.status).toBe('pending');
    expect(s.sessionId).toBe('sess_1');
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockInsert.mock.calls[0];
    expect(table).toBe('claim_build_sessions');
    expect(record).toEqual(
      expect.objectContaining({ session_id: 'sess_1', lead_id: 'lead_1', status: 'pending' }),
    );
  });

  it('deserializes an existing row (JSON pending_context, 0/1 → bool), no insert', async () => {
    mockQueryOne.mockResolvedValue({
      session_id: 'sess_1',
      lead_id: 'lead_1',
      site_id: 'site_9',
      status: 'building',
      preview_url: null,
      pending_rebuild: 1,
      pending_context: JSON.stringify({ tone: 'warm' }),
      attempts: 1,
      error: null,
    });
    const s = await loadOrCreateSession(db, 'sess_1', 'lead_1');
    expect(s.status).toBe('building');
    expect(s.siteId).toBe('site_9');
    expect(s.pendingRebuild).toBe(true);
    expect(s.pendingContext).toEqual({ tone: 'warm' });
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('applyClaimEvent', () => {
  it('persists a real transition (pending → building) via dbUpdate', async () => {
    mockQueryOne.mockResolvedValue(null); // loadOrCreate → fresh pending, then START
    const s = await applyClaimEvent(db, 'sess_1', 'lead_1', {
      type: 'START_BUILD',
      siteId: 'site_9',
    });
    expect(s.status).toBe('building');
    expect(s.attempts).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, table, updates] = mockUpdate.mock.calls[0];
    expect(table).toBe('claim_build_sessions');
    expect(updates).toEqual(expect.objectContaining({ status: 'building', attempts: 1 }));
  });

  it('does NOT write on a no-op transition (idempotent — START_BUILD while building)', async () => {
    mockQueryOne.mockResolvedValue({
      session_id: 'sess_1',
      lead_id: 'lead_1',
      site_id: null,
      status: 'building',
      preview_url: null,
      pending_rebuild: 0,
      pending_context: null,
      attempts: 1,
      error: null,
    });
    const s = await applyClaimEvent(db, 'sess_1', 'lead_1', { type: 'START_BUILD' });
    expect(s.status).toBe('building');
    expect(s.attempts).toBe(1); // unchanged
    expect(mockUpdate).not.toHaveBeenCalled(); // no-op never persists → no dup build
  });

  it('serializes pending_context back to JSON + bool→0/1 on EDIT_RECEIVED', async () => {
    mockQueryOne.mockResolvedValue({
      session_id: 'sess_1',
      lead_id: 'lead_1',
      site_id: null,
      status: 'building',
      preview_url: null,
      pending_rebuild: 0,
      pending_context: null,
      attempts: 1,
      error: null,
    });
    await applyClaimEvent(db, 'sess_1', 'lead_1', {
      type: 'EDIT_RECEIVED',
      context: { phone: '123' },
    });
    const [, , updates] = mockUpdate.mock.calls[0];
    expect(updates.pending_rebuild).toBe(1);
    expect(JSON.parse(updates.pending_context)).toEqual({ phone: '123' });
  });
});

describe('getSession', () => {
  it('returns null when there is no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await getSession(db, 'nope')).toBeNull();
  });
  it('returns the deserialized session when a row exists', async () => {
    mockQueryOne.mockResolvedValue({
      session_id: 'sess_1',
      lead_id: 'lead_1',
      site_id: null,
      status: 'completed',
      preview_url: 'https://p',
      pending_rebuild: 0,
      pending_context: null,
      attempts: 1,
      error: null,
    });
    const s = await getSession(db, 'sess_1');
    expect(s?.status).toBe('completed');
    expect(s?.previewUrl).toBe('https://p');
  });
});

describe('getSessionBySiteId', () => {
  it('returns null for an empty siteId WITHOUT querying', async () => {
    expect(await getSessionBySiteId(db, '')).toBeNull();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns null when no session is linked to the siteId', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await getSessionBySiteId(db, 'site_unknown')).toBeNull();
  });

  it('resolves the claim session linked to a generated siteId (queries by site_id)', async () => {
    mockQueryOne.mockResolvedValue({
      session_id: 'claim_abc',
      lead_id: 'lead_1',
      site_id: 'site_9',
      status: 'building',
      preview_url: null,
      pending_rebuild: 0,
      pending_context: null,
      attempts: 1,
      error: null,
    });
    const s = await getSessionBySiteId(db, 'site_9');
    expect(s?.sessionId).toBe('claim_abc');
    expect(s?.leadId).toBe('lead_1');
    expect(s?.siteId).toBe('site_9');
    // The reverse lookup keys on site_id, not session_id.
    const [, sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toMatch(/WHERE site_id = \?/);
    expect(params).toEqual(['site_9']);
  });
});
