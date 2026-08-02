/**
 * Active-sessions data model for the /admin/user "Active sessions" panel.
 * Locks the contract for the three worker handlers that turned a synthetic
 * "this device" stub into the real D1-backed list:
 *  - listUserSessions: maps rows, parses free-form device_info into
 *    device/browser/os, and flags the CURRENT session by token_hash match.
 *  - revokeUserSession: only revokes a session OWNED by the caller (no
 *    cross-user revoke), returns whether a row was hit.
 *  - revokeOtherUserSessions: revokes every session EXCEPT the caller's current.
 *
 * A fake D1 records UPDATEs and returns canned SELECT rows so the pure logic is
 * exercised without a live database.
 */
import { sha256Hex } from '@project-sites/shared';
import {
  listUserSessions,
  revokeUserSession,
  revokeOtherUserSessions,
} from '../services/auth.js';

interface Row {
  id: string;
  token_hash: string;
  device_info: string | null;
  ip_address: string | null;
  last_active_at: string | null;
}

/** Build a fake D1 that returns `rows` for SELECTs and records UPDATEs. */
function fakeDb(rows: Row[]) {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const isUpdate = /^\s*UPDATE/i.test(sql);
          const isOwnershipProbe = /SELECT id FROM sessions WHERE id = \?/i.test(sql);
          return {
            async all() {
              if (isUpdate) {
                updates.push({ params, sql });
                return { results: [] };
              }
              if (isOwnershipProbe) {
                const [sessionId, userId] = params as [string, string];
                const hit = rows.find((r) => r.id === sessionId) && userId ? [{ id: sessionId }] : [];
                return { results: hit };
              }
              return { results: rows };
            },
            async run() {
              if (isUpdate) updates.push({ params, sql });
              return {};
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, updates };
}

describe('listUserSessions', () => {
  it('maps rows, parses a UA device_info, and flags the current session', async () => {
    const currentToken = 'tok_current';
    const currentHash = await sha256Hex(currentToken);
    const rows: Row[] = [
      {
        id: 's1',
        token_hash: currentHash,
        device_info:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/149.0 Safari/537.36',
        ip_address: '203.0.113.5',
        last_active_at: '2026-08-02T10:00:00Z',
      },
      {
        id: 's2',
        token_hash: 'other-hash',
        device_info: 'e2e-test-login',
        ip_address: null,
        last_active_at: '2026-08-01T10:00:00Z',
      },
    ];
    const { db } = fakeDb(rows);
    const out = await listUserSessions(db, 'usr_1', currentToken);

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: 's1',
      browser: 'Chrome',
      os: 'macOS',
      device: 'Desktop',
      location: '203.0.113.5',
      current: true,
    });
    // Non-UA free string passes through as `device`, not flagged current.
    expect(out[1]).toMatchObject({ id: 's2', device: 'e2e-test-login', current: false });
  });

  it('flags nothing current when no token is supplied', async () => {
    const rows: Row[] = [
      { id: 's1', token_hash: 'h', device_info: null, ip_address: null, last_active_at: null },
    ];
    const { db } = fakeDb(rows);
    const out = await listUserSessions(db, 'usr_1');
    expect(out[0].current).toBe(false);
  });
});

describe('revokeUserSession', () => {
  it('revokes a session owned by the caller', async () => {
    const rows: Row[] = [
      { id: 's1', token_hash: 'h', device_info: null, ip_address: null, last_active_at: null },
    ];
    const { db, updates } = fakeDb(rows);
    const ok = await revokeUserSession(db, 'usr_1', 's1');
    expect(ok).toBe(true);
    expect(updates.some((u) => /UPDATE sessions/i.test(u.sql))).toBe(true);
  });

  it('returns false (no revoke) for a session not found / not owned', async () => {
    const { db, updates } = fakeDb([]); // ownership probe returns []
    const ok = await revokeUserSession(db, 'usr_1', 's-missing');
    expect(ok).toBe(false);
    expect(updates.some((u) => /UPDATE sessions/i.test(u.sql))).toBe(false);
  });
});

describe('revokeOtherUserSessions', () => {
  it('revokes every session except the current one', async () => {
    const currentToken = 'tok_keep';
    const currentHash = await sha256Hex(currentToken);
    const rows: Row[] = [
      { id: 's1', token_hash: currentHash, device_info: null, ip_address: null, last_active_at: null },
      { id: 's2', token_hash: 'other-1', device_info: null, ip_address: null, last_active_at: null },
      { id: 's3', token_hash: 'other-2', device_info: null, ip_address: null, last_active_at: null },
    ];
    const { db, updates } = fakeDb(rows);
    const count = await revokeOtherUserSessions(db, 'usr_1', currentToken);
    expect(count).toBe(2);
    // Two UPDATE (soft-delete) statements, never touching the current session.
    expect(updates.filter((u) => /UPDATE sessions/i.test(u.sql))).toHaveLength(2);
  });

  it('revokes all when no current token is supplied', async () => {
    const rows: Row[] = [
      { id: 's1', token_hash: 'a', device_info: null, ip_address: null, last_active_at: null },
      { id: 's2', token_hash: 'b', device_info: null, ip_address: null, last_active_at: null },
    ];
    const { db } = fakeDb(rows);
    expect(await revokeOtherUserSessions(db, 'usr_1')).toBe(2);
  });
});
