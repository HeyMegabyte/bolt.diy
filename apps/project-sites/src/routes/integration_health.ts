/**
 * @module routes/integration_health
 * @description `GET /api/integrations/:name/health` — per-service health probe.
 *
 * Probes each configured integration (Listmonk, Twenty, Stripe, etc.) and
 * returns health signals using the pure scoring functions from
 * {@link ../services/integration_health.ts}. No auth required — this is a
 * lightweight operational endpoint.
 *
 * Both the per-service endpoint and the `/api/integrations/health` aggregate
 * build their signals through the SINGLE {@link buildSignal} function, so the
 * two can never diverge. (Historically the aggregate had its own degraded
 * switch that fell to a `default: unconfigured` branch and mis-reported live,
 * configured services — deepgram/unkey/langfuse/payload — as `unknown`, a
 * display-vs-source-of-truth divergence per rule verify-against-source-of-truth.)
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import {
  scoreConnectionHealth,
  aggregateConnectionHealth,
  type ConnectionSignal,
} from '../services/integration_health.js';
import { listmonkHealth, type ListmonkConfig } from '../services/listmonk_client.js';

const integrationHealth = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Known integration names — kept in lockstep with ADR-0034 live services. */
const KNOWN_INTEGRATIONS = new Set([
  'listmonk', // CF Container — mail.projectsites.dev
  'twenty', // CF Container — crm.projectsites.dev
  'stripe', // Managed SaaS — billing
  'deepgram', // Managed SaaS — STT
  'unkey', // Managed SaaS — API keys
  'langfuse', // CF Container — traces.projectsites.dev
  'payload', // CF Container — cms.projectsites.dev
  // Removed / deprecated (probe returns 410 Gone)
  'resend', // Deprecated → SES (ADR-0019)
  'lago', // Removed → Stripe Meters (ADR-0034)
  'nango', // Removed → Native OAuth (ADR-0034)
  'inngest', // Removed → CF Workflows v2 (ADR-0034)
  'postiz', // Removed → Native social (ADR-0034)
]);

/** Services fully decommissioned per ADR-0034 — probe returns 410 Gone. */
const REMOVED_INTEGRATIONS = new Set(['nango', 'inngest', 'postiz']);

/**
 * Env-var whose presence marks a config-only integration as "configured".
 * listmonk + twenty are probed with a LIVE fetch instead (see {@link buildSignal}).
 */
const CONFIG_ENV_KEY: Readonly<Record<string, string>> = {
  stripe: 'STRIPE_SECRET_KEY',
  resend: 'RESEND_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
  lago: 'LAGO_API_KEY',
  unkey: 'UNKEY_ROOT_KEY',
  langfuse: 'LANGFUSE_PUBLIC_KEY',
  payload: 'PAYLOAD_API_URL',
};

/**
 * Build a Listmonk config from Worker env vars.
 */
function listmonkCfg(env: Env): ListmonkConfig {
  return {
    baseUrl: env.LISTMONK_API_URL ?? 'https://mail.projectsites.dev',
    apiUser: env.LISTMONK_USERNAME ?? 'projectsites',
    apiToken: env.LISTMONK_PASSWORD ?? '',
  };
}

/**
 * Probe ONE integration and return its health {@link ConnectionSignal}.
 *
 * The single source of truth shared by BOTH the per-service endpoint and the
 * aggregate, so they can never report different statuses for the same service.
 *
 * - `listmonk` / `twenty` → LIVE fetch against the service.
 * - config-only services (stripe, deepgram, unkey, langfuse, payload, …) →
 *   presence of their {@link CONFIG_ENV_KEY} secret marks them configured.
 * - decommissioned services (nango/inngest/postiz) → the literal `'removed'`,
 *   which callers render as 410 Gone / `status: 'removed'`.
 *
 * @param name - lowercased integration name (must be in {@link KNOWN_INTEGRATIONS})
 * @param env - Worker env bindings
 * @returns the connection signal, or `'removed'` for decommissioned services
 */
