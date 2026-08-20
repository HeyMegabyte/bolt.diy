/**
 * @module platform/job-router-factory
 *
 * @description
 * `getJobRouter(env)` — assembles the backend adapters (CF Workflows ·
 * Hatchet) into a single `ProjectSitesJobProvider` via `createJobRouter`.
 * This is the one place the worker builds the job dispatch seam from `Env`; route
 * handlers + queue consumers call `getJobRouter(env).start(kind, ctx, payload)`
 * and never touch a vendor SDK (§11/§20/§74.12).
 *
 * (Inngest REMOVED 2026-08-20 — §13 self-hosted plane replaced by CF-native
 * outbox → Hatchet Cloud; its event-driven jobs were retargeted to Workflows.)
 *
 * Dependencies are injectable (`deps`) with env-bound defaults: prod calls
 * `getJobRouter(env)`; tests pass fakes to assert wiring without real I/O.
 *
 * CF Workflow bindings for claim-flow/billing-lifecycle/domain-verification/
 * performance-audit do not exist yet — the CF provider starts with an empty
 * binding map, so those kinds throw a clear "no binding" error until their
 * Workflow classes land (graceful, not silent). Hatchet is live.
 *
 * @see docs/adr/0003-cloudflare-workflows-inngest-hatchet-routing.md
 */

import type { Env } from '../types/env.js';
import type { JobKind } from './workflow-router.js';
import { createJobRouter, type ProjectSitesJobProvider } from './job-provider.js';
import { CloudflareWorkflowProvider, type CfWorkflowBinding } from '../workflows/job-provider.js';
import { HatchetJobProvider, type HatchetPusher } from '../services/hatchet_job_provider.js';
import { pushHatchetEvent } from '../services/hatchet.js';

/** Injectable seams (each defaults to an `env`-bound real implementation). */
export interface JobRouterDeps {
  readonly hatchetPush?: HatchetPusher;
  readonly cfBindings?: Partial<Record<JobKind, CfWorkflowBinding>>;
}

/** Map CF-native job kinds → the worker's CF Workflow bindings that exist today. */
function defaultCfBindings(_env: Env): Partial<Record<JobKind, CfWorkflowBinding>> {
  // No claim-flow/billing-lifecycle/domain-verification/performance-audit Workflow
  // classes are bound yet — return {} so those kinds fail loudly ("no binding")
  // rather than silently. Wire each here as its Workflow class is added.
  return {};
}

/**
 * Build the platform job router from `Env`. The single seam between app code and
 * the three execution planes.
 *
 * @example
 * const router = getJobRouter(c.env);
 * await router.start('site-generation', ctx, { slug });
 */
export function getJobRouter(env: Env, deps: JobRouterDeps = {}): ProjectSitesJobProvider {
  const hatchetPush: HatchetPusher =
    deps.hatchetPush ?? ((key, data, opts) => pushHatchetEvent(env, key, data, opts));

  const cfBindings = deps.cfBindings ?? defaultCfBindings(env);

  return createJobRouter({
    'cloudflare-workflows': new CloudflareWorkflowProvider(cfBindings),
    hatchet: new HatchetJobProvider(hatchetPush),
  });
}
