/**
 * System Status — feature module manifest.
 *
 * @remarks
 * Aggregates health checks from all platform integrations (Listmonk, Lago,
 * Nango, Dittofeed, LiteLLM, etc.) and returns a unified status strip
 * for the admin top bar. Each integration gets an independent health probe
 * with a 5s timeout; the endpoint returns degraded when any probe fails.
 */
export const manifest = {
  slug: 'system_status',
  name: 'System Status Strip',
  description:
    'Aggregated health checks for all platform integrations. Returns per-integration status (green/yellow/red) for the admin top bar. Each probe is independent with a 5s timeout.',
  flagKey: 'system_status',
  owner: 'brian@megabyte.space',
  stage: 'experimental' as const,
  createdAt: '2026-07-15',
};
