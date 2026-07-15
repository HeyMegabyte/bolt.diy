import { suggestActions } from '../service.js';
import type { Env } from '../../../../src/types/env.js';
jest.mock('../../../../src/services/db.js', () => ({ dbQuery: jest.fn() }));
import { dbQuery } from '../../../../src/services/db.js';
function env(): Env { return { DB: {} as D1Database } as unknown as Env; }
beforeEach(() => jest.clearAllMocks());

const sites = [{ id: 's1', slug: 'njsk', name: 'NJSK Soup Kitchen' }, { id: 's2', slug: 'vitos', name: 'Vitos Salon' }];

describe('suggestActions', () => {
  it('returns scored matches for query', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({ data: sites });
    const r = await suggestActions(env(), 'o1', 'njsk');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].siteSlug).toBe('njsk');
  });
  it('returns default suggestions for short queries', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({ data: sites });
    const r = await suggestActions(env(), 'o1', 'x');
    expect(r.some(s => s.id === 'sites')).toBe(true);
    expect(r.some(s => s.id === 'billing')).toBe(true);
  });
  it('caps results at 20', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({ data: sites });
    const r = await suggestActions(env(), 'o1', '');
    expect(r.length).toBeLessThanOrEqual(20);
  });
});
