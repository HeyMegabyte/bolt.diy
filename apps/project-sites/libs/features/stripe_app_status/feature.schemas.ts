/**
 * @module libs/features/stripe_app_status/schemas
 *
 * Zod schemas for the Stripe App Marketplace install-analytics surface.
 */

import { z } from 'zod';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const InstallSourceSchema = z.enum([
  'marketplace',
  'direct',
  'referral',
]);
export type InstallSource = z.infer<typeof InstallSourceSchema>;

export const InstallStatusSchema = z.enum([
  'installed',
  'uninstalled',
  'paused',
]);
export type InstallStatus = z.infer<typeof InstallStatusSchema>;

// ─── Persisted row ───────────────────────────────────────────────────────────

export const StripeAppInstallSchema = z.object({
  id: z.string().min(1),
  org_id: z.string().min(1).nullable(),
  stripe_account: z.string().min(1),
  install_source: InstallSourceSchema,
  status: InstallStatusSchema,
  installed_at: z.string(),
  uninstalled_at: z.string().nullable(),
  last_event_at: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type StripeAppInstall = z.infer<typeof StripeAppInstallSchema>;

// ─── Lifecycle event ingest (from the marketplace OAuth callback) ────────────

export const StripeAppLifecycleEventSchema = z.object({
  stripe_account: z
    .string()
    .min(1)
    .regex(/^acct_[a-zA-Z0-9]+$/, 'stripe_account must look like acct_...'),
  event_type: z.enum([
    'installed',
    'uninstalled',
    'paused',
    'resumed',
    'updated',
  ]),
  install_source: InstallSourceSchema.default('marketplace'),
  org_id: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type StripeAppLifecycleEvent = z.infer<
  typeof StripeAppLifecycleEventSchema
>;

// ─── Summary response ────────────────────────────────────────────────────────

export const StripeAppSummarySchema = z.object({
  total_installs: z.number().int().min(0),
  active_installs: z.number().int().min(0),
  uninstalled: z.number().int().min(0),
  paused: z.number().int().min(0),
  by_source: z.record(InstallSourceSchema, z.number().int().min(0)),
  last_event_at: z.string().nullable(),
});
export type StripeAppSummary = z.infer<typeof StripeAppSummarySchema>;

/**
 * Pure summary computation from a list of install rows. Easy to unit-test
 * without any D1 dependency.
 */
export function summarizeInstalls(
  installs: StripeAppInstall[],
): StripeAppSummary {
  const summary: StripeAppSummary = {
    total_installs: installs.length,
    active_installs: 0,
    uninstalled: 0,
    paused: 0,
    by_source: { marketplace: 0, direct: 0, referral: 0 },
    last_event_at: null,
  };

  for (const row of installs) {
    if (row.status === 'installed') summary.active_installs += 1;
    if (row.status === 'uninstalled') summary.uninstalled += 1;
    if (row.status === 'paused') summary.paused += 1;
    summary.by_source[row.install_source] =
      (summary.by_source[row.install_source] ?? 0) + 1;

    const candidate = row.last_event_at ?? row.installed_at;
    if (!summary.last_event_at || candidate > summary.last_event_at) {
      summary.last_event_at = candidate;
    }
  }

  return summary;
}
