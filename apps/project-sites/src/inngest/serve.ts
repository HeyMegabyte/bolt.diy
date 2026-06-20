/**
 * @module inngest/serve
 *
 * @description
 * Hono routes for the `jobs.`/`events.projectsites.dev` automation plane
 * (convergence prompt §13). Two surfaces, both safe-but-inert until the
 * `InngestContainer` DO + secrets go live (watched deploy):
 *
 * 1. **SDK callback** `/(api/inngest)` on the main worker host — the
 *    `inngest/hono` `serve()` endpoint the self-hosted server invokes to run
 *    the worker's durable functions. Returns 503 (not a throw) when the signing
 *    key isn't configured yet, so the route ships dark without breaking deploys.
 * 2. **Server dashboard/API** on `jobs.`/`events.projectsites.dev` — proxied to
 *    the `InngestContainer` DO. Returns a friendly 503 landing when the binding
 *    isn't bound yet (mirrors the `EventDispatcher` /api/events graceful-degrade
 *    so analytics-style routes stay live-safe pre-binding).
 *
 * Mount BEFORE the site-serving catch-all in `index.ts`.
 */

import { Hono } from 'hono';
import { serve } from 'inngest/hono';
import { DOMAINS } from '@project-sites/shared';
import type { Env } from '../types/env.js';
import { inngest } from './client.js';
import { inngestFunctions } from './functions.js';
import { runWithRequestEnv } from './request-env.js';

/** Hosts that address the self-hosted Inngest server (the container). */
function isInngestServerHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === `jobs.${DOMAINS.SITES_BASE}` || h === `events.${DOMAINS.SITES_BASE}`;
}

/** Singleton serve handler — `setEnvVars(c.env)` runs per-request before it. */
const inngestServeHandler = serve({ client: inngest, functions: inngestFunctions });

export const inngestApp = new Hono<{ Bindings: Env }>();

// ── Server dashboard/API: jobs./events.projectsites.dev → InngestContainer DO ──
inngestApp.all('*', async (c, next) => {
  const hostname = c.req.header('host') ?? '';
  if (!isInngestServerHost(hostname)) return next();

  const binding = c.env.INNGEST_CONTAINER;
  if (!binding) {
    // Inert until the watched deploy binds the DO + builds the image.
    return c.json(
      {
        plane: 'jobs',
        status: 'provisioning',
        message:
          'Inngest server not yet bound. Go-live is a watched deploy (one-way DO migration).',
      },
      503,
    );
  }
  // One warm singleton instance serves the whole platform.
  const id = binding.idFromName('inngest-singleton');
  return binding.get(id).fetch(c.req.raw);
});

// ── SDK callback: /api/inngest on the main worker host ──
inngestApp.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  if (!c.env.INNGEST_SIGNING_KEY) {
    return c.json(
      { plane: 'jobs', status: 'provisioning', message: 'Inngest signing key not configured.' },
      503,
    );
  }
  // Workers have no process.env — thread the bound string secrets into the
  // client (filter to the string-valued INNGEST_* config; Env also holds DO
  // namespaces which setEnvVars must not receive).
  inngest.setEnvVars({
    INNGEST_EVENT_KEY: c.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: c.env.INNGEST_SIGNING_KEY,
    INNGEST_BASE_URL: c.env.INNGEST_BASE_URL,
  });
  // Bind c.env into the ALS context so env-DEPENDENT durable functions (e.g.
  // lifecycleEmail → getEmailProvider(env)) can read it via getRequestEnv().
  // Each Inngest step is its own HTTP POST re-entering this handler, so the env
  // is re-established per step invocation — concurrency-safe (no module global).
  return runWithRequestEnv(c.env, () => inngestServeHandler(c));
});
