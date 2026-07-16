import { compareSites } from '../service.js';
import type { Env } from '../../../../src/types/env.js';
jest.mock('../../../../src/services/db.js', () => ({ dbQueryOne: jest.fn() }));
import { dbQueryOne } from '../../../../src/services/db.js';
function env(): Env { return { DB: {} as D1Database } as unknown as Env; }
beforeEach(() => jest.clearAllMocks());

const siteA = { slug: 'alpha', name: 'Alpha', page_count: 5, build_count: 3, domain_count: 1, status: 'published', last_build: '2026-07-01', updated_at: '2026-07-15' };
const siteB = { slug: 'beta', name: 'Beta', page_count: 8, build_count: 1, domain_count: 0, status: 'draft', last_build: null, updated_at: '2026-07-10' };

describe('compareSites', () => {
  it('compares two sites and returns diff rows', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce(siteA).mockResolvedValueOnce(siteB);
    const r = await compareSites(env(), 'id-a', 'id-b');
    expect(r).not.toBeNull();
    expect(r!.rows).toHaveLength(6);
    expect(r!.rows.find(q => q.metric === 'Pages')!.diff).not.toBeNull();
    expect(r!.siteA.slug).toBe('alpha');
  });
  it('returns null for missing site', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(siteB);
    expect(await compareSites(env(), 'id-x', 'id-b')).toBeNull();
  });
  it('returns null diff for identical values', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce(siteA).mockResolvedValueOnce(siteA);
    const r = await compareSites(env(), 'id-a', 'id-a');
    expect(r!.rows.every(q => q.diff === null)).toBe(true);
  });
});
