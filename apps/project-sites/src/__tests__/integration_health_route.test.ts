/**
 * @module __tests__/integration_health_route
 * @description Regression tests for the integration-health probes.
 *
 * Guards the display-vs-source-of-truth bug fixed 2026-08-08: the aggregate
 * `GET /api/integrations/health` had its OWN degraded switch that fell to a
 * `default: unconfigured` branch, so live configured services (deepgram, unkey,
 * langfuse, payload) reported `unknown` in the aggregate while the per-service
 * endpoint reported them configured. Both now share `buildSignal`, so the two
 * can never diverge. These tests assert that invariant directly.
 */

// listmonk + twenty do LIVE fetches — mock the listmonk client + global fetch so
// the tests are hermetic and focus on the config-only aggregate regression.
jest.mock('../services/listmonk_client.js', () => ({
  listmonkHealth: jest.fn(async () => ({ ok: true })),
}));

import { integrationHealth, buildSignal } from '../routes/integration_health.js';
import type { Env } from '../types/env.js';

/** A mock env with every config-only integration secret PRESENT. */
function configuredEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    LISTMONK_PASSWORD: 'lm-token',
    LISTMONK_API_URL: 'https://mail.example.test',
    LISTMONK_USERNAME: 'projectsites',
    TWENTY_API_KEY: 'tw-key',
    TWENTY_API_URL: 'https://crm.example.test',
    STRIPE_SECRET_KEY: 'sk_test_x',
    RESEND_API_KEY: 're_x',
    DEEPGRAM_API_KEY: 'dg_x',
    LAGO_API_KEY: 'lago_x',
    UNKEY_ROOT_KEY: 'unkey_x',
    LANGFUSE_PUBLIC_KEY: 'pk_x',
    PAYLOAD_API_URL: 'https://cms.example.test',
    ...overrides,
  } as unknown as Env;
}

beforeEach(() => {
  // twenty + listmonk do LIVE liveness probes (`${TWENTY_API_URL}/healthz`,
  // `${LISTMONK_API_URL}/health`) — return a 200 so the config-only aggregate is hermetic.
  global.fetch = jest.fn(
    async () => new Response('{}', { status: 200 }),
  ) as unknown as typeof fetch;
});

describe('buildSignal — config-only services reflect their secret presence', () => {
  for (const [name, envKey] of [
    ['stripe', 'STRIPE_SECRET_KEY'],
    ['deepgram', 'DEEPGRAM_API_KEY'],
    ['langfuse', 'LANGFUSE_PUBLIC_KEY'],
    ['resend', 'RESEND_API_KEY'],
  ] as const) {
    it(`${name}: configured when ${envKey} is set, not-configured when unset`, async () => {
      const on = await buildSignal(name, configuredEnv());
      expect(on).not.toBe('removed');
      if (on !== 'removed') expect(on.isConfigured).toBe(true);

      const off = await buildSignal(name, configuredEnv({ [envKey]: undefined }));
      expect(off).not.toBe('removed');
      if (off !== 'removed') expect(off.isConfigured).toBe(false);
    });
  }

  it('decommissioned services return the "removed" sentinel', async () => {
    for (const name of ['nango', 'inngest', 'postiz', 'lago']) {
      expect(await buildSignal(name, configuredEnv())).toBe('removed');
    }
  });

  it('unkey + payload are LIVE-probed (public liveness), not config-presence', async () => {
    // Both are CF Containers with a public health endpoint → probed live, so they report
    // healthy + configured regardless of whether an admin secret sits in the worker env.
    for (const name of ['unkey', 'payload'] as const) {
      const on = await buildSignal(name, configuredEnv());
      expect(on).not.toBe('removed');
      if (on !== 'removed') {
        expect(on.isConfigured).toBe(true);
        expect(on.lastCallOk).toBe(true); // beforeEach stubs fetch → 200
      }
      // still configured even with NO admin secret — liveness is not gated on config
      const off = await buildSignal(
        name,
        configuredEnv({ UNKEY_ROOT_KEY: undefined, PAYLOAD_API_URL: undefined }),
      );
      expect(off).not.toBe('removed');
      if (off !== 'removed') expect(off.isConfigured).toBe(true);
    }
  });
});

describe('GET /api/integrations/health — aggregate reflects real per-service status', () => {
  it('configured live services are NOT reported as unknown (the regression)', async () => {
    const res = await integrationHealth.request('/api/integrations/health', {}, configuredEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      integrations: Array<{ integration: string; status: string; configured: boolean }>;
    };
    const byName = new Map(body.integrations.map((i) => [i.integration, i]));

    for (const name of ['deepgram', 'unkey', 'langfuse', 'payload', 'stripe']) {
      const row = byName.get(name);
      expect(row).toBeDefined();
      // The bug: these read `unknown` (unconfigured default branch). Now configured.
      expect(row?.configured).toBe(true);
      expect(row?.status).not.toBe('unknown');
    }

    // Removed services surface as `removed`, never a misleading `unknown`.
    expect(byName.get('nango')?.status).toBe('removed');
  });

  it('aggregate status AGREES with the per-service endpoint (anti-drift)', async () => {
    const env = configuredEnv();
    const agg = (await (
      await integrationHealth.request('/api/integrations/health', {}, env)
    ).json()) as { integrations: Array<{ integration: string; status: string }> };
    const aggByName = new Map(agg.integrations.map((i) => [i.integration, i.status]));

    for (const name of ['deepgram', 'unkey', 'langfuse', 'payload', 'stripe']) {
      const perRes = await integrationHealth.request(`/api/integrations/${name}/health`, {}, env);
      expect(perRes.status).toBe(200);
      const per = (await perRes.json()) as { status: string };
      expect(per.status).toBe(aggByName.get(name));
    }
  });

  it('per-service endpoint returns 410 for decommissioned services', async () => {
    const res = await integrationHealth.request(
      '/api/integrations/nango/health',
      {},
      configuredEnv(),
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('removed');
  });
});
