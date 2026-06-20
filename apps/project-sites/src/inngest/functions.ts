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

/** Every function the worker serves to the self-hosted Inngest server. */
export const inngestFunctions = [siteGenerationCompleted] as const;

/** Re-exported so the serve route + tests share one source of truth. */
export type InngestFunctions = typeof inngestFunctions;
export type { Env };
