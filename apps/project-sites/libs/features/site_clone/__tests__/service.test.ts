import { cloneSite } from '../service.js';
import type { Env } from '../../../../src/types/env.js';
jest.mock('../../../../src/services/db.js', () => ({ dbExecute: jest.fn(), dbQueryOne: jest.fn(), dbQuery: jest.fn(), dbInsert: jest.fn() }));
import { dbExecute, dbQueryOne, dbQuery } from '../../../../src/services/db.js';
function env(): Env { return { DB: {} as D1Database } as unknown as Env; }
beforeEach(() => jest.clearAllMocks());

const srcSite = { id: 'src-1', org_id: 'org-1', status: 'published' };

describe('cloneSite', () => {
  it('clones a site with pages', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce(srcSite).mockResolvedValueOnce(null);
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    (dbQuery as jest.Mock).mockResolvedValue({ data: [{ id: 'p1', title: 'Home', path: '/', content: '<h1>Hi</h1>', meta_json: null }] });
    const r = await cloneSite(env(), 'org-1', 'src-1', 'clone-slug', 'Clone');
    expect(r.slug).toBe('clone-slug');
    expect(r.pagesCopied).toBe(1);
  });
  it('throws on missing source', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce(null);
    await expect(cloneSite(env(), 'org-1', 'bad', 'slug', 'N')).rejects.toThrow('source_not_found');
  });
  it('throws on slug conflict', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce(srcSite).mockResolvedValueOnce({ id: 'existing' });
    await expect(cloneSite(env(), 'org-1', 'src-1', 'taken', 'N')).rejects.toThrow('slug_taken');
  });
  it('copies zero pages when source has none', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce(srcSite).mockResolvedValueOnce(null);
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    (dbQuery as jest.Mock).mockResolvedValue({ data: [] });
    const r = await cloneSite(env(), 'org-1', 'src-1', 'empty', 'E');
    expect(r.pagesCopied).toBe(0);
  });
});
