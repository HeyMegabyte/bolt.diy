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
    (dbExecute as jest.Mock).mockResolvedValue({ error: null, changes: 1 });
    const r = await createAnnotation(env(), 'o1', 's1', '2026-07-15', 'Deploy day', 'deploy');
    expect(r.id).toBeTruthy();
  });
  it('throws annotation_create_failed when the INSERT is dropped (no lying-success)', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue({ id: 's1' });
    (dbExecute as jest.Mock).mockResolvedValue({ error: 'D1_ERROR: no such table', changes: 0 });
    await expect(
      createAnnotation(env(), 'o1', 's1', '2026-07-15', 'x', 'deploy'),
    ).rejects.toThrow('annotation_create_failed');
  });
  it('throws on unowned site', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue(null);
    await expect(createAnnotation(env(), 'o1', 'foreign', '2026-07-15', 'x', 'other')).rejects.toThrow('site_not_found');
  });
  it('deletes an owned annotation (org-scoped WHERE) → true', async () => {
    (dbExecute as jest.Mock).mockResolvedValue({ error: null, changes: 1 });
    expect(await deleteAnnotation(env(), 'o1', 'a1')).toBe(true);
    // The delete MUST be org-scoped (annotation.site_id → sites.org_id) — the old id-only
    // WHERE let any caller soft-delete another org's annotation (IDOR).
    const [, sql, params] = (dbExecute as jest.Mock).mock.calls[0] as [unknown, string, unknown[]];
    expect(sql).toMatch(/site_id IN \(SELECT id FROM sites WHERE org_id=\?/);
    expect(params).toEqual(['a1', 'o1']);
  });
  it('returns false when the delete matches no row in the org (→ handler 404, not a lying 204)', async () => {
    (dbExecute as jest.Mock).mockResolvedValue({ error: null, changes: 0 });
    expect(await deleteAnnotation(env(), 'o1', 'foreign-id')).toBe(false);
  });
});
