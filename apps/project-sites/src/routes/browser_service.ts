/**
 * `browser.projectsites.dev` — the product browser-automation abstraction
 * (Cloudflare-first doctrine §5/§8).
 *
 * @remarks
 * Product + agent code calls THIS service — never Browserbase or Skyvern
 * directly. Each `/v1/browser/*` job is tenant-scoped, Zod-validated, and routed
 * through the gateway LAW (`browser_gateway.chooseBrowserProvider`): CF Browser
 * Run + Playwright/Stagehand by default → Browserbase only on a specialty/explicit
 * preference → `skyvern_internal` only when an internal/admin job explicitly asks.
 * This module owns the contract + routing; browser EXECUTION (screenshot/pdf via
 * CF Browser Run, output to R2) is wired behind it as the next sub-slice.
 *
 * @see docs/architecture/browser-automation.md
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import {
  chooseBrowserProvider,
  BrowserGatewayError,
  type BrowserProvider,
  type BrowserRequestOptions,
  type BrowserSpecialty,
} from '../services/browser_gateway.js';
import { cfBrowserRunner, runArtifactJob } from '../services/browser_execution.js';

/** Resolve the target URL for an artifact job (explicit url → https://hostname). */
function artifactTargetUrl(job: BrowserJob): string | null {
  if (job.url) return job.url;
  if (job.hostname) return `https://${job.hostname}`;
  return null;
}

/** The job purposes exposed as `/v1/browser/{purpose}`. */
export const BROWSER_PURPOSES = [
  'screenshot',
  'pdf',
  'qa',
  'form-test',
  'extract',
  'visual-check',
  'metadata',
  'health-check',
  'stagehand',
] as const;
export type BrowserPurpose = (typeof BROWSER_PURPOSES)[number];

/** The job contract (doctrine §8). `backendPreference` uses the public spelling. */
export const BrowserJobSchema = z
  .object({
    tenantId: z.string().min(1),
    siteId: z.string().min(1),
    hostname: z.string().optional(),
    /** Target URL for screenshot/pdf/extract jobs (else derived from hostname). */
    url: z.string().url().optional(),
    backendPreference: z.enum(['cloudflare', 'browserbase', 'skyvern_internal']).optional(),
    specialty: z
      .enum([
        'captcha',
        'residential_proxy',
        'session_replay',
        'live_view',
        'long_session',
        'stealth',
      ])
      .optional(),
    budgetCents: z.number().int().min(0).optional(),
    timeoutMs: z.number().int().min(1).max(120_000).optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
  })
  .strict();

export type BrowserJob = z.infer<typeof BrowserJobSchema>;

/** Map the public `backendPreference` to the gateway's provider id. */
function mapBackend(pref: BrowserJob['backendPreference']): BrowserProvider | undefined {
  if (pref === 'cloudflare') return 'cf';
  if (pref === 'browserbase') return 'browserbase';
  if (pref === 'skyvern_internal') return 'skyvern_internal';
  return undefined;
}

/**
 * Route a validated job to a provider via the gateway LAW.
 * @returns The routed envelope (provider + reason + purpose), tenant-scoped.
 */
export function routeBrowserJob(purpose: BrowserPurpose, job: BrowserJob, env: Env) {
  const opts: BrowserRequestOptions = {
    backendPreference: mapBackend(job.backendPreference),
    specialty: job.specialty as BrowserSpecialty | undefined,
  };
  const decision = chooseBrowserProvider(opts, env);
  return {
    status: 'routed' as const,
    purpose,
    provider: decision.provider,
    reason: decision.reason,
    tenantId: job.tenantId,
    siteId: job.siteId,
  };
}

export const browserService = new Hono<{ Bindings: Env; Variables: Variables }>();

for (const purpose of BROWSER_PURPOSES) {
  browserService.post(`/v1/browser/${purpose}`, async (c) => {
    const parsed = BrowserJobSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    try {
      const routed = routeBrowserJob(purpose, parsed.data, c.env);

      // screenshot/pdf EXECUTE on CF Browser Run; other purposes return the
      // routed envelope (execution wired in later sub-slices).
      if (
        (purpose === 'screenshot' || purpose === 'pdf') &&
        routed.provider === 'cf' &&
        c.env.BROWSER
      ) {
        const target = artifactTargetUrl(parsed.data);
        if (!target) {
          return c.json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'screenshot/pdf needs `url` or `hostname`.',
              },
            },
            400,
          );
        }
        const startMs = Date.now();
        const { runner, release } = await cfBrowserRunner(c.env);
        try {
          const result = await runArtifactJob(
            c.env,
            purpose,
            { tenantId: parsed.data.tenantId, siteId: parsed.data.siteId, url: target },
            runner,
            String(Date.now()),
          );
          return c.json({ ...routed, ...result }, 200);
        } finally {
          await release();
          // Meter browser usage through StripeMetersProvider (Metronome-compatible).
          const { meterCompletedBrowserJob } = await import('../services/browser_gateway.js');
          void meterCompletedBrowserJob(c.env, {
            orgId: parsed.data.tenantId,
            siteId: parsed.data.siteId,
            startMs,
            purpose,
          });
        }
      }

      return c.json(routed, 202);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        return c.json(
          { error: { code: 'BROWSER_PROVIDER_UNAVAILABLE', message: err.message } },
          503,
        );
      }
      throw err;
    }
  });
}
