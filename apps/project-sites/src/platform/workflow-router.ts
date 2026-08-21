/**
 * @module platform/workflow-router
 *
 * @description
 * The WorkflowRouter (convergence §20 / §12) — the single decision point for
 * WHICH execution backend runs each async job. Application code calls
 * `routeJob(kind)` (or `chooseWorkflowBackend(flags)`), never a workflow vendor
 * directly (§11/§74.12). Backends, in preference order (§19/§76):
 *
 *   1. cloudflare-workflows — CF-native durable orchestration (claim flow,
 *      billing lifecycle, domain verification, single audits). First choice.
 *   2. hatchet — heavy/stateful/long/browser/AI execution (site generation,
 *      bulk scans, screenshots, crawls). Hatchet Cloud, never Fly (ADR-0004).
 *
 * Two execution planes: CF Workflows (light/native) and Hatchet Cloud
 * (heavy/stateful/browser). Pure + deterministic → fully unit-testable, no I/O.
 * Backend adapters (CloudflareWorkflowProvider / HatchetProvider) plug in here.
 *
 * @see docs/decisions/0034-platform-consolidation-cf-native.md
 */

/** The execution planes, in preference order. */
export type WorkflowBackend = 'cloudflare-workflows' | 'hatchet';

/** Cost bucket for entitlement/quota accounting (§21/§31). */
export type CostCategory =
  | 'ai'
  | 'browser'
  | 'google-api'
  | 'email'
  | 'webhook'
  | 'storage'
  | 'workflow'
  | 'none';

export type JobPriority = 'low' | 'normal' | 'high' | 'urgent';

/** Routing-relevant shape of a job (drives `chooseWorkflowBackend`). */
export interface JobRoutingFlags {
  readonly kind: string;
  readonly needsHeavyRuntime?: boolean;
  readonly needsBrowser?: boolean;
  readonly needsFilesystem?: boolean;
  readonly needsLongRunningSession?: boolean;
  readonly needsStatefulSession?: boolean;
  readonly isProductEventDriven?: boolean;
  readonly isCloudflareNative?: boolean;
  readonly canUseWorkflowWaits?: boolean;
  readonly expectedDurationSeconds?: number;
  readonly fanoutCount?: number;
  readonly priority?: JobPriority;
}

/**
 * Choose the execution backend for a job (convergence §20 selection logic).
 * CF-native + light → Workflows; everything heavy/stateful/browser/filesystem
 * → Hatchet.
 *
 * @example chooseWorkflowBackend({ kind: 'claim-flow', isCloudflareNative: true }) // 'cloudflare-workflows'
 * @example chooseWorkflowBackend({ kind: 'site-generation', needsHeavyRuntime: true }) // 'hatchet'
 */
export function chooseWorkflowBackend(job: JobRoutingFlags): WorkflowBackend {
  if (
    job.isCloudflareNative &&
    !job.needsHeavyRuntime &&
    !job.needsBrowser &&
    !job.needsFilesystem &&
    !job.needsStatefulSession
  ) {
    return 'cloudflare-workflows';
  }

  return 'hatchet';
}

/** A declared platform job kind + its routing/reliability contract (§20). */
export interface JobDefinition extends JobRoutingFlags {
  readonly kind: string;
  readonly defaultBackend: WorkflowBackend;
  readonly maxHotPathMs: number;
  readonly expectedDurationSeconds: number;
  readonly maxRetries: number;
  readonly timeoutSeconds: number;
  readonly priority: JobPriority;
  readonly requiresTenant: boolean;
  readonly requiresIdempotency: boolean;
  readonly producesArtifacts: boolean;
  readonly costCategory: CostCategory;
}

/**
 * The registry of every async job the platform runs (the §20 `ProjectSitesJobProvider`
 * surface, as declarative definitions). `defaultBackend` is asserted to equal
 * `chooseWorkflowBackend(def)` by the unit tests — the policy and the declaration
 * can never silently diverge.
 */
