/**
 * Tests for auto-primary domain assignment on first custom domain.
 * When a custom domain is the first one added for a site,
 * it should automatically become the primary domain.
 *
 * TDD: Written BEFORE implementation (Red phase).
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbQuery, dbQueryOne, dbInsert } from '../services/db.js';
import { provisionCustomDomain } from '../services/domains.js';
import { AppError } from '@project-sites/shared';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;

const mockEnv = {
  CF_API_TOKEN: 'test-cf-token',
  CF_ZONE_ID: 'test-zone-id',
} as any;

// The auto-primary path runs an atomic `db.batch([db.prepare(...).bind(...)])` swap
// (domains.ts `setSolePrimary`), so the DB double needs prepare (capturing) + a batch
// jest.fn — NOT the module-mocked dbUpdate. (A stale `{}` mock threw "db.prepare is not
// a function" — regression surfaced iter 22.)
const mockBatch = jest.fn(async (stmts: unknown[]) =>
  stmts.map(() => ({ success: true, meta: { changes: 1 } })),
);
const mockDb = {
  prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ sql, args }) }),
  batch: mockBatch,
} as unknown as D1Database;

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('provisionCustomDomain — auto-primary', () => {
  it('sets first custom domain as primary when no custom domains exist', async () => {
    // Domain limit check — no existing custom domains
    mockQuery.mockResolvedValueOnce({ data: [], error: null });
    // Existing hostname check
    mockQueryOne.mockResolvedValueOnce(null);
    // Check for existing custom hostnames on this site (for auto-primary)
    mockQuery.mockResolvedValueOnce({ data: [], error: null });

    // CF API create
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: { id: 'cf-auto-1', status: 'active', ssl: { status: 'active' } },
      }),
      text: async () => '',
    });

    // DB insert for hostname
    mockInsert.mockResolvedValueOnce({ error: null });

    const result = await provisionCustomDomain(mockDb, mockEnv, {
      org_id: 'org-1',
      site_id: 'site-1',
      hostname: 'www.example.com',
    });

    expect(result.hostname).toBe('www.example.com');
    expect(result.is_primary).toBe(true);
    // The auto-primary swap ran as ONE atomic batch (clear all → set this hostname).
    expect(mockBatch).toHaveBeenCalledTimes(1);
    const stmts = mockBatch.mock.calls[0][0] as Array<{ sql: string }>;
    expect(stmts).toHaveLength(2);
    expect(stmts[0].sql).toContain('is_primary = 0');
    expect(stmts[1].sql).toContain('is_primary = 1');
  });

  it('does NOT set as primary when custom domains already exist for the site', async () => {
    // Domain limit check — 1 existing custom domain
    mockQuery.mockResolvedValueOnce({
      data: [{ id: 'dom-existing' }],
      error: null,
    });
    // Existing hostname check
    mockQueryOne.mockResolvedValueOnce(null);
    // Check for existing custom hostnames on this site
    mockQuery.mockResolvedValueOnce({
      data: [{ id: 'h-existing', type: 'custom_cname' }],
      error: null,
    });

    // CF API create
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: { id: 'cf-2', status: 'pending', ssl: { status: 'pending_validation' } },
      }),
      text: async () => '',
    });

    // DB insert
    mockInsert.mockResolvedValueOnce({ error: null });

    const result = await provisionCustomDomain(mockDb, mockEnv, {
      org_id: 'org-1',
      site_id: 'site-1',
      hostname: 'app.example.com',
    });

    expect(result.hostname).toBe('app.example.com');
    expect(result.is_primary).toBe(false);

    // Should NOT run the primary-swap batch when the site already has custom domains.
    expect(mockBatch).not.toHaveBeenCalled();
  });
});
