/**
 * Unit coverage for the STABLE shard-assignment store (`services/db_shards.ts`).
 * Stability is the whole point: a recorded assignment must survive a change in
 * shard count (resharding), where the raw hash would remap the tenant.
 */
import { getOrAssignShard, getRecordedShard, setTenantDbName } from '../services/db_shards';
import { assignShard } from '../services/db_sharding';

/**
 * In-memory D1 stub for the `tenant_db_assignments` table — enough for
 * dbQueryOne (`.all()`) + dbExecute (`.run()`) to round-trip.
 */
function makeDb() {
  const rows = new Map<
    string,
    { tenant_id: string; shard_index: number; db_name: string | null }
  >();
  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      all: async () => {
        // SELECT ... WHERE tenant_id = ?
        if (/^SELECT/i.test(sql)) {
          const r = rows.get(String(params[0]));
          return { results: r ? [r] : [] };
        }
        return { results: [] };
      },
      run: async () => {
        if (/^INSERT OR IGNORE INTO tenant_db_assignments/i.test(sql)) {
          const [tenant_id, shard_index] = params as [string, number];
          if (!rows.has(tenant_id)) rows.set(tenant_id, { tenant_id, shard_index, db_name: null });
        } else if (/^UPDATE tenant_db_assignments SET db_name/i.test(sql)) {
          const [db_name, tenant_id] = params as [string, string];
          const r = rows.get(tenant_id);
          if (r) r.db_name = db_name;
        }
        return { meta: { changes: 1 } };
      },
    }),
  });
  return { env: { DB: { prepare } as unknown as D1Database }, rows };
}

describe('db_shards — stable assignment', () => {
  it('assigns the hash placement on first resolve + records it', async () => {
    const { env, rows } = makeDb();
    const shard = await getOrAssignShard(env, 'org-abc', 25);
    expect(shard).toBe(assignShard('org-abc', 25)); // initial = hash
    expect(rows.get('org-abc')?.shard_index).toBe(shard); // recorded
  });

  it('returns the RECORDED shard on subsequent resolves (idempotent)', async () => {
    const { env } = makeDb();
    const a = await getOrAssignShard(env, 'org-abc', 25);
    const b = await getOrAssignShard(env, 'org-abc', 25);
    expect(b).toBe(a);
  });

  it('is STABLE across resharding — a recorded tenant keeps its shard even when shardCount changes', async () => {
    const { env, rows } = makeDb();
    // Record at 8 shards.
    const original = await getOrAssignShard(env, 'org-reshard', 8);
    expect(rows.get('org-reshard')?.shard_index).toBe(original);
    // Now the pool grows to 25 — the RAW hash would move the tenant…
    const rawAt25 = assignShard('org-reshard', 25);
    // …but getOrAssignShard returns the RECORDED shard, not the new hash.
    const stable = await getOrAssignShard(env, 'org-reshard', 25);
    expect(stable).toBe(original);
    if (rawAt25 !== original) {
      // (true for this id) — proves the table prevented a remap.
      expect(stable).not.toBe(rawAt25);
    }
  });

  it('getRecordedShard returns null for an unassigned tenant', async () => {
    const { env } = makeDb();
    expect(await getRecordedShard(env, 'never-seen')).toBeNull();
  });

  it('setTenantDbName records the logical DB on the assignment', async () => {
    const { env, rows } = makeDb();
    await getOrAssignShard(env, 'org-abc', 25);
    await setTenantDbName(env, 'org-abc', 'umami_org_abc');
    expect(rows.get('org-abc')?.db_name).toBe('umami_org_abc');
  });
});
