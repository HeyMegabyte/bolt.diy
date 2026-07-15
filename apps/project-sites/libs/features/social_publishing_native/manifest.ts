/**
 * Native Social Publishing — feature module manifest.
 *
 * @remarks
 * Replaces Postiz (AGPL, Temporal, BullMQ) with CF-native primitives:
 * CF Workflows v2 for durable scheduling, Upstash Redis for job queue,
 * D1 for system of record, Tinybird for analytics, MCP OAuth layer for
 * platform connections. Supports 14 social platforms.
 *
 * Flag is OFF by default (`enabled=0, stage='experimental'`).
 * When disabled: all `/api/social/*` routes return 404.
 * Existing Pulse Social routes continue to work alongside this flag.
 */
export const manifest = {
  slug: 'social_publishing_native',
  name: 'Native Social Publishing',
  description:
    'Native social media posting (instant + scheduled) across 14 platforms. Replaces Postiz. CF Workflows v2 + Upstash + D1 + Tinybird.',
  flagKey: 'social_publishing_native',
  owner: 'brian@megabyte.space',
  stage: 'experimental' as const,
  createdAt: '2026-07-15',
};
