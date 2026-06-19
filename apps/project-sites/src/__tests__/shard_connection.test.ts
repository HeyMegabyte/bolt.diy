/**
 * Unit coverage for the sharded-Hyperdrive connection resolver
 * (`services/shard_connection.ts`) — the handoff that turns a tenant id into its
 * shard's pooled connection string, or null when the binding isn't declared yet.
 */
import {
  resolveShardConnectionString,
  hasShardBinding,
} from '../services/shard_connection';
import { hyperdriveBindingForTenant } from '../services/db_sharding';

const TENANT = 'org-abc';
const SHARDS = 25;
const BINDING = hyperdriveBindingForTenant(TENANT, SHARDS); // e.g. HYPERDRIVE_SHARD_17

describe('shard_connection', () => {
  it('returns the shard binding connection string when present', () => {
    const env = {
      [BINDING]: { connectionString: 'postgres://hyperdrive/pooled?x=1' },
    } as Record<string, unknown>;
    expect(resolveShardConnectionString(env, TENANT, SHARDS)).toBe('postgres://hyperdrive/pooled?x=1');
    expect(hasShardBinding(env, TENANT, SHARDS)).toBe(true);
  });

  it('returns null when the shard binding is absent (safe pre-wiring fallback)', () => {
    expect(resolveShardConnectionString({}, TENANT, SHARDS)).toBeNull();
    expect(hasShardBinding({}, TENANT, SHARDS)).toBe(false);
  });

  it('returns null when the binding exists but has no usable connection string', () => {
    const env = { [BINDING]: { connectionString: '' } } as Record<string, unknown>;
    expect(resolveShardConnectionString(env, TENANT, SHARDS)).toBeNull();
  });

  it('routes a tenant to its OWN shard binding, not a sibling', () => {
    // Put a binding only on the WRONG shard → tenant must not pick it up.
    const wrong = BINDING === 'HYPERDRIVE_SHARD_0' ? 'HYPERDRIVE_SHARD_1' : 'HYPERDRIVE_SHARD_0';
    const env = { [wrong]: { connectionString: 'postgres://wrong' } } as Record<string, unknown>;
    expect(resolveShardConnectionString(env, TENANT, SHARDS)).toBeNull();
  });

  it('is deterministic — the same tenant always resolves the same binding', () => {
    const env = { [BINDING]: { connectionString: 'postgres://same' } } as Record<string, unknown>;
    expect(resolveShardConnectionString(env, TENANT, SHARDS)).toBe(
      resolveShardConnectionString(env, TENANT, SHARDS),
    );
  });
});
