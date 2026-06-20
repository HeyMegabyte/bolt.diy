/**
 * @module platform/job-provider
 *
 * @description
 * The `ProjectSitesJobProvider` port (convergence §20) + a deterministic
 * `FakeJobProvider` (§16 no-vendor local mode) + `createJobRouter` — the dispatch
 * limbs the WorkflowRouter routes to. App code calls `jobRouter.start(kind, ctx,
 * payload)`; the router resolves the backend via `routeJob(kind)` and dispatches
 * to the provider registered for that backend. No vendor SDK touches app code
 * (§11/§74.12).
 *
 * Every start carries a typed `ProjectSitesJobContext` (tenant/trace/idempotency,
 * §21) and is idempotent by `idempotencyKey` (§23): re-starting with the same key
 * returns the SAME `JobRef`, never a duplicate. Real backend adapters
 * (CloudflareWorkflowProvider / InngestProvider / HatchetProvider) implement the
 * same port — a follow-on slice; this lands the contract + the testable fake.
 *
 * @see docs/adr/0003-cloudflare-workflows-inngest-hatchet-routing.md
 */

import {
  routeJob,
  type JobKind,
  type WorkflowBackend,
  JOB_DEFINITIONS,
} from './workflow-router.js';

/** Lifecycle of a dispatched job. */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Per-job execution context (convergence §21). */
export interface ProjectSitesJobContext {
  readonly tenantId?: string;
  readonly siteId?: string;
  readonly userId?: string;
  readonly accountId?: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly idempotencyKey: string;
  readonly source: 'api' | 'webhook' | 'cron' | 'admin' | 'agent' | 'system';
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
  readonly plan?: 'free' | 'presence' | 'growth' | 'concierge' | 'enterprise';
  readonly createdAt: string;
}

/** Handle returned when a job is started. */
export interface JobRef {
  readonly jobId: string;
  readonly kind: JobKind;
  readonly backend: WorkflowBackend;
  readonly status: JobStatus;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

/** Thrown when a job context is missing a required field. */
export class JobContextError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'JobContextError';
  }
}

/**
 * Assert a context carries the fields a job needs before dispatch. Tenant is
 * required only when the job's definition says so (`requiresTenant`).
 *
 * @throws {JobContextError} on the first missing required field.
 * @example validateJobContext('site-generation', ctx) // ok | throws
 */
export function validateJobContext(kind: JobKind, ctx: ProjectSitesJobContext): void {
  if (!ctx.idempotencyKey)
    throw new JobContextError('idempotencyKey is required', 'idempotencyKey');
  if (!ctx.traceId) throw new JobContextError('traceId is required', 'traceId');
  if (!ctx.requestId) throw new JobContextError('requestId is required', 'requestId');
  if (!ctx.source) throw new JobContextError('source is required', 'source');
  if (JOB_DEFINITIONS[kind].requiresTenant && !ctx.tenantId) {
    throw new JobContextError(`tenantId is required for job "${kind}"`, 'tenantId');
  }
}

/** The job dispatch port (§20). Backend adapters + the fake implement this. */
export interface ProjectSitesJobProvider {
  /** Start a job; idempotent by `ctx.idempotencyKey`. */
  start(kind: JobKind, ctx: ProjectSitesJobContext, payload?: unknown): Promise<JobRef>;
  getJobStatus(jobId: string): Promise<JobStatus | null>;
  cancelJob(jobId: string): Promise<void>;
}

interface FakeJobRecord {
  ref: JobRef;
  payload: unknown;
}

/**
 * In-memory, deterministic provider for tests + the §16 no-vendor local golden
 * path. Idempotent: same `idempotencyKey` → same `JobRef` (no duplicate dispatch).
 * Jobs report `queued` until advanced via {@link FakeJobProvider.complete}.
 */
export class FakeJobProvider implements ProjectSitesJobProvider {
  private readonly byKey = new Map<string, FakeJobRecord>();
  private readonly byId = new Map<string, FakeJobRecord>();

  async start(kind: JobKind, ctx: ProjectSitesJobContext, payload?: unknown): Promise<JobRef> {
    validateJobContext(kind, ctx);
    const existing = this.byKey.get(ctx.idempotencyKey);
    if (existing) return existing.ref; // idempotent replay — no duplicate

    const { backend } = routeJob(kind);
    const jobId = `fake_${kind}_${ctx.idempotencyKey}`;
    const ref: JobRef = {
      jobId,
      kind,
      backend,
      status: 'queued',
      idempotencyKey: ctx.idempotencyKey,
      createdAt: ctx.createdAt,
    };
    const record: FakeJobRecord = { ref, payload };
    this.byKey.set(ctx.idempotencyKey, record);
    this.byId.set(jobId, record);
    return ref;
  }

  async getJobStatus(jobId: string): Promise<JobStatus | null> {
    return this.byId.get(jobId)?.ref.status ?? null;
  }

  async cancelJob(jobId: string): Promise<void> {
    const rec = this.byId.get(jobId);
    if (rec) rec.ref = { ...rec.ref, status: 'cancelled' };
  }

  /** Test helper: advance a job to a terminal/intermediate status. */
  complete(jobId: string, status: JobStatus = 'completed'): void {
    const rec = this.byId.get(jobId);
    if (rec) rec.ref = { ...rec.ref, status };
  }

  /** Test helper: how many distinct jobs were started. */
  get size(): number {
    return this.byId.size;
  }
}

/**
 * Build a job router from a backend→provider map. `start(kind, ctx, payload)`
 * resolves the backend via {@link routeJob} and dispatches to the matching
 * provider — the single seam between app code and execution planes.
 *
 * @throws {Error} if no provider is registered for the resolved backend.
 * @example
 * const router = createJobRouter({ 'hatchet': fake, 'inngest': fake, 'cloudflare-workflows': fake });
 * await router.start('site-generation', ctx); // → dispatched to the hatchet provider
 */
export function createJobRouter(
  providers: Partial<Record<WorkflowBackend, ProjectSitesJobProvider>>,
): ProjectSitesJobProvider {
  function providerFor(backend: WorkflowBackend): ProjectSitesJobProvider {
    const p = providers[backend];
    if (!p) throw new Error(`No job provider registered for backend "${backend}"`);
    return p;
  }
  return {
    async start(kind, ctx, payload) {
      const { backend } = routeJob(kind);
      return providerFor(backend).start(kind, ctx, payload);
    },
    async getJobStatus(jobId) {
      for (const p of Object.values(providers)) {
        const s = await p!.getJobStatus(jobId);
        if (s !== null) return s;
      }
      return null;
    },
    async cancelJob(jobId) {
      await Promise.all(Object.values(providers).map((p) => p!.cancelJob(jobId)));
    },
  };
}
