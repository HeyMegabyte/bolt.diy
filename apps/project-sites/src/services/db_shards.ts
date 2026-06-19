/**
 * @module services/db_shards
 * @description STABLE tenant → Hyperdrive-shard assignment, backed by D1
 * (`migrations/0572_db_shard_assignments.sql`).
 *
 * `db_sharding.assignShard()` is a pure hash → it gives a great INITIAL placement
 * but would remap most tenants if the shard count ever changes (the consistent-
 * hashing problem). At 10k+ tenants you WILL grow the shard pool, and a tenant's
 * data lives on its shard's Neon instance — so remapping is data-loss-class.
 *
 * This module records the assignment at first use, so the shard a tenant lands on
 * is STABLE forever: resharding routes only NEW tenants to new shards; existing
 * tenants keep their recorded slot. `getOrAssignShard()` is the entry point every
 * consumer should use (not the raw hash).
 */
import { assignShard } from './db_sharding.js';
import { dbExecute, dbQueryOne } from './db.js';

/** Minimal env surface: a D1 binding. */
type ShardDbEnv = { DB: D1Database };

export interface TenantShardAssignment {
  readonly tenant_id: string;
  readonly shard_index: number;
  readonly db_name: string | null;
}

/**
 * The shard a tenant is already recorded on, or `null` if it has none yet.
 * @example const s = await getRecordedShard(env, orgId);
 */
export async function getRecordedShard(
  env: ShardDbEnv,
  tenantId: string,
): Promise<TenantShardAssignment | null> {
  return dbQueryOne<TenantShardAssignment>(
    env.DB,
    'SELECT tenant_id, shard_index, db_name FROM tenant_db_assignments WHERE tenant_id = ?',
    [tenantId],
  );
}

/**
 * Resolve a tenant's STABLE shard index: return the recorded assignment if one
 * exists, otherwise compute the initial placement via {@link assignShard}, record
 * it (idempotent), and return it. Recording failures degrade to the hash result
 * (the worst case is a non-persisted placement, never a crash).
 *
 * @param env - Worker env (needs `DB`).
 * @param tenantId - Stable tenant id (org / instance).
 * @param shardCount - Active shard count (defaults to the Hyperdrive cap).
 * @returns The tenant's stable shard index.
 * @example
 * const shard = await getOrAssignShard(env, orgId);
 * const cs = resolveShardConnectionString(env, orgId) ?? pg.pooledConnectionString;
 */
export async function getOrAssignShard(
  env: ShardDbEnv,
  tenantId: string,
  shardCount?: number,
): Promise<number> {
  const existing = await getRecordedShard(env, tenantId);
  if (existing) return existing.shard_index;

  const shard = assignShard(tenantId, shardCount);
  // INSERT OR IGNORE so a concurrent first-resolve can't double-insert; a write
  // failure (e.g. table not migrated yet) is non-fatal — fall back to the hash.
  await dbExecute(
    env.DB,
    'INSERT OR IGNORE INTO tenant_db_assignments (tenant_id, shard_index) VALUES (?, ?)',
    [tenantId, shard],
  );
  return shard;
}

/**
 * Record/override the logical DB name a tenant's data lives in on its shard's
 * Neon instance (set once the provisioner creates the logical DB). No-op-safe.
 */
export async function setTenantDbName(
  env: ShardDbEnv,
  tenantId: string,
  dbName: string,
): Promise<void> {
  await dbExecute(env.DB, 'UPDATE tenant_db_assignments SET db_name = ? WHERE tenant_id = ?', [
    dbName,
    tenantId,
  ]);
}
