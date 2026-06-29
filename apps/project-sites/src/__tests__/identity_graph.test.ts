import { buildIdentityGraph } from '../services/identity_graph.js';

const rows = [
  { userId: 'u1', email: 'alice@x.com', app: 'plane', externalId: 'mem_a', role: 'admin' },
  { userId: 'u1', email: 'alice@x.com', app: 'twenty', externalId: 'p_a', label: 'Alice' },
  { userId: 'u2', email: '', app: 'listmonk', externalId: 'sub_b' },
  { userId: 'u1', email: 'alice@x.com', app: 'plane', externalId: 'mem_a', role: 'admin' }, // dupe
];

describe('buildIdentityGraph (AP13)', () => {
  it('merges identities into nodes, deduping per (app, externalId)', () => {
    const g = buildIdentityGraph(rows);
    expect(g.totalUsers).toBe(2);
    const u1 = g.nodes.find((n) => n.userId === 'u1')!;
    expect(u1.apps.map((a) => a.app)).toEqual(['plane', 'twenty']);
    expect(u1.appCount).toBe(2);
    expect(u1.isCrossApp).toBe(true);
  });

  it('tallies crossAppUsers + per-app counts', () => {
    const g = buildIdentityGraph(rows);
    expect(g.crossAppUsers).toBe(1);
    expect(g.appCounts.plane).toBe(1);
    expect(g.appCounts.listmonk).toBe(1);
    expect(g.appCounts.twenty).toBe(1);
  });

  it('fills unknown for a missing email (first non-empty wins)', () => {
    const g = buildIdentityGraph([{ userId: 'u2', email: '', app: 'plane', externalId: 'm2' }]);
    expect(g.nodes[0].email).toBe('unknown');
  });

  it('sorts by app-count desc (most connected users first)', () => {
    const g = buildIdentityGraph(rows);
    expect(g.nodes[0].userId).toBe('u1'); // 2 apps before u2's 1
  });

  it('skips rows with no userId/app/externalId', () => {
    const g = buildIdentityGraph([
      { userId: '', email: 'x', app: 'x', externalId: 'x' },
      { userId: 'u', email: 'x', app: '', externalId: 'x' },
      { userId: 'u', email: 'x', app: 'x', externalId: '   ' },
    ]);
    expect(g.totalUsers).toBe(0);
  });

  it('never throws on empty/non-array input', () => {
    expect(buildIdentityGraph([]).totalUsers).toBe(0);
    expect(buildIdentityGraph(undefined as unknown as []).nodes).toEqual([]);
  });
});
