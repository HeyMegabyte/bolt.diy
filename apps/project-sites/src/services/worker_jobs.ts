/**
 * @module services/worker_jobs
 * @description Worker job dispatcher types and factory helpers.
 * Pure functions — never throws, never touches I/O.
 */

export type JobNamespace = 'email' | 'build' | 'analytics' | 'social' | 'cleanup';

export interface JobDefinition {
  namespace: JobNamespace;
  name: string;
  payload: Record<string, unknown>;
  priority: 1 | 2 | 3;
  maxRetries: number;
  timeoutMs: number;
}

/**
 * Default timeouts (ms) per job namespace.
 * These are safe defaults — callers may override via the `timeoutMs` parameter
 * on {@link createJob} if a specific job needs a different window.
 */
export const DEFAULT_TIMEOUTS: Record<JobNamespace, number> = Object.freeze({
  analytics: 60_000,
  build: 300_000,
  cleanup: 120_000,
  email: 30_000,
  social: 60_000,
});

const DEFAULT_MAX_RETRIES: Record<JobNamespace, number> = Object.freeze({
  analytics: 1,
  build: 2,
  cleanup: 2,
  email: 3,
  social: 3,
});

/**
 * Creates a typed {@link JobDefinition} from the required inputs.
 * Optional fields fall back to safe defaults: `priority` defaults to `2`,
 * `timeoutMs` defaults from {@link DEFAULT_TIMEOUTS}, `maxRetries` from
 * namespace defaults.
 *
 * @param ns    - Job category (email, build, analytics, social, cleanup)
 * @param name  - Short descriptor, unique within the namespace for dedup
 * @param payload - Arbitrary JSON-serialisable data the worker will process
 * @param priority - 1 (highest), 2 (default), 3 (lowest)
 * @returns A fully-populated {@link JobDefinition}
 * @example
 * const job = createJob('email', 'welcome', { to: 'a@b.com' }, 1);
 * // → { namespace:'email', name:'welcome', payload:{to:'a@b.com'}, priority:1,
 * //     maxRetries:3, timeoutMs:30000 }
 */
export function createJob(
  ns: JobNamespace,
  name: string,
  payload: Record<string, unknown>,
  priority?: 1 | 2 | 3,
): JobDefinition {
  const defaults = DEFAULT_TIMEOUTS[ns];
  const retries = DEFAULT_MAX_RETRIES[ns];
  return {
    maxRetries: retries,
    name,
    namespace: ns,
    payload,
    priority: priority ?? 2,
    timeoutMs: defaults,
  };
}

/**
 * Returns a stable dedup key for a job: `"namespace:name"`.
 *
 * @param job - The job to key
 * @returns `"{namespace}:{name}"` — safe for use as a queue dedup / idempotency key
 * @example
 * jobKey(createJob('email', 'welcome', {})) // → "email:welcome"
 */
export function jobKey(job: JobDefinition): string {
  return `${job.namespace}:${job.name}`;
}
