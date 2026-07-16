import { getSparkline } from '../service.js';
import type { Env } from '../../../../src/types/env.js';
jest.mock('../../../../src/services/db.js', () => ({ dbQuery: jest.fn() }));
import { dbQuery } from '../../../../src/services/db.js';
function env(): Env { return { DB: {} as D1Database } as unknown as Env; }
beforeEach(() => jest.clearAllMocks());

describe('getSparkline', () => {
  it('returns sparkline data', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({ data: [{ date: '2026-07-15', visits: 42 }, { date: '2026-07-14', visits: 31 }] });
    const r = await getSparkline(env(), 's1', 7);
    expect(r.siteId).toBe('s1'); expect(r.days).toHaveLength(2); expect(r.days[0].visits).toBe(42);
  });
  it('returns empty days for no data', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({ data: [] });
    expect((await getSparkline(env(), 's1')).days).toEqual([]);
  });
  it('passes days param to SQL', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({ data: [] });
    await getSparkline(env(), 's1', 14);
    expect(dbQuery).toHaveBeenCalledWith(expect.anything(), expect.any(String), ['s1', '14']);
  });
});
