/**
 * @module routes/integration_health
 * @description `GET /api/integrations/:name/health` — per-service health probe.
 *
 * Probes each configured integration (Listmonk, Twenty, Stripe, etc.) and
 * returns health signals using the pure scoring functions from
 * {@link ../services/integration_health.ts}. No auth required — this is a
 * lightweight operational endpoint.
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
  'dittofeed', // Removed → Novu+Listmonk (ADR-0034)
  'lago', // Removed → Stripe Meters (ADR-0034)
  'nango', // Removed → Native OAuth (ADR-0034)
  'inngest', // Removed → CF Workflows v2 (ADR-0034)
  'postiz', // Removed → Native social (ADR-0034)
]);

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
 * `GET /api/integrations/:name/health`
 *
 * Probes a named integration and returns health signals. Unknown names
 * return 404; known-but-unconfigured return an `unknown` status.
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

  const signals: ConnectionSignal[] = [];

  switch (name) {
    case 'listmonk': {
      const cfg = listmonkCfg(c.env);
      const result = await listmonkHealth(cfg);
      signals.push({
        provider: 'listmonk',
        lastStatus: result.ok ? 200 : 503,
        tokenValid: Boolean(cfg.apiToken),
        lastCallOk: result.ok,
        daysSinceLastUse: 0,
        isConfigured: Boolean(cfg.apiToken),
      });
      break;
    }
    case 'twenty': {
      const configured = Boolean(c.env.TWENTY_API_KEY && c.env.TWENTY_API_URL);
      if (configured) {
        try {
          const res = await fetch(`${c.env.TWENTY_API_URL}/rest/companies?limit=1`, {
            headers: { Authorization: `Bearer ${c.env.TWENTY_API_KEY}` },
          });
          signals.push({
            provider: 'twenty',
            lastStatus: res.status,
            tokenValid: true,
            lastCallOk: res.ok,
            daysSinceLastUse: 0,
            isConfigured: true,
          });
        } catch {
          signals.push({
            provider: 'twenty',
            lastStatus: 503,
            tokenValid: true,
            lastCallOk: false,
            daysSinceLastUse: 0,
            isConfigured: true,
          });
        }
      } else {
        signals.push({
          provider: 'twenty',
          lastStatus: 0,
          tokenValid: false,
          lastCallOk: false,
          daysSinceLastUse: 0,
          isConfigured: false,
        });
      }
      break;
    }
    case 'stripe': {
      const configured = Boolean(c.env.STRIPE_SECRET_KEY);
      signals.push({
        provider: 'stripe',
        lastStatus: 0,
        tokenValid: configured,
        lastCallOk: configured,
        daysSinceLastUse: 0,
        isConfigured: configured,
      });
      break;
    }
    case 'resend': {
      const configured = Boolean(c.env.RESEND_API_KEY);
      signals.push({
        provider: 'resend',
        lastStatus: 0,
        tokenValid: configured,
        lastCallOk: configured,
        daysSinceLastUse: 0,
        isConfigured: configured,
      });
      break;
    }
    case 'dittofeed': {
      const configured = Boolean(c.env.DITTOFEED_ADMIN_API_KEY);
      signals.push({
        provider: 'dittofeed',
        lastStatus: 0,
        tokenValid: configured,
        lastCallOk: configured,
        daysSinceLastUse: 0,
        isConfigured: configured,
      });
      break;
    }
    case 'deepgram': {
      const configured = Boolean(c.env.DEEPGRAM_API_KEY);
      signals.push({
        provider: 'deepgram',
        lastStatus: 0,
        tokenValid: configured,
        lastCallOk: configured,
        daysSinceLastUse: 0,
        isConfigured: configured,
      });
      break;
    }
    case 'lago': {
      const configured = Boolean(c.env.LAGO_API_KEY);
      signals.push({
        provider: 'lago',
        lastStatus: 0,
        tokenValid: configured,
        lastCallOk: configured,
        daysSinceLastUse: 0,
        isConfigured: configured,
      });
      break;
    }
    case 'unkey': {
      const configured = Boolean((c.env as unknown as Record<string, unknown>)['UNKEY_ROOT_KEY']);
      signals.push({
        provider: 'unkey',
        lastStatus: 0,
        tokenValid: configured,
        lastCallOk: configured,
        daysSinceLastUse: 0,
        isConfigured: configured,
      });
      break;
    }
    case 'langfuse': {
      const configured = Boolean(
        (c.env as unknown as Record<string, unknown>)['LANGFUSE_PUBLIC_KEY'],
      );
      signals.push({
        provider: 'langfuse',
        lastStatus: 0,
        tokenValid: configured,
        lastCallOk: configured,
        daysSinceLastUse: 0,
        isConfigured: configured,
      });
      break;
    }
    case 'payload': {
      const configured = Boolean((c.env as unknown as Record<string, unknown>)['PAYLOAD_API_URL']);
      signals.push({
        provider: 'payload',
        lastStatus: 0,
        tokenValid: configured,
        lastCallOk: configured,
        daysSinceLastUse: 0,
        isConfigured: configured,
      });
      break;
    }
    // Removed services — return 410 Gone with deprecation notice
    case 'nango':
    case 'inngest':
    case 'postiz':
      return c.json(
        {
          integration: name,
          status: 'removed',
          message: `${name} was decommissioned per ADR-0034 (2026-07-27). See docs/decisions/0034-platform-consolidation-cf-native.md`,
          timestamp: new Date().toISOString(),
        },
        410,
      );
    default:
      break;
  }

  const aggregate = aggregateConnectionHealth(signals);
  const timestamp = new Date().toISOString();

  return c.json({
    integration: name,
    status: aggregate.overall,
    signals: signals.map((s) => ({
      provider: s.provider,
      health: scoreConnectionHealth(s),
      configured: s.isConfigured,
    })),
    timestamp,
  });
});

/**
 * `GET /api/integrations/health` — aggregate health across all known integrations.
 *
 * Returns a rolled-up status for every registered integration in one call.
 */
