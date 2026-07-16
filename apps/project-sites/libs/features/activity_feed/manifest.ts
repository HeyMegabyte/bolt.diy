/**
 * Activity Feed — feature module manifest.
 *
 * @remarks
 * Aggregates recent events from audit_logs, workflow_jobs, and site status
 * transitions into a unified org-scoped timeline. Each entry carries an
 * event type, actor, target, and human-readable summary. Designed for
 * the admin dashboard "Live Activity Feed" widget.
 */
export const manifest = {
  slug: 'activity_feed',
  name: 'Dashboard Activity Feed',
  description:
    'Unified org-scoped timeline of recent platform events — builds, publishes, deploys, errors, and state transitions. Aggregated from audit_logs, workflow_jobs, and site status changes.',
  flagKey: 'activity_feed',
  owner: 'brian@megabyte.space',
  stage: 'experimental' as const,
  createdAt: '2026-07-15',
};
