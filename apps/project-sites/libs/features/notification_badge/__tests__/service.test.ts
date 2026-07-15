import { getBadgeCounts } from '../service.js';
import type { Env } from '../../../../src/types/env.js';
jest.mock('../../../../src/services/db.js', () => ({ dbQueryOne: jest.fn() }));
import { dbQueryOne } from '../../../../src/services/db.js';
function env(): Env { return { DB: {} as D1Database } as unknown as Env; }
beforeEach(() => jest.clearAllMocks());

describe('getBadgeCounts', () => {
  it('sums alerts and failed builds', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce({ cnt: 3 }).mockResolvedValueOnce({ cnt: 2 });
    expect(await getBadgeCounts(env(), 'o')).toEqual({ total: 5, alerts: 3, builds: 2 });
  });
  it('returns zeros for clean org', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce({ cnt: 0 }).mockResolvedValueOnce({ cnt: 0 });
    expect(await getBadgeCounts(env(), 'o')).toEqual({ total: 0, alerts: 0, builds: 0 });
  });
  it('handles null DB results', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue(null);
    expect(await getBadgeCounts(env(), 'o')).toEqual({ total: 0, alerts: 0, builds: 0 });
  });
});
