import { dbQueryOne, dbInsert, dbExecute } from '../services/db.js';
import {
  generateShortToken,
  createClaimLink,
  resolveLeadByShortlink,
  markClaimLinkClicked,
} from '../services/claim_links';

/**
 * #1/#9 shared dependency — claim shortlinks. A scanned lead gets a short,
 * URL-safe token (claimyour.site/<token>); a click resolves it back to the lead
 * to open the build session. D1 is mocked (the established db-mock pattern).
 */
jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

const mockQueryOne = dbQueryOne as jest.Mock;
const mockInsert = dbInsert as jest.Mock;
const mockExecute = dbExecute as jest.Mock;
const db = {} as never;

beforeEach(() => {
  mockQueryOne.mockReset();
  mockInsert.mockReset().mockResolvedValue({ error: null });
  mockExecute.mockReset().mockResolvedValue({ error: null, changes: 1 });
});

describe('generateShortToken', () => {
  it('returns a URL-safe base62 token of the requested length', () => {
    const t = generateShortToken(8);
    expect(t).toHaveLength(8);
    expect(t).toMatch(/^[A-Za-z0-9]+$/);
  });
  it('defaults to length 8 and is non-repeating across calls', () => {
    expect(generateShortToken()).toHaveLength(8);
    const seen = new Set(Array.from({ length: 50 }, () => generateShortToken()));
    expect(seen.size).toBeGreaterThan(45); // collisions astronomically unlikely
  });
});

describe('createClaimLink', () => {
  it('inserts a generated token bound to the lead and returns it', async () => {
    const r = await createClaimLink(db, 'lead_1');
    expect(r.leadId).toBe('lead_1');
    expect(r.token).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockInsert.mock.calls[0];
    expect(table).toBe('claim_links');
    expect(record).toEqual(expect.objectContaining({ token: r.token, lead_id: 'lead_1' }));
  });
  it('uses an explicitly supplied token when given', async () => {
    const r = await createClaimLink(db, 'lead_1', 'FIXEDtok');
    expect(r.token).toBe('FIXEDtok');
  });
});

describe('resolveLeadByShortlink', () => {
  it('returns the lead + token for a known shortlink', async () => {
    mockQueryOne.mockResolvedValue({ token: 'abc12345', lead_id: 'lead_9' });
    const r = await resolveLeadByShortlink(db, 'abc12345');
    expect(r).toEqual({ token: 'abc12345', leadId: 'lead_9' });
  });
  it('returns null for an unknown shortlink', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await resolveLeadByShortlink(db, 'nope')).toBeNull();
  });
});

describe('markClaimLinkClicked', () => {
  it('increments click_count + stamps clicked_at via dbExecute (attribution)', async () => {
    await markClaimLinkClicked(db, 'abc12345');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [, sql, params] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/UPDATE claim_links/i);
    expect(sql).toMatch(/click_count\s*=\s*click_count\s*\+\s*1/i);
    expect(params).toEqual(['abc12345']);
  });
});