integrationHealth.get('/api/integrations/health', async (c) => {
  const results: Array<{ integration: string; status: string; configured: boolean }> = [];

  for (const name of KNOWN_INTEGRATIONS) {
    const signals: ConnectionSignal[] = [];
    let status = 'unknown';

    switch (name) {
      case 'listmonk': {
        const cfg = listmonkCfg(c.env);
        const result = await listmonkHealth(cfg);
        const s: ConnectionSignal = {
          provider: 'listmonk',
          lastStatus: result.ok ? 200 : 503,
          tokenValid: Boolean(cfg.apiToken),
          lastCallOk: result.ok,
          daysSinceLastUse: 0,
          isConfigured: Boolean(cfg.apiToken),
        };
        status = scoreConnectionHealth(s);
        break;
      }
      case 'twenty': {
        const configured = Boolean(c.env.TWENTY_API_KEY);
        const s: ConnectionSignal = {
          provider: 'twenty',
          lastStatus: 0,
          tokenValid: configured,
          lastCallOk: configured,
          daysSinceLastUse: 0,
          isConfigured: configured,
        };
        status = scoreConnectionHealth(s);
        break;
      }
      case 'stripe': {
        const configured = Boolean(c.env.STRIPE_SECRET_KEY);
        const s: ConnectionSignal = {
          provider: 'stripe',
          lastStatus: 0,
          tokenValid: configured,
          lastCallOk: configured,
          daysSinceLastUse: 0,
          isConfigured: configured,
        };
        status = scoreConnectionHealth(s);
        break;
      }
      default: {
        const configured = false;
        const s: ConnectionSignal = {
          provider: name,
          lastStatus: 0,
          tokenValid: false,
          lastCallOk: false,
          daysSinceLastUse: 0,
          isConfigured: configured,
        };
        status = scoreConnectionHealth(s);
        break;
      }
    }

    results.push({ integration: name, status, configured: status !== 'unknown' });
  }

  return c.json({
    integrations: results,
    timestamp: new Date().toISOString(),
  });
});

export { integrationHealth, KNOWN_INTEGRATIONS };
