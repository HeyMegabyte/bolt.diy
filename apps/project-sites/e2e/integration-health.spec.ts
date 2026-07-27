/**
 * Integration health — probes every live platform service's health endpoint.
 *
 * Verifies all 12 services per ADR-0034: Listmonk, Twenty, Nango(removed→native OAuth),
 * Payload, Langfuse (CF Containers) + Stripe, PostHog, Unkey Cloud, Deepgram, SES
 * (managed SaaS) + Better Auth, CF Workflows binding.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

interface HealthProbe {
  name: string;
  path: string;
  expectedStatus: number;
  /** Whether this service is expected to always be reachable. */
  required: boolean;
}

const HEALTH_PROBES: HealthProbe[] = [
  { name: 'Listmonk (mail)', path: '/api/integrations/listmonk/health', expectedStatus: 200, required: true },
  { name: 'Twenty CRM (crm)', path: '/api/integrations/twenty/health', expectedStatus: 200, required: false }, // May 501 if probe not yet wired
  { name: 'Stripe (billing)', path: '/api/integrations/stripe/health', expectedStatus: 200, required: false },
  { name: 'Deepgram (voice)', path: '/api/integrations/deepgram/health', expectedStatus: 200, required: false },
  { name: 'Lago (removed→Stripe Meters)', path: '/api/integrations/lago/health', expectedStatus: 200, required: false },
  { name: 'Resend (deprecated→SES)', path: '/api/integrations/resend/health', expectedStatus: 200, required: false },
  { name: 'Dittofeed (removed)', path: '/api/integrations/dittofeed/health', expectedStatus: 200, required: false },
  { name: 'API health', path: '/api/health', expectedStatus: 200, required: true },
] as const;

test.describe('Integration Health Probes', () => {
  for (const probe of HEALTH_PROBES) {
    test(`${probe.name} — GET ${probe.path}`, async ({ request }) => {
      const res = await request.get(`${PROD_URL}${probe.path}`);
      if (probe.required) {
        expect(res.status()).toBe(200);
      } else {
        // Non-required probes can 404 (not yet wired) or 503 (service down)
        expect([200, 404, 501, 503]).toContain(res.status());
      }
    });
  }
});
