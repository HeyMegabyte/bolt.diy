import { batchProcess } from '../service.js';
import type { Env } from '../../../../src/types/env.js';
jest.mock('../../../../src/services/db.js', () => ({
  dbQueryOne: jest.fn(),
  dbExecute: jest.fn(),
}));
import { dbQueryOne, dbExecute } from '../../../../src/services/db.js';
function env(): Env {
  return { DB: {} as D1Database } as unknown as Env;
}
// dbExecute returns `{ error, changes }` — the OK path needs that real shape (the
// old mock returned `undefined`, which only worked because the code IGNORED the
// return; it now reads the outcome to avoid the lying-success).
const OK = { error: null, changes: 1 };
beforeEach(() => jest.clearAllMocks());

describe('batchProcess', () => {
  it('processes rebuild for owned sites', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue({ id: 's1' });
    (dbExecute as jest.Mock).mockResolvedValue(OK);
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
    (dbExecute as jest.Mock).mockResolvedValue(OK);
    const r = await batchProcess(env(), 'org-1', ['s1'], 'delete');
    expect(r[0].ok).toBe(true);
    expect(r[0].message).toBe('delete_queued');
  });
  it('returns summary counts', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValueOnce({ id: 's1' }).mockResolvedValueOnce(null);
    (dbExecute as jest.Mock).mockResolvedValue(OK);
    const r = await batchProcess(env(), 'org-1', ['s1', 's2'], 'rebuild');
    expect(r.filter((x) => x.ok).length).toBe(1);
    expect(r.filter((x) => !x.ok).length).toBe(1);
  });

  // ── lying-success guards (this iteration) ──────────────────────────────────

  it('reports ok:FALSE (not a lying-success) when the D1 write returns an error', async () => {
    // dbExecute returns {error} — it does NOT throw — so the try/catch never saw a D1
    // failure and the bulk DESTRUCTIVE delete used to claim ok:true while the row
    // survived. Now the error is captured and surfaced per site.
    (dbQueryOne as jest.Mock).mockResolvedValue({ id: 's1' });
    (dbExecute as jest.Mock).mockResolvedValue({ error: 'D1_ERROR: disk full', changes: 0 });
    const r = await batchProcess(env(), 'org-1', ['s1'], 'delete');
    expect(r[0].ok).toBe(false);
    expect(r[0].message).toContain('delete_failed');
  });

  it('reports ok:FALSE when a delete matches no row (race between SELECT and UPDATE)', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue({ id: 's1' });
    (dbExecute as jest.Mock).mockResolvedValue({ error: null, changes: 0 });
    const r = await batchProcess(env(), 'org-1', ['s1'], 'delete');
    expect(r[0].ok).toBe(false);
    expect(r[0].message).toBe('not_found_or_already_deleted');
  });

  it('never silently succeeds for an unknown action (no DB write)', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue({ id: 's1' });
    const r = await batchProcess(env(), 'org-1', ['s1'], 'frobnicate');
    expect(r[0].ok).toBe(false);
    expect(r[0].message).toContain('unknown_action');
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it('rebuild queues a workflow_jobs row named "build"', async () => {
    (dbQueryOne as jest.Mock).mockResolvedValue({ id: 's1' });
    (dbExecute as jest.Mock).mockResolvedValue(OK);
    await batchProcess(env(), 'org-1', ['s1'], 'rebuild');
    // params: [uuid, orgId, siteId, jobName]
    expect((dbExecute as jest.Mock).mock.calls[0][2][3]).toBe('build');
  });
});
