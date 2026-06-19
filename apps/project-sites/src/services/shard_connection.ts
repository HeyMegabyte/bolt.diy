/**
 * @module services/shard_connection
 * @description Completes the sharded-Hyperdrive routing path
 * (`docs/architecture/scale-to-zero-apps-routing.md` § 7): given a tenant id +
 * the Worker env, resolve the tenant's POOLED Postgres connection string from its
 * Hyperdrive shard binding.
 *
 * `db_sharding` decides WHICH shard a tenant belongs to (`HYPERDRIVE_SHARD_n`);
 * this module reads that binding off `env` and returns its `connectionString`.
 *
 * Safe to ship BEFORE the `HYPERDRIVE_SHARD_*` bindings are declared in
 * wrangler.toml: when the binding is absent it returns `null`, so a caller falls
 * back to the direct / Neon-pooler connection. No behaviour changes until the
 * bindings exist AND a caller (the Worker-mediated DB path) consumes this.
 */
import { MAX_HYPERDRIVE_SHARDS, hyperdriveBindingForTenant } from './db_sharding.js';

/**
 * The runtime shape of a Cloudflare Hyperdrive binding (the subset we read).
 * @see https://developers.cloudflare.com/hyperdrive/
 */
export interface HyperdriveBinding {
  readonly connectionString: string;
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly database?: string;
}

/**
 * Resolve a tenant's pooled Postgres connection string via its Hyperdrive shard
 * binding, or `null` when that shard's binding isn't declared yet.
 *
 * @param env - The Worker env (bindings live as properties, e.g. `HYPERDRIVE_SHARD_3`).
 * @param tenantId - Stable tenant id (org/site/instance).
 * @param shardCount - Active shard count (≤ {@link MAX_HYPERDRIVE_SHARDS}).
 * @returns The shard's connection string, or `null` to fall back to direct/pooler.
 * @example
 * const cs = resolveShardConnectionString(env, orgId) ?? pg.pooledConnectionString;
 */
export function resolveShardConnectionString(
  env: Record<string, unknown>,
  tenantId: string,
  shardCount: number = MAX_HYPERDRIVE_SHARDS,
): string | null {
  const binding = env[hyperdriveBindingForTenant(tenantId, shardCount)] as
    | HyperdriveBinding
    | undefined;
  const cs = binding?.connectionString;
  return typeof cs === 'string' && cs.length > 0 ? cs : null;
}

/**
 * True when a tenant's Hyperdrive shard binding is present + usable — useful for
 * deciding between the accelerated (Hyperdrive) and fallback (direct/pooler)
 * paths without materialising the string.
 */
export function hasShardBinding(
  env: Record<string, unknown>,
  tenantId: string,
  shardCount: number = MAX_HYPERDRIVE_SHARDS,
): boolean {
  return resolveShardConnectionString(env, tenantId, shardCount) !== null;
}
