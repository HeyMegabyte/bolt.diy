import { batchProcess } from '../service.js';
import type { Env } from '../../../../src/types/env.js';
jest.mock('../../../../src/services/db.js', () => ({ dbQueryOne: jest.fn(), dbExecute: jest.fn() }));
import { dbQueryOne, dbExecute } from '../../../../src/services/db.js';
function env(): Env { return { DB: {} as D1Database } as unknown as Env; }
beforeEach(() => jest.clearAllMocks());

describe('batchProcess', () => {
  it('processes rebuild for owned sites', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue({ id: 's1' });
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    const r = await batchProcess(env(), 'org-1', ['s1', 's2'], 'rebuild');
    expect(r).toHaveLength(2);
    expect(r[0].ok).toBe(true);
    expect(r[0].message).toBe('rebuild_queued');
  });
  it('rejects unowned sites', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue(null);
    const r = await batchProcess(env(), 'org-1', ['foreign'], 'delete');
    expect(r[0].ok).toBe(false);
    expect(r[0].message).toBe('not_found_or_not_owned');
  });
  it('handles delete action', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue({ id: 's1' });
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    const r = await batchProcess(env(), 'org-1', ['s1'], 'delete');
    expect(r[0].ok).toBe(true);
    expect(r[0].message).toBe('delete_queued');
  });
  it('returns summary counts', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce({ id: 's1' }).mockResolvedValueOnce(null);
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    const r = await batchProcess(env(), 'org-1', ['s1', 's2'], 'rebuild');
    expect(r.filter(x=>x.ok).length).toBe(1);
    expect(r.filter(x=>!x.ok).length).toBe(1);
  });
});
