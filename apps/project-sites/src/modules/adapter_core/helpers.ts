/**
 * @module modules/adapter_core/helpers
 *
 * @description
 * Shared helpers consumed by every service adapter — secret generation,
 * standard Neon-provision step, DO boot wrapper. Adapters import these so
 * the per-service files stay ~150 lines each.
 *
 * @packageDocumentation
 */
import type {
  BootContext,
  HealthReport,
  NeonClient,
  ProvisionStep,
  ProvisionStepResult,
  TenantContext,
} from './types.js';

/** Generate a Tier-1 base64 secret (32 bytes ≈ 256 bits). */
export function generateSecret(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

/** Generate a hex secret (URL-safe nonces / IDs). */
export function generateHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Standard Neon-provision step. Most DB-backed services share this exact
 * dance: create project → derive POSTGRES_* + DATABASE_URL env. The adapter
 * just lists this step in its `PROVISION_STEPS` array.
 */
export function neonProvisionStep(serviceName: string, neon: NeonClient): ProvisionStep {
  return {
    id: `neon-${serviceName}`,
    description: `Provision Neon project for ${serviceName}`,
    run: async (ctx: TenantContext): Promise<ProvisionStepResult> => {
      try {
        const projectName = `${serviceName}-${ctx.slug}`.slice(0, 64);
        const proj = await neon.createProject(projectName);
        return {
          ok: true,
          outputs: {
            DATABASE_URL: proj.connectionString,
            POSTGRES_HOST: proj.host,
            POSTGRES_PORT: '5432',
            POSTGRES_DB: proj.database,
            POSTGRES_USER: proj.user,
            POSTGRES_PASSWORD: proj.password,
            POSTGRES_SSL: 'require',
          },
          resources: [
            {
              kind: 'neon-postgres',
              id: proj.projectId,
              label: `${serviceName} primary DB`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
    rollback: async (_ctx, output) => {
      const id = output.resources?.[0]?.id;
      if (id) await neon.deleteProject(id).catch(() => undefined);
    },
  };
}

/**
 * Drive a sequence of provision steps end-to-end, rolling back on first
 * failure. Returns the merged outputs (env-var map) on success.
 */
export async function runProvisionSteps(
  ctx: TenantContext,
  steps: readonly ProvisionStep[],
): Promise<
  | { ok: true; env: Record<string, string>; resources: ProvisionStepResult['resources'] }
  | { ok: false; error: string }
> {
  const env: Record<string, string> = {};
  const resources: NonNullable<ProvisionStepResult['resources']>[number][] = [];
  const completed: Array<{ step: ProvisionStep; output: ProvisionStepResult }> = [];

  for (const step of steps) {
    const out = await step.run(ctx);
    if (!out.ok) {
      // Rewind sagas.
      for (const c of completed.reverse()) {
        await c.step.rollback?.(ctx, c.output).catch(() => undefined);
      }
      return { ok: false, error: out.error ?? `${step.id} failed` };
    }
    if (out.outputs) Object.assign(env, out.outputs);
    if (out.resources) resources.push(...out.resources);
    completed.push({ step, output: out });
  }
  return { ok: true, env, resources };
}

/** RPC into the container DO via the standard `POST /start` HTTP shim. */
export async function bootContainer(
  boot: BootContext,
  image: string,
  port: number,
): Promise<void> {
  const body = JSON.stringify({ image, port, env: boot.env });
  const res = await boot.stub.fetch('https://do/start', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Container boot failed (${res.status}): ${txt.slice(0, 200)}`);
  }
}

/** Fetch a `HealthReport` snapshot from the container DO. */
export async function fetchHealth(stub: DurableObjectStub): Promise<HealthReport> {
  const t0 = Date.now();
  const res = await stub.fetch('https://do/status').catch(() => null);
  const ms = Date.now() - t0;
  if (!res || !res.ok) {
    return {
      state: 'crashed',
      uptimeSeconds: 0,
      restartCount: 0,
      probe: 'fail',
      probeLatencyMs: ms,
      lastError: res ? `HTTP ${res.status}` : 'unreachable',
    };
  }
  const json = (await res.json().catch(() => null)) as
    | {
        state?: string;
        uptime_seconds?: number;
        restart_count?: number;
        last_error?: string;
      }
    | null;
  return {
    state: (json?.state ?? 'idle') as HealthReport['state'],
    uptimeSeconds: json?.uptime_seconds ?? 0,
    restartCount: json?.restart_count ?? 0,
    lastError: json?.last_error,
    probe: 'pass',
    probeLatencyMs: ms,
  };
}

/** Default `backupConfig` — dumps env keys as JSON to R2. */
export async function backupEnvToR2(
  ctx: TenantContext,
  serviceName: string,
  envKeys: readonly string[],
): Promise<string> {
  const key = `service-backups/${ctx.orgId}/${ctx.siteId}/${serviceName}-${Date.now()}.json`;
  const payload = JSON.stringify({
    serviceName,
    instanceId: ctx.instanceId,
    backedUpAt: new Date().toISOString(),
    envKeys,
  });
  await ctx.env.SITES_BUCKET.put(key, payload, {
    httpMetadata: { contentType: 'application/json' },
  });
  return key;
}

/** Standard cost-snapshot helper (per-resource-tier $/mo estimates). */
export function tierCost(
  tier: 'small' | 'medium' | 'large',
  extras: ReadonlyArray<{ kind: string; usd: number }> = [],
): { monthlyUsd: number; breakdown: ReadonlyArray<{ kind: string; usd: number }> } {
  const compute = tier === 'large' ? 18 : tier === 'medium' ? 9 : 4;
  const breakdown = [{ kind: 'compute', usd: compute }, ...extras];
  const monthlyUsd = breakdown.reduce((s, b) => s + b.usd, 0);
  return { monthlyUsd, breakdown };
}
