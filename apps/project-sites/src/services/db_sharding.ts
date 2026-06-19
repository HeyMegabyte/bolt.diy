/**
 * @module services/db_sharding
 * @description Deterministic tenant → Hyperdrive-shard assignment for the
 * scale-to-zero "sharded Hyperdrive" architecture
 * (`docs/architecture/scale-to-zero-apps-routing.md` § Sharded Hyperdrive).
 *
 * The load-bearing constraint (verified against CF docs 2026-06-18): **Cloudflare
 * Hyperdrive allows at most 25 configured databases per account (10 on free)**,
 * and a Hyperdrive binding is wrangler-declared (static) — there is NO dynamic
 * per-request origin. So a platform serving 10k+ tenants CANNOT give each tenant
 * its own Hyperdrive config.
 *
 * The scalable design: a FIXED POOL of ≤25 Hyperdrive shards (static bindings
 * `HYPERDRIVE_SHARD_0..N`), each fronting one Neon Postgres instance. Every tenant
 * is hashed to a shard; tenants on the same shard share that Hyperdrive's edge
 * pool + query cache (fast) and live as isolated logical databases on the shard's
 * Neon instance (own DB, own credentials). Scale by adding shards (up to the cap),
 * then by adding Neon instances behind each shard.
 *
 * This module is the pure routing core: hash → shard index, and shard → binding
 * name. No I/O, fully deterministic (stable across isolates + restarts).
 */

/**
 * Cloudflare Hyperdrive's hard cap of configured databases per account on the
 * paid plan (10 on free). The shard pool can never exceed this.
 * @see https://developers.cloudflare.com/hyperdrive/platform/limits/
 */
export const MAX_HYPERDRIVE_SHARDS = 25;

/** Typed error for invalid shard configuration. */
export class DbShardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbShardingError';
  }
}

/**
 * Stable FNV-1a 32-bit hash of a string. Deterministic + uniform — the same
 * tenant always lands on the same shard, across isolates and restarts (no
 * `Math.random`, no time).
 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // murmur3 finalizer — strong avalanche so even short/sequential ids (org-0,
  // org-1, …) spread evenly across shards, not just random UUIDs.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0; // force unsigned 32-bit
}

/**
 * Assign a tenant (org/site/instance id) to a Hyperdrive shard in `[0, shardCount)`.
 * Deterministic: the same id always resolves to the same shard.
 *
 * @param tenantId - Stable tenant identifier (org id / instance id).
 * @param shardCount - Active shard count (1..{@link MAX_HYPERDRIVE_SHARDS}).
 * @throws {DbShardingError} When `shardCount` is out of range.
 * @example assignShard('org-abc', 25) // → 17 (stable)
 */
export function assignShard(tenantId: string, shardCount: number = MAX_HYPERDRIVE_SHARDS): number {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new DbShardingError(`shardCount must be an integer >= 1 (got ${shardCount})`);
  }
  if (shardCount > MAX_HYPERDRIVE_SHARDS) {
    throw new DbShardingError(
      `shardCount ${shardCount} exceeds the Hyperdrive cap of ${MAX_HYPERDRIVE_SHARDS}`,
    );
  }
  return fnv1a(tenantId) % shardCount;
}

/**
 * The wrangler binding name for a shard's Hyperdrive config, e.g.
 * `HYPERDRIVE_SHARD_0`. The Worker reads `env[hyperdriveBindingName(shard)]` to
 * get that shard's pooled connection string.
 * @example hyperdriveBindingName(3) // → 'HYPERDRIVE_SHARD_3'
 */
export function hyperdriveBindingName(shard: number): string {
  if (!Number.isInteger(shard) || shard < 0) {
    throw new DbShardingError(`shard index must be a non-negative integer (got ${shard})`);
  }
  return `HYPERDRIVE_SHARD_${shard}`;
}

/** Convenience: the Hyperdrive binding name a tenant routes to. */
export function hyperdriveBindingForTenant(
  tenantId: string,
  shardCount: number = MAX_HYPERDRIVE_SHARDS,
): string {
  return hyperdriveBindingName(assignShard(tenantId, shardCount));
}
