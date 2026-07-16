import { getOnboardingProgress } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

jest.mock('../../../../src/services/db.js', () => ({ dbQueryOne: jest.fn() }));
import { dbQueryOne } from '../../../../src/services/db.js';
function env(): Env { return { DB: {} as D1Database } as unknown as Env; }
beforeEach(() => jest.clearAllMocks());

describe('getOnboardingProgress', () => {
  it('returns 0% for fresh org', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue({ cnt: 0 });
    const p = await getOnboardingProgress(env(), 'org-1');
    expect(p.pct).toBe(0);
    expect(p.completed).toBe(0);
    expect(p.total).toBe(5);
  });

  it('returns 100% for fully onboarded org', async () => {
    (dbQueryOne as jest.Mock)
      .mockResolvedValueOnce({ cnt: 1 }).mockResolvedValueOnce({ cnt: 3 })
      .mockResolvedValueOnce({ cnt: 1 }).mockResolvedValueOnce({ cnt: 1 })
      .mockResolvedValueOnce({ cnt: 5 });
    const p = await getOnboardingProgress(env(), 'org-1');
    expect(p.pct).toBe(100);
    expect(p.completed).toBe(5);
  });

  it('returns 60% when 3 of 5 steps done', async () => {
    (dbQueryOne as jest.Mock)
      .mockResolvedValueOnce({ cnt: 1 }).mockResolvedValueOnce({ cnt: 1 })
      .mockResolvedValueOnce({ cnt: 1 }).mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ cnt: 1 });
    const p = await getOnboardingProgress(env(), 'org-1');
    expect(p.pct).toBe(60);
  });

  it('handles null DB results', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue(null);
    const p = await getOnboardingProgress(env(), 'org-1');
    expect(p.pct).toBe(0);
  });
});
