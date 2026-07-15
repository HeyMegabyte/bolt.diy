/**
 * Site Tags service unit tests.
 *
 * All tests use a stubbed D1 (mock dbExecute/dbQuery/dbQueryOne/dbInsert) so
 * they run without a real database.
 */
import { createTag, updateTag, deleteTag, listTags, setSiteTags, getSiteTags } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

// Mock the db module
const mockDb = {
  exec: jest.fn(),
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
};

jest.mock('../../../../src/services/db.js', () => ({
  dbExecute: jest.fn(),
  dbQueryOne: jest.fn(),
  dbQuery: jest.fn(),
  dbInsert: jest.fn(),
}));

import { dbExecute, dbQueryOne, dbQuery } from '../../../../src/services/db.js';

function mockEnv(): Env {
  return { DB: mockDb as unknown as D1Database } as unknown as Env;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createTag', () => {
  it('creates a tag and returns the TagResponse', async () => {
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    const result = await createTag(mockEnv(), 'org-1', { name: 'Production', color: 'green' });
    expect(result.name).toBe('Production');
    expect(result.color).toBe('green');
    expect(result.siteCount).toBe(0);
    expect(result.orgId).toBe('org-1');
    expect(result.id).toBeTruthy();
    expect(dbExecute).toHaveBeenCalledTimes(1);
  });

  it('includes emoji when provided', async () => {
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    const result = await createTag(mockEnv(), 'org-1', { name: 'Urgent', color: 'red', emoji: '🚨' });
    expect(result.emoji).toBe('🚨');
  });
});

describe('updateTag', () => {
  it('returns null for missing tag', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue(null);
    const result = await updateTag(mockEnv(), 'org-1', 'tag-404', { name: 'Nope' });
    expect(result).toBeNull();
  });

  it('updates name and color', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue({
      id: 'tag-1', org_id: 'org-1', name: 'Old', color: 'slate',
      emoji: null, created_at: '2026-01-01', site_count: 3,
    });
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    const result = await updateTag(mockEnv(), 'org-1', 'tag-1', { name: 'New', color: 'blue' });
    expect(result).not.toBeNull();
    expect(result!.name).toBe('New');
    expect(result!.color).toBe('blue');
    expect(result!.siteCount).toBe(3);
  });
});

describe('deleteTag', () => {
  it('soft-deletes tag and assignments', async () => {
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    const result = await deleteTag(mockEnv(), 'org-1', 'tag-1');
    expect(result).toBe(true);
    expect(dbExecute).toHaveBeenCalledTimes(2);
  });
});

describe('listTags', () => {
  it('returns tags sorted by name', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({
      data: [
        { id: 'tag-2', org_id: 'org-1', name: 'Beta', color: 'purple', emoji: '🧪', site_count: 1, created_at: '2026-01-01' },
        { id: 'tag-1', org_id: 'org-1', name: 'Alpha', color: 'green', emoji: null, site_count: 5, created_at: '2026-01-01' },
      ],
    });
    const tags = await listTags(mockEnv(), 'org-1');
    // Should be sorted by name ASC from SQL
    expect(tags).toHaveLength(2);
    // siteCount should be a number, not a string
    expect(tags[0].siteCount).toBe(1);
    expect(tags[1].siteCount).toBe(5);
  });

  it('returns empty array for org with no tags', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({ data: [] });
    const tags = await listTags(mockEnv(), 'org-1');
    expect(tags).toEqual([]);
  });
});

describe('setSiteTags', () => {
  it('replaces all tags for a site', async () => {
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    (dbQueryOne as jest.Mock)
      .mockResolvedValueOnce({ org_id: 'org-1' }) // site lookup
      .mockResolvedValueOnce({ id: 'tag-1', org_id: 'org-1' }) // tag verification
      .mockResolvedValueOnce({ id: 'tag-2', org_id: 'org-1' }); // tag verification
    (dbQuery as jest.Mock).mockResolvedValue({
      data: [
        { id: 'tag-1', org_id: 'org-1', name: 'A', color: 'green', emoji: null, site_count: 4, created_at: '2026-01-01' },
        { id: 'tag-2', org_id: 'org-1', name: 'B', color: 'blue', emoji: null, site_count: 2, created_at: '2026-01-01' },
      ],
    });
    const tags = await setSiteTags(mockEnv(), 'site-1', { tagIds: ['tag-1', 'tag-2'] });
    expect(tags).toHaveLength(2);
    // Should soft-delete existing + insert new + look up site
    expect(dbExecute).toHaveBeenCalled();
  });

  it('throws for non-existent site', async () => {
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    (dbQueryOne as jest.Mock).mockResolvedValue(null);
    await expect(setSiteTags(mockEnv(), 'site-404', { tagIds: [] })).rejects.toThrow('site_not_found');
  });

  it('skips tags from other orgs', async () => {
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    (dbQueryOne as jest.Mock)
      .mockResolvedValueOnce({ org_id: 'org-1' }) // site lookup
      .mockResolvedValueOnce(null); // tag from other org
    (dbQuery as jest.Mock).mockResolvedValue({ data: [] });
    const tags = await setSiteTags(mockEnv(), 'site-1', { tagIds: ['foreign-tag'] });
    expect(tags).toEqual([]);
  });
});

describe('getSiteTags', () => {
  it('returns tags assigned to a site', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({
      data: [
        { id: 'tag-1', org_id: 'org-1', name: 'Active', color: 'emerald', emoji: '✅', site_count: 7, created_at: '2026-01-01' },
      ],
    });
    const tags = await getSiteTags(mockEnv(), 'site-1');
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('Active');
  });
});
