import { cloneSite } from '../service.js';
import type { Env } from '../../../../src/types/env.js';
jest.mock('../../../../src/services/db.js', () => ({ dbExecute: jest.fn(), dbQueryOne: jest.fn(), dbQuery: jest.fn(), dbInsert: jest.fn() }));
import { dbExecute, dbQueryOne } from '../../../../src/services/db.js';
function env(): Env { return { DB: {} as D1Database } as unknown as Env; }
beforeEach(() => jest.clearAllMocks());

const srcSite = { id: 'src-1', org_id: 'org-1', status: 'published' };

describe('cloneSite', () => {
  it('clones the source site row (pages live in R2, not a D1 pages table)', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce(srcSite).mockResolvedValueOnce(null);
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    const r = await cloneSite(env(), 'org-1', 'src-1', 'clone-slug', 'Clone');
    expect(r.slug).toBe('clone-slug');
    expect(r.name).toBe('Clone');
    // No `pages` table exists in prod — the clone copies the site row only.
    expect(r.pagesCopied).toBe(0);
    const [, sql] = (dbExecute as jest.Mock).mock.calls[0] as [unknown, string, unknown[]];
    expect(sql).toContain('INSERT INTO sites');
    expect(sql).toContain('business_name');
    expect(sql).not.toContain('INSERT INTO pages');
  });
  it('throws on missing source', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce(null);
    await expect(cloneSite(env(), 'org-1', 'bad', 'slug', 'N')).rejects.toThrow('source_not_found');
  });
  it('throws on slug conflict', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce(srcSite).mockResolvedValueOnce({ id: 'existing' });
    await expect(cloneSite(env(), 'org-1', 'src-1', 'taken', 'N')).rejects.toThrow('slug_taken');
  });
  it('mints a fresh site id distinct from the source', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce(srcSite).mockResolvedValueOnce(null);
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    const r = await cloneSite(env(), 'org-1', 'src-1', 'empty', 'E');
    expect(r.id).not.toBe('src-1');
    expect(r.pagesCopied).toBe(0);
  });
});