export const JOB_DEFINITIONS = {
  // ── Cloudflare Workflows — CF-native, light, durable ──
  'claim-flow': {
    kind: 'claim-flow',
    isCloudflareNative: true,
    canUseWorkflowWaits: true,
    defaultBackend: 'cloudflare-workflows',
    maxHotPathMs: 500,
    expectedDurationSeconds: 30,
    maxRetries: 3,
    timeoutSeconds: 300,
    priority: 'high',
    requiresTenant: true,
    requiresIdempotency: true,
    producesArtifacts: false,
    costCategory: 'workflow',
  },
  'billing-lifecycle': {
    kind: 'billing-lifecycle',
    isCloudflareNative: true,
    canUseWorkflowWaits: true,
    defaultBackend: 'cloudflare-workflows',
    maxHotPathMs: 250,
    expectedDurationSeconds: 20,
    maxRetries: 5,
    timeoutSeconds: 600,
    priority: 'high',
    requiresTenant: true,
    requiresIdempotency: true,
    producesArtifacts: false,
    costCategory: 'none',
  },
  'domain-verification': {
    kind: 'domain-verification',
    isCloudflareNative: true,
    canUseWorkflowWaits: true,
    defaultBackend: 'cloudflare-workflows',
    maxHotPathMs: 250,
    expectedDurationSeconds: 120,
    maxRetries: 10,
    timeoutSeconds: 86400,
    priority: 'normal',
    requiresTenant: true,
    requiresIdempotency: true,
    producesArtifacts: false,
    costCategory: 'none',
  },
  'performance-audit': {
    kind: 'performance-audit',
    isCloudflareNative: true,
    defaultBackend: 'cloudflare-workflows',
    maxHotPathMs: 250,
    expectedDurationSeconds: 45,
    maxRetries: 3,
    timeoutSeconds: 120,
    priority: 'low',
    requiresTenant: true,
    requiresIdempotency: true,
    producesArtifacts: true,
    costCategory: 'google-api',
  },

  // ── CF-native event-driven workflows (routed to cloudflare-workflows) ──────
  'notification-workflow': {
    kind: 'notification-workflow',
    isCloudflareNative: true,
    defaultBackend: 'cloudflare-workflows',
    maxHotPathMs: 250,
    expectedDurationSeconds: 15,
    maxRetries: 5,
    timeoutSeconds: 120,
    priority: 'normal',
    requiresTenant: true,
    requiresIdempotency: true,
    producesArtifacts: false,
    costCategory: 'none',
  },
  'lifecycle-email': {
    kind: 'lifecycle-email',
    isCloudflareNative: true,
    defaultBackend: 'cloudflare-workflows',
    maxHotPathMs: 250,
    expectedDurationSeconds: 15,
    maxRetries: 5,
    timeoutSeconds: 120,
    priority: 'normal',
    requiresTenant: true,
    requiresIdempotency: true,
    producesArtifacts: false,
    costCategory: 'email',
  },

  // ── Hatchet Cloud — heavy / stateful / browser / long-running ──
  'site-generation': {
    kind: 'site-generation',
    needsHeavyRuntime: true,
    needsFilesystem: true,
    needsStatefulSession: true,
    defaultBackend: 'hatchet',
    maxHotPathMs: 500,
    expectedDurationSeconds: 1800,
    maxRetries: 2,
    timeoutSeconds: 3600,
    priority: 'high',
    requiresTenant: true,
    requiresIdempotency: true,
    producesArtifacts: true,
    costCategory: 'ai',
  },
  'lead-scan': {
    kind: 'lead-scan',
    needsHeavyRuntime: true,
    fanoutCount: 1000,
    defaultBackend: 'hatchet',
    maxHotPathMs: 500,
    expectedDurationSeconds: 600,
    maxRetries: 3,
    timeoutSeconds: 1800,
    priority: 'low',
    requiresTenant: false,
    requiresIdempotency: true,
    producesArtifacts: true,
    costCategory: 'google-api',
  },
  'screenshot-job': {
    kind: 'screenshot-job',
    needsBrowser: true,
    defaultBackend: 'hatchet',
    maxHotPathMs: 500,
    expectedDurationSeconds: 60,
    maxRetries: 3,
    timeoutSeconds: 180,
    priority: 'normal',
    requiresTenant: true,
    requiresIdempotency: true,
    producesArtifacts: true,
    costCategory: 'browser',
  },
  'crawl-job': {
    kind: 'crawl-job',
    needsHeavyRuntime: true,
    defaultBackend: 'hatchet',
    maxHotPathMs: 500,
    expectedDurationSeconds: 300,
    maxRetries: 3,
    timeoutSeconds: 900,
    priority: 'normal',
    requiresTenant: true,
    requiresIdempotency: true,
    producesArtifacts: true,
    costCategory: 'browser',
  },
  'browser-job': {
    kind: 'browser-job',
    needsBrowser: true,
    needsStatefulSession: true,
    defaultBackend: 'hatchet',
    maxHotPathMs: 500,
    expectedDurationSeconds: 300,
    maxRetries: 2,
    timeoutSeconds: 900,
    priority: 'normal',
    requiresTenant: true,
    requiresIdempotency: true,
    producesArtifacts: true,
    costCategory: 'browser',
  },
} as const satisfies Record<string, JobDefinition>;

/** Every declared job kind (string-literal union). */
export type JobKind = keyof typeof JOB_DEFINITIONS;

/** Result of routing a job: its definition + the resolved backend. */
export interface RoutedJob {
  readonly definition: JobDefinition;
  readonly backend: WorkflowBackend;
}

/**
 * Route a declared job kind to its execution backend. The backend is RECOMPUTED
 * from the definition's routing flags via `chooseWorkflowBackend` (not blindly
 * trusting `defaultBackend`), so the live policy always governs.
 *
 * @throws {Error} if `kind` is not a declared job.
 * @example routeJob('site-generation').backend // 'hatchet'
 */
export function routeJob(kind: JobKind): RoutedJob {
  const definition = JOB_DEFINITIONS[kind];
  if (!definition) throw new Error(`Unknown job kind: ${kind}`);
  return { definition, backend: chooseWorkflowBackend(definition) };
}

/** True when `kind` is a declared job. */
export function isJobKind(kind: string): kind is JobKind {
  return Object.prototype.hasOwnProperty.call(JOB_DEFINITIONS, kind);
}
