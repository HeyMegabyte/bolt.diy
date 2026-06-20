/**
 * Per-site database allocation (Cloudflare-first doctrine §4/§5).
 *
 * @remarks
 * Decides which DB plan a site gets — **`none → d1_tenant_db → neon_shared_shard
 * → neon_dedicated_project`** — and records it in `site_database_allocations`
 * (canonical D1) + KV (`site-db:{siteId}` / `hostname-db:{hostname}`). D1 is the
 * default; Neon is the Postgres escape hatch, only when a site genuinely needs
 * Postgres. Shard PLACEMENT for `neon_shared_shard` is delegated to the existing
 * stable tenant→shard service (`db_shards.getOrAssignShard`); this layer never
 * creates one Hyperdrive config per site — it derives the shard-level binding
 * `HYPERDRIVE_SHARD_{n}`.
 *
 * @see docs/architecture/database-allocation.md
 */
import { z } from 'zod';
import type { Env } from '../types/env.js';

export const DB_PLANS = [
  'none',
  'd1_tenant_db',
  'neon_shared_shard',
  'neon_dedicated_project',
] as const;
export type DbPlan = (typeof DB_PLANS)[number];

export type Plan = 'free' | 'paid' | 'pro' | 'enterprise';

/** Signals that influence the allocation decision. */
export interface DbAllocationInput {
  readonly plan: Plan;
  /** True Postgres semantics needed (advanced SQL, RLS, extensions, large relational app data). */
  readonly needsPostgres?: boolean;
  /** Customer-isolation requirement → a dedicated Neon project, not a shared shard. */
  readonly needsIsolation?: boolean;
  /** This tenant is impacting shared-shard neighbours → promote to dedicated. */
  readonly noisyNeighbor?: boolean;
}

export interface DbAllocationDecision {
  readonly dbPlan: DbPlan;
  readonly reason:
    | 'free-plan'
    | 'isolation'
    | 'enterprise'
    | 'noisy-neighbor'
    | 'postgres-required'
    | 'd1-default';
}

/**
 * Decide a site's DB plan — the allocation LAW. D1 first; Neon only when
 * Postgres is truly required; a dedicated Neon project only for isolation /
 * enterprise / noisy-neighbour. Every paid site gets DB capability, but not
 * every paid site a dedicated project.
 *
 * @example
 * chooseDbAllocation({ plan: 'paid' })                       // → d1_tenant_db / d1-default
 * chooseDbAllocation({ plan: 'pro', needsPostgres: true })   // → neon_shared_shard / postgres-required
 * chooseDbAllocation({ plan: 'enterprise' })                 // → neon_dedicated_project / enterprise
 */
export function chooseDbAllocation(input: DbAllocationInput): DbAllocationDecision {
  if (input.plan === 'free') return { dbPlan: 'none', reason: 'free-plan' };

  // Strongest signals first → a dedicated Neon project.
  if (input.needsIsolation) return { dbPlan: 'neon_dedicated_project', reason: 'isolation' };
  if (input.plan === 'enterprise')
    return { dbPlan: 'neon_dedicated_project', reason: 'enterprise' };
  if (input.noisyNeighbor) return { dbPlan: 'neon_dedicated_project', reason: 'noisy-neighbor' };

  // Postgres-required but not isolated → a shared Neon shard.
  if (input.needsPostgres) return { dbPlan: 'neon_shared_shard', reason: 'postgres-required' };

  // Default for any paid site: a per-tenant D1 database.
  return { dbPlan: 'd1_tenant_db', reason: 'd1-default' };
}

/** The shard-level Hyperdrive binding name — never one config per site. */
export function hyperdriveBindingForShard(shardIndex: number): string {
  return `HYPERDRIVE_SHARD_${shardIndex}`;
}

/** Canonical allocation record (matches `site_database_allocations`). */
export const SiteDatabaseAllocationSchema = z
  .object({
    tenantId: z.string().min(1),
    siteId: z.string().min(1),
    dbPlan: z.enum(DB_PLANS),
    region: z.string().default('auto'),
    shardId: z.string().nullable().optional(),
    hyperdriveBindingName: z.string().nullable().optional(),
    neonProjectId: z.string().nullable().optional(),
    neonDatabase: z.string().nullable().optional(),
    neonSchema: z.string().nullable().optional(),
    status: z.enum(['active', 'provisioning', 'migrating', 'retired']).default('active'),
  })
  .strict();

export type SiteDatabaseAllocation = z.infer<typeof SiteDatabaseAllocationSchema>;

export interface BuildAllocationInput {
  readonly tenantId: string;
  readonly siteId: string;
  readonly decision: DbAllocationDecision;
  readonly region?: string;
  /** Shard index from the stable tenant→shard service (for neon_shared_shard). */
  readonly shardIndex?: number;
  readonly neonProjectId?: string;
  readonly neonDatabase?: string;
  readonly neonSchema?: string;
}

/**
 * Build an allocation record from a decision. For `neon_shared_shard` it wires
 * the shard id + the derived shard-level Hyperdrive binding; for
 * `neon_dedicated_project` it carries the Neon project/db/schema.
 */
export function buildAllocation(input: BuildAllocationInput): SiteDatabaseAllocation {
  const { dbPlan } = input.decision;
  const rec: SiteDatabaseAllocation = {
    tenantId: input.tenantId,
    siteId: input.siteId,
    dbPlan,
    region: input.region ?? 'auto',
    status: 'active',
    shardId:
      dbPlan === 'neon_shared_shard' && input.shardIndex !== undefined
        ? String(input.shardIndex)
        : null,
    hyperdriveBindingName:
      dbPlan === 'neon_shared_shard' && input.shardIndex !== undefined
        ? hyperdriveBindingForShard(input.shardIndex)
        : null,
    neonProjectId: dbPlan === 'neon_dedicated_project' ? (input.neonProjectId ?? null) : null,
    neonDatabase: dbPlan.startsWith('neon') ? (input.neonDatabase ?? null) : null,
    neonSchema: dbPlan.startsWith('neon') ? (input.neonSchema ?? null) : null,
  };
  return SiteDatabaseAllocationSchema.parse(rec);
}

const kvSiteKey = (siteId: string) => `site-db:${siteId}`;
const kvHostKey = (hostname: string) => `hostname-db:${hostname.toLowerCase()}`;

/** Cache an allocation in KV by site id (+ hostname when known). */
export async function cacheAllocation(
  env: Pick<Env, 'CACHE_KV'>,
  rec: SiteDatabaseAllocation,
  hostname?: string,
): Promise<void> {
  const body = JSON.stringify(rec);
  const puts = [env.CACHE_KV.put(kvSiteKey(rec.siteId), body, { expirationTtl: 600 })];
  if (hostname) puts.push(env.CACHE_KV.put(kvHostKey(hostname), body, { expirationTtl: 600 }));
  await Promise.all(puts);
}

/** Resolve an allocation from the KV cache by site id or hostname. */
export async function resolveAllocation(
  env: Pick<Env, 'CACHE_KV'>,
  by: { siteId?: string; hostname?: string },
): Promise<SiteDatabaseAllocation | null> {
  const key = by.siteId ? kvSiteKey(by.siteId) : by.hostname ? kvHostKey(by.hostname) : null;
  if (!key) return null;
  const raw = await env.CACHE_KV.get(key);
  if (!raw) return null;
  const parsed = SiteDatabaseAllocationSchema.safeParse(safeJson(raw));
  return parsed.success ? parsed.data : null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
