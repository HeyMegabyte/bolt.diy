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
    backendPreference: z.enum(['cloudflare', 'browserbase', 'skyvern_internal']).optional(),
    specialty: z
      .enum(['captcha', 'residential_proxy', 'session_replay', 'live_view', 'long_session', 'stealth'])
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
      return c.json(routeBrowserJob(purpose, parsed.data, c.env), 202);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        return c.json({ error: { code: 'BROWSER_PROVIDER_UNAVAILABLE', message: err.message } }, 503);
      }
      throw err;
    }
  });
}