async function buildSignal(name: string, env: Env): Promise<ConnectionSignal | 'removed'> {
  if (REMOVED_INTEGRATIONS.has(name)) return 'removed';

  switch (name) {
    case 'listmonk': {
      const cfg = listmonkCfg(env);
      const result = await listmonkHealth(cfg);
      return {
        provider: 'listmonk',
        lastStatus: result.ok ? 200 : 503,
        tokenValid: Boolean(cfg.apiToken),
        lastCallOk: result.ok,
        daysSinceLastUse: 0,
        isConfigured: Boolean(cfg.apiToken),
      };
    }
    case 'twenty': {
      const configured = Boolean(env.TWENTY_API_KEY && env.TWENTY_API_URL);
      if (!configured) {
        return {
          provider: 'twenty',
          lastStatus: 0,
          tokenValid: false,
          lastCallOk: false,
          daysSinceLastUse: 0,
          isConfigured: false,
        };
      }
      try {
        const res = await fetch(`${env.TWENTY_API_URL}/rest/companies?limit=1`, {
          headers: { Authorization: `Bearer ${env.TWENTY_API_KEY}` },
        });
        return {
          provider: 'twenty',
          lastStatus: res.status,
          tokenValid: true,
          lastCallOk: res.ok,
          daysSinceLastUse: 0,
          isConfigured: true,
        };
      } catch {
        return {
          provider: 'twenty',
          lastStatus: 503,
          tokenValid: true,
          lastCallOk: false,
          daysSinceLastUse: 0,
          isConfigured: true,
        };
      }
    }
    default: {
      // Config-presence probe: the service is "configured" iff its secret is set.
      const key = CONFIG_ENV_KEY[name];
      const configured = key ? Boolean((env as unknown as Record<string, unknown>)[key]) : false;
      return {
        provider: name,
        lastStatus: 0,
        tokenValid: configured,
        lastCallOk: configured,
        daysSinceLastUse: 0,
        isConfigured: configured,
      };
    }
  }
}

/**
 * `GET /api/integrations/:name/health`
 *
 * Probes a named integration and returns health signals. Unknown names
 * return 404; decommissioned services return 410 Gone.
 *
 * Response: `{ integration, status, signals, timestamp }`
 */
integrationHealth.get('/api/integrations/:name/health', async (c) => {
  const name = c.req.param('name').toLowerCase();

  if (!KNOWN_INTEGRATIONS.has(name)) {
    return c.json(
      { error: 'unknown_integration', message: `No health probe defined for '${name}'` },
      404,
    );
  }

  const sig = await buildSignal(name, c.env);

  if (sig === 'removed') {
    return c.json(
      {
        integration: name,
        status: 'removed',
        message: `${name} was decommissioned per ADR-0034 (2026-07-27). See docs/decisions/0034-platform-consolidation-cf-native.md`,
        timestamp: new Date().toISOString(),
      },
      410,
    );
  }

  const signals: ConnectionSignal[] = [sig];
  const aggregate = aggregateConnectionHealth(signals);

  return c.json({
    integration: name,
    status: aggregate.overall,
    signals: signals.map((s) => ({
      provider: s.provider,
      health: scoreConnectionHealth(s),
      configured: s.isConfigured,
    })),
    timestamp: new Date().toISOString(),
  });
});

/**
 * `GET /api/integrations/health` — aggregate health across all known integrations.
 *
 * Returns a rolled-up status for every registered integration in one call.
 * Uses the SAME {@link buildSignal} probe as the per-service endpoint, so a
 * configured live service (deepgram/unkey/langfuse/payload) reports its real
 * status here — never a degraded `unknown` from a divergent code path.
 */
integrationHealth.get('/api/integrations/health', async (c) => {
  const results: Array<{ integration: string; status: string; configured: boolean }> = [];

  for (const name of KNOWN_INTEGRATIONS) {
    const sig = await buildSignal(name, c.env);
    if (sig === 'removed') {
      results.push({ integration: name, status: 'removed', configured: false });
      continue;
    }
    results.push({
      integration: name,
      status: scoreConnectionHealth(sig),
      configured: sig.isConfigured,
    });
  }

  return c.json({
    integrations: results,
    timestamp: new Date().toISOString(),
  });
});

export { integrationHealth, KNOWN_INTEGRATIONS, buildSignal };
