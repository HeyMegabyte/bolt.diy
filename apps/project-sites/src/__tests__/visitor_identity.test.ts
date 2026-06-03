/**
 * Unit coverage for services/visitor_identity — cross-channel identity
 * resolution for the Unified Inbox (email > phone > visitor_id > mint) +
 * openOrFetchConversation. D1 mocked; no real APIs.
 */
import { resolveOrCreateIdentity, openOrFetchConversation } from '../services/visitor_identity.js';
import type { Env } from '../types/env.js';

function makeDb() {
  const first = jest.fn().mockResolvedValue(null);
  const run = jest.fn().mockResolvedValue({});
  const bind = jest.fn(() => ({ first, run }));
  const prepare = jest.fn((sql: string) => { lastSqls.push(sql); return { bind }; });
  const lastSqls: string[] = [];
  const db = { prepare } as unknown as D1Database;
  return { db, env: { DB: db } as unknown as Env, prepare, bind, first, run, lastSqls };
}

const baseRow = {
  id: 'vi-1', org_id: 'org-1', site_id: 'site-1',
  email: null, phone: null, visitor_id: null, anon_id: null, display_name: null,
  first_seen_at: 't0', last_seen_at: 't0', channel_flags: '{}', metadata_json: '{}',
};

beforeEach(() => jest.clearAllMocks());

describe('resolveOrCreateIdentity — match priority', () => {
  it('returns the email-matched row (touched) and never queries phone', async () => {
    const { env, first, run, lastSqls } = makeDb();
    first.mockResolvedValueOnce({ ...baseRow, email: 'a@b.com' });
    const id = await resolveOrCreateIdentity(env, { orgId: 'org-1', siteId: 'site-1', email: 'a@b.com' });
    expect(id.id).toBe('vi-1');
    expect(first).toHaveBeenCalledTimes(1); // email match short-circuits before phone
    expect(lastSqls.some((s) => s.includes('email = ?'))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1); // touchIdentity UPDATE
  });

  it('falls through to phone match when email is absent', async () => {
    const { env, first, lastSqls } = makeDb();
    first.mockResolvedValueOnce({ ...baseRow, phone: '+15551234567' });
    const id = await resolveOrCreateIdentity(env, { orgId: 'org-1', siteId: 'site-1', phone: '+15551234567' });
    expect(id.id).toBe('vi-1');
    expect(lastSqls.some((s) => s.includes('phone = ?'))).toBe(true);
  });

  it('falls through to visitor_id cookie match', async () => {
    const { env, first, lastSqls } = makeDb();
    first.mockResolvedValueOnce({ ...baseRow, visitor_id: 'cookie-9' });
    const id = await resolveOrCreateIdentity(env, { orgId: 'org-1', siteId: 'site-1', visitorId: 'cookie-9' });
    expect(id.id).toBe('vi-1');
    expect(lastSqls.some((s) => s.includes('visitor_id = ?'))).toBe(true);
  });
});

describe('resolveOrCreateIdentity — mint new', () => {
  it('mints a fresh identity when nothing matches', async () => {
    const { env, run, lastSqls } = makeDb(); // first() defaults to null → no match
    const id = await resolveOrCreateIdentity(env, {
      orgId: 'org-1', siteId: 'site-1', email: 'new@x.com', anonId: 'anon-7', displayName: 'New',
    });
    expect(id.id).toMatch(/[0-9a-f-]{36}/);
    expect(id.email).toBe('new@x.com');
    expect(id.anon_id).toBe('anon-7');
    expect(id.display_name).toBe('New');
    expect(JSON.parse(id.channel_flags)).toEqual({ form: 0, chat: 0, voice: 0, sms: 0, email: 0 });
    expect(id.metadata_json).toBe('{}');
    expect(lastSqls.some((s) => s.includes('INSERT INTO visitor_identities'))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('null-coalesces every optional signal when minting with none', async () => {
    const { env } = makeDb();
    const id = await resolveOrCreateIdentity(env, { orgId: 'org-1', siteId: 'site-1' });
    expect(id.email).toBeNull();
    expect(id.phone).toBeNull();
    expect(id.visitor_id).toBeNull();
    expect(id.display_name).toBeNull();
  });

  it('treats a rejected SELECT as no-match and still mints (resilience)', async () => {
    const { env, first } = makeDb();
    first.mockReset().mockRejectedValue(new Error('d1 down'));
    const id = await resolveOrCreateIdentity(env, { orgId: 'org-1', siteId: 'site-1', email: 'e@x.com' });
    expect(id.id).toMatch(/[0-9a-f-]{36}/); // fell through to mint
    expect(id.email).toBe('e@x.com');
  });
});

describe('resolveOrCreateIdentity — touch merge', () => {
  it('backfills NULL columns from new signals on a matched row', async () => {
    const { env, first } = makeDb();
    first.mockResolvedValueOnce({ ...baseRow, email: 'a@b.com', phone: null, display_name: null });
    const id = await resolveOrCreateIdentity(env, {
      orgId: 'org-1', siteId: 'site-1', email: 'a@b.com', phone: '+1999', displayName: 'Filled',
    });
    expect(id.phone).toBe('+1999');       // was null → backfilled
    expect(id.display_name).toBe('Filled');
    expect(id.email).toBe('a@b.com');      // preserved
    expect(id.last_seen_at).not.toBe('t0'); // touched
  });

  it('does not overwrite an existing non-null column', async () => {
    const { env, first } = makeDb();
    first.mockResolvedValueOnce({ ...baseRow, email: 'original@x.com' });
    const id = await resolveOrCreateIdentity(env, { orgId: 'org-1', siteId: 'site-1', email: 'original@x.com', phone: '+1', displayName: 'Keep' });
    expect(id.email).toBe('original@x.com');
  });
});

describe('openOrFetchConversation', () => {
  it('returns the existing open conversation id without inserting', async () => {
    const { db, first, run } = makeDb();
    first.mockResolvedValueOnce({ id: 'conv-existing' });
    const id = await openOrFetchConversation(db, {
      orgId: 'org-1', siteId: 'site-1', visitorId: 'vi-1', channel: 'form',
    });
    expect(id).toBe('conv-existing');
    expect(run).not.toHaveBeenCalled(); // no INSERT
  });

  it('creates a new conversation when none is open', async () => {
    const { db, run, lastSqls } = makeDb(); // first() → null
    const id = await openOrFetchConversation(db, {
      orgId: 'org-1', siteId: 'site-1', visitorId: 'vi-1', channel: 'chat', subject: 'Hi',
    });
    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect(lastSqls.some((s) => s.includes('INSERT INTO conversations'))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('opens a new conversation when the lookup query rejects', async () => {
    const { db, first, run } = makeDb();
    first.mockReset().mockRejectedValue(new Error('d1 down'));
    const id = await openOrFetchConversation(db, {
      orgId: 'org-1', siteId: 'site-1', visitorId: 'vi-1', channel: 'voice',
    });
    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
