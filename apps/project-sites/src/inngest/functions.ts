/**
 * @module inngest/functions
 *
 * @description
 * Inngest durable functions served to the self-hosted server for the
 * `jobs.`/`events.projectsites.dev` plane (convergence prompt §13).
 *
 * Functions here are invoked by the Inngest server over HTTP (via the
 * `inngest/hono` serve handler at `/api/inngest`). Each is durable + retried +
 * step-checkpointed by the server. Keep them thin — they orchestrate, the
 * services do the work.
 */

import { inngest } from './client.js';
import { getRequestEnv } from './request-env.js';
import { handleEmailRequested, type EmailRequestedData } from './handlers.js';
import type { EmailDeps } from '../platform/email-router.js';
import type { Env } from '../types/env.js';

/**
 * Durable post-publish fan-out: fires when a site finishes generating.
 * Step 1 records the structured completion log; later steps can notify
 * (Novu/Listmonk), warm caches, or kick SEO re-audit — each its own retried
 * step. This is the canonical wiring example for the plane.
 *
 * @remarks Replaces the fire-and-forget `ctx.waitUntil` path with a durable,
 * retried, observable step function. Emit the trigger from the build pipeline
 * via `inngest.send({ name: 'site/generation.completed', data })`.
 */
export const siteGenerationCompleted = inngest.createFunction(
  {
    id: 'site-generation-completed',
    name: 'Site generation completed',
    triggers: [{ event: 'site/generation.completed' }],
  },
  async ({ event, step }) => {
    const { siteId, slug, orgId, durationMs } = event.data as {
      siteId: string;
      slug: string;
      orgId: string;
      durationMs?: number;
    };

    await step.run('record-completion', async () => {
      // Structured log carries the plane + correlation fields (drift-detection).
      console.warn(
        JSON.stringify({
          level: 'info',
          plane: 'jobs',
          event: 'site/generation.completed',
          siteId,
          slug,
          orgId,
          durationMs: durationMs ?? null,
        }),
      );
      return { recorded: true };
    });

    return { ok: true, siteId, slug };
  },
);

/**
 * Step body for the lifecycle-email function — extracted so it is unit-testable
 * WITHOUT the Inngest step harness. Reads the request `Env` from the ALS context
 * ({@link getRequestEnv}, established by the serve wrapper) and delegates to the
 * already-tested `handleEmailRequested` consumer, which routes through
 * `getEmailProvider(env)` (SES in prod, fake locally).
 *
 * @param data - The `job/email.requested` event `data` ({@link EmailRequestedData}).
 * @param deps - Injectable email provider (tests pass a fake transactional rail).
 * @returns `{ sent, id, accepted }` from the underlying `EmailResult`.
 * @throws {EmailEventError} when the payload lacks to/subject/html.
 * @throws {InngestEnvError} when run outside a `runWithRequestEnv` context.
 * @example await runLifecycleEmail(event.data);
 */
export async function runLifecycleEmail(
  data: EmailRequestedData,
  deps: EmailDeps = {},
): Promise<{ sent: boolean; id: string; accepted: boolean }> {
  const result = await handleEmailRequested(getRequestEnv(), data, deps);
  return { sent: result.accepted, id: result.id, accepted: result.accepted };
}

/**
 * Durable lifecycle-email function: drains the `job/email.requested` event the
 * `InngestJobProvider` dispatches (golden-path "customer notified" step, §9).
 * One retried, step-checkpointed send through the env-selected email rail.
 *
 * @remarks Live-inert until the §13 watched deploy binds the Inngest server +
 * secrets — registration is harmless (the serve route 503s without a signing
 * key). `env` reaches the step via the ALS context the serve wrapper sets.
 */
export const lifecycleEmail = inngest.createFunction(
  {
    id: 'lifecycle-email',
    name: 'Lifecycle email',
    triggers: [{ event: 'job/email.requested' }],
  },
  async ({ event, step }) => {
    return step.run('send-transactional', () =>
      runLifecycleEmail(event.data as EmailRequestedData),
    );
  },
);

/** Every function the worker serves to the self-hosted Inngest server. */
export const inngestFunctions = [siteGenerationCompleted, lifecycleEmail] as const;

/** Re-exported so the serve route + tests share one source of truth. */
export type InngestFunctions = typeof inngestFunctions;
export type { Env };
