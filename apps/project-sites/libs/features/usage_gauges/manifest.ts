/**
 * Usage Gauges — feature module manifest.
 *
 * @remarks
 * Per-org usage metrics for SVG gauge-ring visualization in the admin
 * dashboard. Computes build count, estimated media storage, and site
 * count against plan limits. Read-only aggregation from D1.
 */
export const manifest = {
  slug: 'usage_gauges',
  name: 'Usage Gauge Rings',
  description:
    'Per-org usage metrics — build count, media storage estimate, site count, bandwidth — computed from D1 and served for SVG gauge-ring visualization in the admin dashboard.',
  flagKey: 'usage_gauges',
  owner: 'brian@megabyte.space',
  stage: 'experimental' as const,
  createdAt: '2026-07-15',
};
