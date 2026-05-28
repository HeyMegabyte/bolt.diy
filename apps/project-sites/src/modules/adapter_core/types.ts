/**
 * @module modules/adapter_core/types
 *
 * @description
 * Shared `ServiceAdapter` interface + supporting types consumed by every
 * service adapter under `src/modules/adapters_*`.
 *
 * The 12 first-class managed services (Listmonk, Cal.com, Chatwoot, Ghost,
 * OpenStatus, Mautic, Documenso, Plausible, n8n, Vaultwarden, Outline,
 * Uptime Kuma) each ship as a self-contained module that implements this
 * surface. The dispatcher (`adapter_core/registry`) routes a tenant +
 * service-name to the right adapter then drives provision → boot → health.
 *
 * This file is dependency-free at runtime — only types — so it can be
 * imported from anywhere (worker routes, workflows, DOs, tests) without
 * pulling in Cloudflare bindings.
 *
 * @packageDocumentation
 */
import type { z } from 'zod';
import type { Env } from '../../types/env.js';

/** Canonical service identifiers. Order matches the Wave-2A architect spec. */
export const SERVICE_NAMES = [
  'listmonk',
  'calcom',
  'chatwoot',
  'ghost',
  'openstatus',
  'mautic',
  'documenso',
  'plausible',
  'n8n',
  'vaultwarden',
  'outline',
  'uptime_kuma',
] as const;

/** Type-level union of every supported service name. */
export type ServiceName = (typeof SERVICE_NAMES)[number];

/** Type-guard for incoming string identifiers. */
export function isServiceName(value: string): value is ServiceName {
  return (SERVICE_NAMES as readonly string[]).includes(value);
}

/** Per-tenant context every adapter operation receives. */
export interface TenantContext {
  readonly orgId: string;
  readonly siteId: string;
  /** Resolved slug used to compose the dashboard URL (`{name}-{slug}.projectsites.dev`). */
  readonly slug: string;
  /** Stable instance ID used as the DO name. */
  readonly instanceId: string;
  /** When present, the operator's primary email — used for `ADMIN_USER_EMAIL` etc. */
  readonly ownerEmail?: string;
  /** Worker env (bindings + secrets). */
  readonly env: Env;
}

/** Thin Neon client shape — only the methods adapters call. */
export interface NeonClient {
  createProject(name: string): Promise<{
    projectId: string;
    connectionString: string;
    host: string;
    database: string;
    user: string;
    password: string;
  }>;
  deleteProject(projectId: string): Promise<void>;
}

/** Outcome of `provision()` — used by the workflow to persist secrets. */
export interface ProvisionResult {
  readonly status: 'provisioned' | 'skipped' | 'failed';
  readonly resources: ReadonlyArray<ProvisionedResource>;
  readonly env: Readonly<Record<string, string>>;
  readonly notes?: string;
}

/** A single backing resource the adapter created (DB, Redis, R2 prefix, etc.). */
export interface ProvisionedResource {
  readonly kind: 'neon-postgres' | 'upstash-redis' | 'r2-prefix' | 'kv-prefix' | 'external';
  readonly id: string;
  readonly label: string;
}

/** Idempotent provisioning step the dispatcher can replay on failure. */
export interface ProvisionStep {
  readonly id: string;
  readonly description: string;
  readonly run: (ctx: TenantContext) => Promise<ProvisionStepResult>;
  /** Optional rollback for sagas — if any later step fails, dispatcher rewinds. */
  readonly rollback?: (ctx: TenantContext, output: ProvisionStepResult) => Promise<void>;
}

/** Output of a single provisioning step. */
export interface ProvisionStepResult {
  readonly ok: boolean;
  readonly outputs?: Readonly<Record<string, string>>;
  readonly resources?: ReadonlyArray<ProvisionedResource>;
  readonly error?: string;
}

/** Context passed into `boot()` after every provision step has succeeded. */
export interface BootContext {
  readonly ctx: TenantContext;
  /** Fully merged env-var map produced by `provision()`. */
  readonly env: Readonly<Record<string, string>>;
  /** DO stub for the underlying container — already bound to the right binding. */
  readonly stub: DurableObjectStub;
}

/** Snapshot returned by `health()`. */
export interface HealthReport {
  readonly state: 'idle' | 'booting' | 'running' | 'crashed' | 'stopped';
  readonly uptimeSeconds: number;
  readonly restartCount: number;
  readonly lastError?: string;
  readonly probe?: 'pass' | 'fail';
  readonly probeLatencyMs?: number;
}

/** R2 key returned by `backupConfig()`. */
export type R2ObjectKey = string;

/** Cost projection per month (USD). */
export interface CostSnapshot {
  readonly monthlyUsd: number;
  readonly breakdown: ReadonlyArray<{ kind: string; usd: number }>;
}

/** Feature flag declaration the adapter wants registered globally. */
export interface FeatureFlagDecl<T = unknown> {
  readonly key: string;
  readonly defaultValue: T;
  readonly description: string;
  readonly schema?: z.ZodType<T>;
}

/** Resource tier hint for the container scheduler. */
export type ResourceTier = 'small' | 'medium' | 'large';

/**
 * Universal adapter surface. Every managed service implements this.
 *
 * @example
 * ```ts
 * import { listmonkAdapter } from './adapters_listmonk/adapter.js';
 * const result = await listmonkAdapter.provision(ctx, neon);
 * await listmonkAdapter.boot({ ctx, env: result.env, stub });
 * ```
 */
export interface ServiceAdapter {
  readonly name: ServiceName;
  readonly displayName: string;
  readonly defaultPort: number;
  readonly resourceTier: ResourceTier;
  readonly featureFlagKey: `service.${ServiceName}.enabled`;
  provision(ctx: TenantContext, neon: NeonClient): Promise<ProvisionResult>;
  boot(boot: BootContext): Promise<void>;
  health(stub: DurableObjectStub): Promise<HealthReport>;
  getDashboardUrl(ctx: TenantContext): string;
  backupConfig(ctx: TenantContext): Promise<R2ObjectKey>;
  cost(ctx: TenantContext): Promise<CostSnapshot>;
  featureFlags(): readonly FeatureFlagDecl<unknown>[];
}

/** Helper — compose the canonical dashboard hostname for a service. */
export function dashboardHost(name: ServiceName, slug: string): string {
  return `${name.replace(/_/g, '-')}-${slug}.projectsites.dev`;
}

/** Helper — compose the canonical dashboard URL (HTTPS). */
export function dashboardUrl(name: ServiceName, slug: string): string {
  return `https://${dashboardHost(name, slug)}`;
}
