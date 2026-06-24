/**
 * §42/ADR-0019 — email_suppressions store. recordSuppressions writes the
 * suppression (idempotent) + an event-log row per record and counts only NEW
 * suppressions; isSuppressed lower-cases the lookup. D1 helpers are mocked.
 */
jest.mock('../services/db.js', () => ({
  dbExecute: jest.fn(async () => ({ error: null, changes: 1 })),
  dbQueryOne: jest.fn(async () => null),
}));

import { recordSuppressions, isSuppressed } from '../services/email_suppressions.js';
import { dbExecute, dbQueryOne } from '../services/db.js';
import type { SesSuppression } from '../services/ses_notifications.js';

const mockExecute = dbExecute as jest.MockedFunction<typeof dbExecute>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const db = {} as D1Database;

const rec: SesSuppression = {
  email: 'gone@example.com',
  reason: 'bounce',
  subType: 'Permanent',
  timestamp: '2026-06-23T10:00:00.000Z',
  sourceMessageId: 'msg-1',
};

beforeEach(() => jest.clearAllMocks());

describe('recordSuppressions', () => {
  it('writes a suppression row AND an event-log row per record', async () => {
    await recordSuppressions(db, [rec]);
    const sqls = mockExecute.mock.calls.map((c) => String(c[1]));
    expect(sqls.some((s) => /INSERT OR IGNORE INTO email_suppressions/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO email_events/.test(s))).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('counts only NEWLY-suppressed addresses (changes>0)', async () => {
    // 1st insert is new (changes:1), 2nd is a dup (changes:0), event-log always 1.
    mockExecute
      .mockResolvedValueOnce({ error: null, changes: 1 }) // suppression insert (new)
      .mockResolvedValueOnce({ error: null, changes: 1 }) // event log
      .mockResolvedValueOnce({ error: null, changes: 0 }) // suppression insert (dup)
      .mockResolvedValueOnce({ error: null, changes: 1 }); // event log
    const out = await recordSuppressions(db, [rec, { ...rec, email: 'dup@example.com' }]);
    expect(out).toEqual({ suppressed: 1 });
  });

  it('does nothing on an empty list', async () => {
    const out = await recordSuppressions(db, []);
    expect(out).toEqual({ suppressed: 0 });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('isSuppressed', () => {
  it('returns true when a row exists and lower-cases the lookup', async () => {
    mockQueryOne.mockResolvedValueOnce({ email: 'gone@example.com' });
    const out = await isSuppressed(db, 'GONE@Example.com');
    expect(out).toBe(true);
    expect(mockQueryOne.mock.calls[0][2]).toEqual(['gone@example.com']);
  });

  it('returns false when no row exists', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await isSuppressed(db, 'fine@example.com')).toBe(false);
  });
});
