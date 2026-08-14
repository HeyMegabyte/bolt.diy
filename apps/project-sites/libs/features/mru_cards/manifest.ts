/**
 * MRU Cards — feature module manifest.
 *
 * @remarks
 * "Continue where you left off" — returns the most recently active sites
 * for the current org, ordered by last activity. Each card shows site name,
 * slug, last action, and a quick-jump link. Driven by audit_logs recency.
 */
export const manifest = {
  slug: 'mru_cards',
  name: 'Continue Where You Left Off (MRU Cards)',
  description:
    'Most-recently-active sites for the current org, ordered by last audit_log entry. Returns site name, slug, last action summary, and quick-jump link. Drives the dashboard "Continue where you left off" widget.',
  flagKey: 'activity_feed',
  owner: 'brian@megabyte.space',
  stage: 'experimental' as const,
  createdAt: '2026-07-15',
};
