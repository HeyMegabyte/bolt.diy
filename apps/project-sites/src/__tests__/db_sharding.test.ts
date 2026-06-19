/**
 * Unit coverage for the sharded-Hyperdrive routing core
 * (`services/db_sharding.ts`). The architecture exists because CF Hyperdrive caps
 * at 25 configs/account — so 10k+ tenants are HASHED across a fixed shard pool
 * rather than each getting their own config.
 */
import {
  MAX_HYPERDRIVE_SHARDS,
  DbShardingError,
  assignShard,
  hyperdriveBindingName,
  hyperdriveBindingForTenant,
} from '../services/db_sharding';

describe('db_sharding — assignShard', () => {
  it('is deterministic — the same tenant always lands on the same shard', () => {
    expect(assignShard('org-abc', 25)).toBe(assignShard('org-abc', 25));
    expect(assignShard('site-123', 8)).toBe(assignShard('site-123', 8));
  });

  it('always returns a shard within [0, shardCount)', () => {
    for (let i = 0; i < 500; i++) {
      const s = assignShard(`tenant-${i}`, 12);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(12);
      expect(Number.isInteger(s)).toBe(true);
    }
  });

  it('spreads 10k+ tenants across ALL shards (no dead shard, roughly even)', () => {
    const shardCount = 25;
    const counts = new Array(shardCount).fill(0);
    const N = 10_000;
    for (let i = 0; i < N; i++) counts[assignShard(`org-${i}`, shardCount)]++;
    // Every shard is used.
    expect(counts.every((c) => c > 0)).toBe(true);
    // Roughly even: no shard wildly over/under the mean (±40% band is generous).
    const mean = N / shardCount;
    expect(counts.every((c) => c > mean * 0.6 && c < mean * 1.4)).toBe(true);
  });

  it('defaults to the Hyperdrive cap of 25 shards', () => {
    const s = assignShard('whatever');
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(MAX_HYPERDRIVE_SHARDS);
  });

  it('rejects an invalid shard count', () => {
    expect(() => assignShard('x', 0)).toThrow(DbShardingError);
    expect(() => assignShard('x', -3)).toThrow(DbShardingError);
    expect(() => assignShard('x', 1.5)).toThrow(DbShardingError);
    // Cannot exceed the Hyperdrive cap.
    expect(() => assignShard('x', MAX_HYPERDRIVE_SHARDS + 1)).toThrow(/cap of 25/);
  });
});

describe('db_sharding — binding names', () => {
  it('builds the wrangler binding name for a shard', () => {
    expect(hyperdriveBindingName(0)).toBe('HYPERDRIVE_SHARD_0');
    expect(hyperdriveBindingName(24)).toBe('HYPERDRIVE_SHARD_24');
  });

  it('rejects a negative / non-integer shard index', () => {
    expect(() => hyperdriveBindingName(-1)).toThrow(DbShardingError);
    expect(() => hyperdriveBindingName(2.5)).toThrow(DbShardingError);
  });

  it('hyperdriveBindingForTenant composes assign + name deterministically', () => {
    const name = hyperdriveBindingForTenant('org-abc', 25);
    expect(name).toBe(`HYPERDRIVE_SHARD_${assignShard('org-abc', 25)}`);
    expect(name).toMatch(/^HYPERDRIVE_SHARD_\d+$/);
  });
});
