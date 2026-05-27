/**
 * Workers Queues producer wrapper.
 *
 * @remarks
 *  Single binding `JOB_QUEUE` named `projectsites-jobs`. Every async/long-running
 *  task in the control-plane fans out through here so the request thread stays
 *  under the 50ms CPU budget. Consumer in `src/index.ts queue()` dispatches on
 *  `job.type`.
 *
 *  Known job types:
 *   - `snapshot` — R2 snapshot of a tenant site (fires from weekly cron)
 *   - `email`    — outbound transactional email (Resend / SendGrid)
 *   - `image-process` — Sharp-on-Container DO triplet AVIF/WebP/JPEG generation
 *
 *  Add new types by extending `JobPayloadMap` below.
 *
 * @example
 *   await enqueue(c.env, { type: 'snapshot', payload: { site_id: 'abc' } });
 */

import type { Env } from '../env.js';

/** Per-job-type payload shape. Extend here when wiring new queue jobs. */
export interface JobPayloadMap {
  snapshot: {
    site_id: string;
    tenant_id: string;
    slug: string;
    reason: 'weekly_auto' | 'manual' | 'pre_deploy';
    requested_at: string;
  };
  email: {
    to: string;
    template: string;
    vars: Record<string, unknown>;
    tenant_id?: string;
  };
  'image-process': {
    site_id: string;
    r2_input_key: string;
    r2_output_prefix: string;
    formats: ReadonlyArray<'avif' | 'webp' | 'jpeg'>;
  };
}

export type JobType = keyof JobPayloadMap;

export interface Job<T extends JobType = JobType> {
  type: T;
  payload: JobPayloadMap[T];
}

/**
 * Minimal Queue producer shape — keeps this file independent of the global
 * `@cloudflare/workers-types` install so it compiles in CI envs that haven't
 * pulled types yet. The runtime binding satisfies the same shape.
 */
interface QueueProducerLike {
  send(message: unknown, options?: { delaySeconds?: number }): Promise<void>;
}

interface EnvWithQueue extends Env {
  /** Wired when wrangler.jsonc declares `[[queues.producers]]` for `projectsites-jobs`. */
  JOB_QUEUE?: QueueProducerLike;
}

/**
 * Enqueue a job. When the `JOB_QUEUE` binding is missing (local dev without
 * `--queue`, or staging with queues disabled), the call is a no-op + warns.
 * Callers must remain resilient — the queue is fire-and-forget by contract.
 */
export async function enqueue<T extends JobType>(
  env: Env,
  job: Job<T>,
  options?: { delaySeconds?: number },
): Promise<void> {
  const e = env as EnvWithQueue;
  if (!e.JOB_QUEUE) {
    console.warn(`[queue] JOB_QUEUE binding missing; dropping job ${job.type}`);
    return;
  }
  await e.JOB_QUEUE.send(
    {
      type: job.type,
      payload: job.payload,
      enqueued_at: new Date().toISOString(),
    },
    options,
  );
}

/** Type-narrowing helper for the consumer side. */
export function isJob<T extends JobType>(body: unknown, type: T): body is Job<T> {
  return (
    typeof body === 'object' &&
    body !== null &&
    'type' in body &&
    (body as { type: unknown }).type === type
  );
}
