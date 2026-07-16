import { getMruCards } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

jest.mock('../../../../src/services/db.js', () => ({ dbQuery: jest.fn() }));
import { dbQuery } from '../../../../src/services/db.js';

function env(): Env {
  return { DB: {} as D1Database } as unknown as Env;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('getMruCards', () => {
  it('returns MRU cards from audit_logs joined with sites', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({
      data: [
        { site_id: 's1', slug: 'alpha', name: 'Alpha Site', action: 'build.completed', max_created_at: '2026-07-15T10:00:00Z' },
        { site_id: 's2', slug: 'beta', name: 'Beta Site', action: 'site.published', max_created_at: '2026-07-14T10:00:00Z' },
      ],
    });
    const cards = await getMruCards(env(), 'org-1', 5);
    expect(cards).toHaveLength(2);
    expect(cards[0].siteId).toBe('s1');
    expect(cards[0].name).toBe('Alpha Site');
    expect(cards[0].lastAction).toBe('build.completed');
  });

  it('returns empty array for org with no activity', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({ data: [] });
    const cards = await getMruCards(env(), 'org-1');
    expect(cards).toEqual([]);
  });

  it('clamps limit to 20 max', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({ data: [] });
    await getMruCards(env(), 'org-1', 100);
    expect(dbQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('LIMIT ?'),
      ['org-1', 20],
    );
  });

  it('defaults to 5 items', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({ data: [] });
    await getMruCards(env(), 'org-1');
    expect(dbQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('LIMIT ?'),
      ['org-1', 5],
    );
  });
});
