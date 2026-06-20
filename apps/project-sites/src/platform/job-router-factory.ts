/**
 * @module platform/job-router-factory
 *
 * @description
 * `getJobRouter(env)` — assembles the three backend adapters (CF Workflows ·
 * Inngest · Hatchet) into a single `ProjectSitesJobProvider` via `createJobRouter`.
 * This is the one place the worker builds the job dispatch seam from `Env`; route
 * handlers + queue consumers call `getJobRouter(env).start(kind, ctx, payload)`
 * and never touch a vendor SDK (§11/§20/§74.12).
 *
 * Dependencies are injectable (`deps`) with env-bound defaults: prod calls
 * `getJobRouter(env)`; tests pass fakes to assert wiring without real I/O.
 *
 * CF Workflow bindings for claim-flow/billing-lifecycle/domain-verification/
 * performance-audit do not exist yet — the CF provider starts with an empty
 * binding map, so those kinds throw a clear "no binding" error until their
 * Workflow classes land (graceful, not silent). Inngest + Hatchet are live.
 *
 * @see docs/adr/0003-cloudflare-workflows-inngest-hatchet-routing.md
 */

import type { Env } from '../types/env.js';
import type { JobKind } from './workflow-router.js';
import { createJobRouter, type ProjectSitesJobProvider } from './job-provider.js';
import { InngestJobProvider, type InngestSender } from '../inngest/job-provider.js';
import {
  CloudflareWorkflowProvider,
  type CfWorkflowBinding,
} from '../workflows/job-provider.js';
import { HatchetJobProvider, type HatchetPusher } from '../services/hatchet_job_provider.js';
import { inngest } from '../inngest/client.js';
import { pushHatchetEvent } from '../services/hatchet.js';

/** Injectable seams (each defaults to an `env`-bound real implementation). */
export interface JobRouterDeps {
  readonly inngestSend?: InngestSender;
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
  const inngestSend: InngestSender =
    deps.inngestSend ?? {
      send: (event) => {
        // Workers have no process.env — thread the bound keys before sending.
        inngest.setEnvVars({
          INNGEST_EVENT_KEY: env.INNGEST_EVENT_KEY,
          INNGEST_BASE_URL: env.INNGEST_BASE_URL,
        });
        return inngest.send(event) as Promise<{ ids: string[] }>;
      },
    };

  const hatchetPush: HatchetPusher =
    deps.hatchetPush ?? ((key, data, opts) => pushHatchetEvent(env, key, data, opts));

  const cfBindings = deps.cfBindings ?? defaultCfBindings(env);

  return createJobRouter({
    'cloudflare-workflows': new CloudflareWorkflowProvider(cfBindings),
    inngest: new InngestJobProvider(inngestSend),
    hatchet: new HatchetJobProvider(hatchetPush),
  });
}
