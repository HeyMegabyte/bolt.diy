import { listAnnotations, createAnnotation, deleteAnnotation } from '../service.js';
import type { Env } from '../../../../src/types/env.js';
jest.mock('../../../../src/services/db.js', () => ({ dbExecute: jest.fn(), dbQuery: jest.fn(), dbQueryOne: jest.fn() }));
import { dbExecute, dbQuery, dbQueryOne } from '../../../../src/services/db.js';
function env(): Env { return { DB: {} as D1Database } as unknown as Env; }
beforeEach(() => jest.clearAllMocks());

describe('analytics_annotations', () => {
  it('lists annotations for a site', async () => {
    (dbQuery as jest.Mock).mockResolvedValue({ data: [{ id: 'a1', site_id: 's1', date: '2026-07-15', note: 'Launched v2', category: 'deploy', created_at: '2026-07-15T10:00:00Z' }] });
    const r = await listAnnotations(env(), 's1');
    expect(r).toHaveLength(1); expect(r[0].note).toBe('Launched v2');
  });
  it('creates annotation for owned site', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue({ id: 's1' });
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    const r = await createAnnotation(env(), 'o1', 's1', '2026-07-15', 'Deploy day', 'deploy');
    expect(r.id).toBeTruthy();
  });
  it('throws on unowned site', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue(null);
    await expect(createAnnotation(env(), 'o1', 'foreign', '2026-07-15', 'x', 'other')).rejects.toThrow('site_not_found');
  });
  it('deletes an annotation', async () => {
    (dbExecute as jest.Mock).mockResolvedValue(undefined);
    expect(await deleteAnnotation(env(), 'a1')).toBe(true);
  });
});
