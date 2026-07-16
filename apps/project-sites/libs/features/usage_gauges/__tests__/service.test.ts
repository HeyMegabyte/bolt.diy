import { computeUsageGauges } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

jest.mock('../../../../src/services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
}));
import { dbQueryOne } from '../../../../src/services/db.js';

function env(): Env {
  return { DB: {} as D1Database } as unknown as Env;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('computeUsageGauges', () => {
  it('returns all 4 gauge metrics', async () => {
    (dbQueryOne as jest.Mock)
      .mockResolvedValueOnce({ cnt: 5 })   // sites
      .mockResolvedValueOnce({ cnt: 8 })   // builds
      .mockResolvedValueOnce({ total_mb: 512 }); // media

    const gauges = await computeUsageGauges(env(), 'org-1');
    expect(gauges).toHaveLength(4);
    expect(gauges[0].metric).toBe('sites');
    expect(gauges[1].metric).toBe('builds');
    expect(gauges[2].metric).toBe('media_gb');
    expect(gauges[3].metric).toBe('bandwidth_gb');
  });

  it('computes percentage correctly', async () => {
    (dbQueryOne as jest.Mock)
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ cnt: 5 }) // 5/10 = 50%
      .mockResolvedValueOnce({ total_mb: 0 });

    const gauges = await computeUsageGauges(env(), 'org-1');
    expect(gauges[1].pct).toBe(50);
    expect(gauges[1].used).toBe(5);
    expect(gauges[1].limit).toBe(10);
  });

  it('caps pct at 100', async () => {
    (dbQueryOne as jest.Mock)
      .mockResolvedValueOnce({ cnt: 20 }) // 20/3 > 100%
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ total_mb: 0 });

    const gauges = await computeUsageGauges(env(), 'org-1');
    expect(gauges[0].pct).toBe(100);
  });

  it('handles null DB results gracefully', async () => {
    (dbQueryOne as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const gauges = await computeUsageGauges(env(), 'org-1');
    expect(gauges[0].used).toBe(0);
    expect(gauges[1].used).toBe(0);
    expect(gauges[2].used).toBe(0);
  });
});
