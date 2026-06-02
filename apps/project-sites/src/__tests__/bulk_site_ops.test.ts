import { planBulkOperation, MAX_BULK_SITES, type BulkSiteRef } from '../services/bulk_site_ops.js';

describe('bulk_site_ops planner', () => {
  const owned: BulkSiteRef[] = [
    { id: 'pub1', status: 'published' },
    { id: 'pub2', status: 'published' },
    { id: 'draft1', status: 'draft' },
    { id: 'err1', status: 'error' },
    { id: 'arch1', status: 'archived' },
  ];

  it('set_flag: eligible for all owned non-archived sites; archived skipped', () => {
    const plan = planBulkOperation({
      operation: 'set_flag',
      requestedSiteIds: ['pub1', 'draft1', 'err1', 'arch1'],
      ownedSites: owned,
    });
    expect(plan.eligible.sort()).toEqual(['draft1', 'err1', 'pub1']);
    expect(plan.skipped).toEqual([{ id: 'arch1', reason: 'archived' }]);
    expect(plan.cappedAt).toBeNull();
  });

  it('never acts on a site the caller does not own (cross-tenant guard)', () => {
    const plan = planBulkOperation({
      operation: 'set_flag',
      requestedSiteIds: ['pub1', 'someone-elses-site'],
      ownedSites: owned,
    });
    expect(plan.eligible).toEqual(['pub1']);
    expect(plan.skipped).toEqual([{ id: 'someone-elses-site', reason: 'not_owned' }]);
  });

  it('republish: only published sites are eligible; others → not_publishable', () => {
    const plan = planBulkOperation({
      operation: 'republish',
      requestedSiteIds: ['pub1', 'pub2', 'draft1', 'err1'],
      ownedSites: owned,
    });
    expect(plan.eligible.sort()).toEqual(['pub1', 'pub2']);
    expect(plan.skipped.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'draft1', reason: 'not_publishable' },
      { id: 'err1', reason: 'not_publishable' },
    ]);
  });

  it('archive: non-archived eligible; an already-archived site → already_archived', () => {
    const plan = planBulkOperation({
      operation: 'archive',
      requestedSiteIds: ['pub1', 'draft1', 'arch1'],
      ownedSites: owned,
    });
    expect(plan.eligible.sort()).toEqual(['draft1', 'pub1']);
    expect(plan.skipped).toEqual([{ id: 'arch1', reason: 'already_archived' }]);
  });

  it('dedupes repeated site ids', () => {
    const plan = planBulkOperation({
      operation: 'set_flag',
      requestedSiteIds: ['pub1', 'pub1', 'pub1'],
      ownedSites: owned,
    });
    expect(plan.eligible).toEqual(['pub1']);
    expect(plan.skipped).toEqual([]);
  });

  it('caps the batch at MAX_BULK_SITES and skips the overflow with a reason', () => {
    const many: BulkSiteRef[] = Array.from({ length: MAX_BULK_SITES + 5 }, (_, i) => ({
      id: `s${i}`,
      status: 'published',
    }));
    const plan = planBulkOperation({
      operation: 'set_flag',
      requestedSiteIds: many.map((s) => s.id),
      ownedSites: many,
    });
    expect(plan.eligible.length).toBe(MAX_BULK_SITES);
    expect(plan.cappedAt).toBe(MAX_BULK_SITES);
    expect(plan.skipped.length).toBe(5);
    expect(plan.skipped.every((s) => s.reason === 'batch_cap_exceeded')).toBe(true);
  });

  it('returns empty plan for empty request (route should 400 upstream)', () => {
    const plan = planBulkOperation({ operation: 'set_flag', requestedSiteIds: [], ownedSites: owned });
    expect(plan.eligible).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});
