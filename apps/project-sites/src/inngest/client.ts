/**
 * @module inngest/client
 *
 * @description
 * Inngest SDK client for the `jobs.`/`events.projectsites.dev` automation plane
 * (convergence prompt §13). Points at the SELF-HOSTED Inngest server running in
 * the `InngestContainer` Durable Object — NOT Inngest Cloud (LAW-clean).
 *
 * Cloudflare Workers have no ambient `process.env`, so the event key / signing
 * key / base URL are injected per-request via `inngest.setEnvVars(c.env)` in the
 * serve + send paths (see `src/inngest/serve.ts`).
 *
 * @see https://www.inngest.com/docs/learn/serving-inngest-functions
 */

import { Inngest } from 'inngest';

/**
 * Singleton Inngest client. `id` is the app slug the self-hosted server keys
 * function registration on. Base URL + keys are set per-request via
 * `setEnvVars` (Workers have no global `process.env`).
 */
export const inngest = new Inngest({ id: 'projectsites' });

/** Event name → payload contract for type-safe `inngest.send(...)`. */
export interface PlatformEvents {
  'site/generation.completed': {
    data: { siteId: string; slug: string; orgId: string; durationMs?: number };
  };
}
